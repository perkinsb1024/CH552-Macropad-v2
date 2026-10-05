import { FORMAT_VERSION, IMAGE_SIZE, maxLayers, PAYLOAD_SIZE, type Variant } from '../model/constants';
import { imageCrc } from '../codec/crc16';
import { decodeImage } from '../codec/decode';
import { encodeProfile } from '../codec/encode';
import { defaultProfile } from '../model/defaults';
import { PALETTE_VERSION } from '../model/palette';
import { Opcode, Status, TRANSPORT_VERSION } from './packet';
import type { ReplyListener, Transport } from './transport';

export interface SimulatorOptions {
  variant: Variant;
  /** Start with empty flash so the "no saved profile" path is exercised. */
  blankFlash?: boolean;
  /** Raw stored image, including legacy/invalid profiles for migration tests. */
  initialImage?: Uint8Array;
  /** Artificial per-request latency in ms. */
  latency?: number;
  /** Fail flash verification on the next commit (for testing error handling). */
  failNextCommit?: boolean;
  /** Model firmware built with ENABLE_COLOR_PREVIEW=0 (or older firmware). */
  previewSupported?: boolean;
}

/**
 * In-browser model of the firmware's protocol handler (firmware/src/protocol_firmware.c).
 * Lets the editor be exercised end to end without hardware.
 */
export class SimulatedDevice implements Transport {
  readonly kind = 'simulator';
  readonly flash = new Uint8Array(IMAGE_SIZE);
  readonly active = new Uint8Array(IMAGE_SIZE);
  flashValid = false;
  previewOptions = 0;
  private activeValid = false;
  private staging = new Uint8Array(IMAGE_SIZE);
  private uploadState: 0 | 1 | 2 = 0;
  private uploadNext = 0;
  private uploadCrc = 0;
  private uploadTime = 0;
  private replyListeners = new Set<ReplyListener>();
  private disconnectListeners = new Set<() => void>();
  private closed = false;

  constructor(readonly options: SimulatorOptions) {
    const defaults = encodeProfile(defaultProfile(options.variant));
    if (options.initialImage) this.flash.set(options.initialImage);
    else if (!options.blankFlash) this.flash.set(defaults);
    this.boot();
  }

  get name(): string {
    return `Simulated ${this.options.variant ? 'three' : 'six'}-key macropad`;
  }

  private boot(): void {
    this.flashValid = this.flash[2] === FORMAT_VERSION && decodeImage(this.flash, this.options.variant).ok;
    this.activeValid = this.flashValid;
    this.active.set(this.flash);
    this.uploadState = 0;
  }

  async send(payload: Uint8Array): Promise<void> {
    if (this.closed) throw new DOMException('Device is closed', 'InvalidStateError');
    const reply = this.process(payload);
    const deliver = () => {
      if (this.closed) return;
      for (const listener of this.replyListeners) listener(reply);
    };
    if (this.options.latency) setTimeout(deliver, this.options.latency);
    else queueMicrotask(deliver);
  }

  private process(inbox: Uint8Array): Uint8Array {
    const reply = new Uint8Array(PAYLOAD_SIZE);
    reply[0] = 0x55;
    reply[1] = 0x4d;
    reply[2] = TRANSPORT_VERSION;
    reply[3] = inbox[3]!;
    reply[4] = inbox[4]!;
    reply[5] = inbox[5]!;
    const status = this.handle(inbox, reply);
    reply[7] = status;
    if (status !== Status.Ok) {
      reply[6] = 0;
      reply.fill(0, 8);
    }
    return reply;
  }

  private handle(inbox: Uint8Array, reply: Uint8Array): Status {
    const now = performance.now();
    if (this.uploadState && now - this.uploadTime >= 5000) this.uploadState = 0;
    const opcode = inbox[3]!;
    const offset = inbox[5]!;
    const length = inbox[6]!;
    if (inbox.length !== PAYLOAD_SIZE || inbox[0] !== 0x55 || inbox[1] !== 0x4d || inbox[7]) return Status.BadPacket;
    if (inbox[2] !== TRANSPORT_VERSION) return Status.BadVersion;
    if (length > 23) return Status.BadRange;
    const dataEnd = 8 + (opcode === Opcode.BeginWrite || opcode === Opcode.WriteChunk ? length : 0);
    for (let i = dataEnd; i < PAYLOAD_SIZE; i++) if (inbox[i]) return Status.BadPacket;
    if (opcode === Opcode.ReadFlash || opcode === Opcode.ReadActive || opcode === Opcode.WriteChunk) {
      if (!length || offset + length > IMAGE_SIZE) return Status.BadRange;
    } else if ((offset && opcode !== Opcode.PreviewColor) || (opcode === Opcode.BeginWrite ? length !== 3 : length !== 0)) {
      return Status.BadRange;
    }
    const touchUpload = () => {
      this.uploadTime = now;
    };
    switch (opcode) {
      case Opcode.GetInfo:
        reply[6] = 14;
        reply.set([0x55, 0x4d, 0x41, 0x43, TRANSPORT_VERSION, FORMAT_VERSION, this.options.variant, this.options.variant ? 3 : 6, this.options.variant ? 3 : 6, maxLayers(this.options.variant), IMAGE_SIZE, PALETTE_VERSION, 0xff, 0xff], 8);
        return Status.Ok;
      case Opcode.GetStatus:
        reply[6] = 6;
        reply.set([this.flashValid ? 1 : 0, this.activeValid ? this.active[3]! >> 3 & 7 : 0, this.activeValid ? this.active[3]! >> 3 & 7 : 0, this.uploadState, 0, 0], 8);
        return Status.Ok;
      case Opcode.ReadFlash:
        reply[6] = length;
        reply.set(this.flash.subarray(offset, offset + length), 8);
        return Status.Ok;
      case Opcode.ReadActive:
        reply[6] = length;
        reply.set(this.active.subarray(offset, offset + length), 8);
        return Status.Ok;
      case Opcode.BeginWrite:
        if (inbox[8] !== IMAGE_SIZE) return Status.BadRange;
        this.uploadCrc = inbox[9]! | (inbox[10]! << 8);
        this.uploadNext = 0;
        this.uploadState = 1;
        this.staging.fill(0);
        touchUpload();
        return Status.Ok;
      case Opcode.WriteChunk: {
        if (this.uploadState !== 1) return Status.Incomplete;
        const chunk = inbox.subarray(8, 8 + length);
        if (offset !== this.uploadNext) {
          if (offset + length > this.uploadNext) return Status.BadSequence;
          for (let i = 0; i < length; i++) if (this.staging[offset + i] !== chunk[i]) return Status.BadSequence;
        } else {
          this.staging.set(chunk, offset);
          this.uploadNext += length;
        }
        touchUpload();
        return Status.Ok;
      }
      case Opcode.CommitWrite: {
        if (this.uploadState === 2) return Status.Ok;
        if (this.uploadState !== 1 || this.uploadNext !== IMAGE_SIZE) return Status.Incomplete;
        const crc = imageCrc(this.staging);
        if (crc !== this.uploadCrc || this.staging[6] !== (crc & 0xff) || this.staging[7] !== crc >> 8) return Status.BadCrc;
        if (this.staging[2] !== FORMAT_VERSION || !decodeImage(this.staging, this.options.variant).ok) return Status.BadConfig;
        if (this.options.failNextCommit) {
          this.options.failNextCommit = false;
          this.flash[0] = 0; // invalidated magic, as after an interrupted save
          this.flashValid = false;
          return Status.FlashFailed;
        }
        this.flash.set(this.staging);
        this.flashValid = true;
        this.activeValid = true;
        this.active.set(this.staging);
        this.uploadState = 2;
        touchUpload();
        return Status.Ok;
      }
      case Opcode.PreviewColor:
        if (this.options.previewSupported === false) return Status.BadOpcode;
        if (offset && (offset & 0x06) !== 0x04) return Status.BadRange;
        this.previewOptions = offset;
        return Status.Ok;
      case Opcode.AbortWrite:
        this.uploadState = 0;
        return Status.Ok;
      default:
        return Status.BadOpcode;
    }
  }

  onReply(listener: ReplyListener): () => void {
    this.replyListeners.add(listener);
    return () => this.replyListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Any physical input cancels preview, including an unmapped input. */
  triggerInput(): void {
    this.previewOptions = 0;
  }

  /** Simulates unplugging the device. */
  unplug(): void {
    this.closed = true;
    for (const listener of this.disconnectListeners) listener();
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
