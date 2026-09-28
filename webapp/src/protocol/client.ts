import { IMAGE_SIZE, MAX_CHUNK } from '../model/constants';
import { imageCrc } from '../codec/crc16';
import {
  buildRequest, Opcode, parseInfo, parseReply, parseStatus, Status, statusText,
  type DeviceInfo, type DeviceStatus, type Reply,
} from './packet';
import type { Transport } from './transport';

export class ProtocolError extends Error {
  constructor(message: string, readonly status?: number, readonly opcode?: number) {
    super(message);
  }
}

export class TimeoutError extends ProtocolError {
  constructor(opcode: number) {
    super('The device did not reply in time.', undefined, opcode);
  }
}

export type SavePhase = 'uploading' | 'saving' | 'verifying';
export type SaveProgress = (phase: SavePhase, fraction: number) => void;

export interface ClientOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Request/reply client with one outstanding request, timeouts and bounded retries.
 * All commands are idempotent per hid-v1.md, so a lost reply is safe to retry.
 */
export class ConfigClient {
  private sequence = Math.floor(Math.random() * 256);
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(readonly transport: Transport, options: ClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 400;
    this.retries = options.retries ?? 3;
  }

  private async exchange(opcode: Opcode, offset = 0, data?: Uint8Array, length?: number): Promise<Reply> {
    const run = async (): Promise<Reply> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        const sequence = this.sequence = (this.sequence + 1) & 0xff;
        try {
          return await this.once(opcode, sequence, offset, data, length);
        } catch (error) {
          lastError = error;
          if (!(error instanceof TimeoutError)) throw error;
        }
      }
      throw lastError;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private once(opcode: Opcode, sequence: number, offset: number, data?: Uint8Array, length?: number): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new TimeoutError(opcode))), this.timeoutMs);
      const unsubscribe = this.transport.onReply((payload) => {
        const reply = parseReply(payload);
        if (!reply || reply.sequence !== sequence || reply.opcode !== opcode) return;
        finish(() => {
          if (reply.status !== Status.Ok) reject(new ProtocolError(statusText(reply.status), reply.status, opcode));
          else resolve(reply);
        });
      });
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        action();
      };
      this.transport.send(buildRequest({ opcode, sequence, offset, data, length })).catch((error) => finish(() => reject(error)));
    });
  }

  async getInfo(): Promise<DeviceInfo> {
    const reply = await this.exchange(Opcode.GetInfo);
    const info = parseInfo(reply.data);
    if (!info) throw new ProtocolError('The device did not identify itself as a Universal Macropad.');
    return info;
  }

  async getStatus(): Promise<DeviceStatus> {
    const reply = await this.exchange(Opcode.GetStatus);
    const status = parseStatus(reply.data);
    if (!status) throw new ProtocolError('Malformed status reply.');
    return status;
  }

  private async readImage(opcode: Opcode.ReadFlash | Opcode.ReadActive, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
    const image = new Uint8Array(IMAGE_SIZE);
    for (let offset = 0; offset < IMAGE_SIZE; offset += MAX_CHUNK) {
      const length = Math.min(MAX_CHUNK, IMAGE_SIZE - offset);
      const reply = await this.exchange(opcode, offset, undefined, length);
      if (reply.data.length !== length) throw new ProtocolError(`Short read at offset ${offset}.`);
      image.set(reply.data, offset);
      onProgress?.((offset + length) / IMAGE_SIZE);
    }
    return image;
  }

  /** Reads the persistent DataFlash image, valid or not. */
  readFlash(onProgress?: (fraction: number) => void): Promise<Uint8Array> {
    return this.readImage(Opcode.ReadFlash, onProgress);
  }

  /** Reads the image currently in use (built-in defaults when flash is invalid). */
  readActive(onProgress?: (fraction: number) => void): Promise<Uint8Array> {
    return this.readImage(Opcode.ReadActive, onProgress);
  }

  async abortWrite(): Promise<void> {
    await this.exchange(Opcode.AbortWrite);
  }

  /**
   * Uploads, commits, then independently reads flash back and compares byte for byte.
   * Resolves only when flash provably holds the uploaded image.
   */
  async saveImage(image: Uint8Array, onProgress?: SaveProgress): Promise<void> {
    if (image.length !== IMAGE_SIZE) throw new RangeError('image must be 128 bytes');
    const crc = imageCrc(image);
    onProgress?.('uploading', 0);
    await this.exchange(Opcode.BeginWrite, 0, new Uint8Array([IMAGE_SIZE, crc & 0xff, crc >> 8]));
    for (let offset = 0; offset < IMAGE_SIZE; offset += MAX_CHUNK) {
      const chunk = image.subarray(offset, Math.min(offset + MAX_CHUNK, IMAGE_SIZE));
      await this.exchange(Opcode.WriteChunk, offset, chunk);
      onProgress?.('uploading', (offset + chunk.length) / IMAGE_SIZE);
    }
    onProgress?.('saving', 0);
    try {
      await this.exchange(Opcode.CommitWrite);
    } catch (error) {
      // A lost commit reply may still mean the save completed; verification below decides.
      if (!(error instanceof TimeoutError)) throw error;
    }
    onProgress?.('verifying', 0);
    const stored = await this.readFlash((f) => onProgress?.('verifying', f));
    for (let i = 0; i < IMAGE_SIZE; i++) {
      if (stored[i] !== image[i]) {
        throw new ProtocolError(`Verification failed: flash byte ${i} is 0x${stored[i]!.toString(16)} but 0x${image[i]!.toString(16)} was written.`, Status.FlashFailed);
      }
    }
  }
}
