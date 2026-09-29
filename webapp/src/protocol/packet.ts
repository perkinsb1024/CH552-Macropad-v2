import { MAX_CHUNK, PAYLOAD_SIZE } from '../model/constants';

export const TRANSPORT_VERSION = 1;

export const enum Opcode {
  GetInfo = 1,
  GetStatus = 2,
  ReadFlash = 3,
  ReadActive = 4,
  BeginWrite = 5,
  WriteChunk = 6,
  CommitWrite = 7,
  AbortWrite = 8,
  PreviewColor = 9,
}

export const enum Status {
  Ok = 0,
  BadVersion = 1,
  BadOpcode = 2,
  BadRange = 3,
  BadPacket = 4,
  Incomplete = 5,
  BadConfig = 6,
  BadCrc = 7,
  Busy = 8,
  FlashFailed = 9,
  BadSequence = 10,
}

export const STATUS_TEXT: Record<number, string> = {
  [Status.Ok]: 'OK',
  [Status.BadVersion]: 'The device does not support this transport version.',
  [Status.BadOpcode]: 'The device rejected the command as unsupported.',
  [Status.BadRange]: 'Invalid offset or length.',
  [Status.BadPacket]: 'Malformed packet.',
  [Status.Incomplete]: 'Upload incomplete or expired; start the save again.',
  [Status.BadConfig]: 'The device rejected the configuration as invalid.',
  [Status.BadCrc]: 'CRC mismatch between the upload and its declared checksum.',
  [Status.Busy]: 'The device is busy.',
  [Status.FlashFailed]: 'Flash verification failed after writing.',
  [Status.BadSequence]: 'Upload chunk arrived out of order.',
};

export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? `Unknown status ${status}`;
}

export interface Request {
  opcode: Opcode;
  sequence: number;
  offset?: number;
  data?: Uint8Array;
  /** For reads: number of bytes requested (no data bytes are sent). */
  length?: number;
}

export interface Reply {
  opcode: number;
  sequence: number;
  offset: number;
  status: number;
  data: Uint8Array;
}

/** Builds the 31-byte payload that follows report ID 3. */
export function buildRequest(req: Request): Uint8Array {
  const data = req.data ?? new Uint8Array(0);
  if (data.length > MAX_CHUNK) throw new RangeError('request data exceeds 23 bytes');
  const payload = new Uint8Array(PAYLOAD_SIZE);
  payload[0] = 0x55; // U
  payload[1] = 0x4d; // M
  payload[2] = TRANSPORT_VERSION;
  payload[3] = req.opcode;
  payload[4] = req.sequence & 0xff;
  payload[5] = req.offset ?? 0;
  payload[6] = req.length ?? data.length;
  payload[7] = 0;
  payload.set(data, 8);
  return payload;
}

/** Parses a 31-byte reply payload (report ID 4 already stripped). Returns null for foreign traffic. */
export function parseReply(payload: Uint8Array): Reply | null {
  if (payload.length !== PAYLOAD_SIZE || payload[0] !== 0x55 || payload[1] !== 0x4d) return null;
  if (payload[2] !== TRANSPORT_VERSION) return null;
  const length = payload[6]!;
  if (length > MAX_CHUNK) return null;
  return {
    opcode: payload[3]!,
    sequence: payload[4]!,
    offset: payload[5]!,
    status: payload[7]!,
    data: payload.slice(8, 8 + length),
  };
}

export interface DeviceInfo {
  transportVersion: number;
  formatVersion: number;
  variant: 0 | 1;
  keyCount: number;
  ledCount: number;
  maxLayers: number;
  imageSize: number;
  paletteVersion: number;
  actionMask: number;
}

export function parseInfo(data: Uint8Array): DeviceInfo | null {
  if (data.length < 14) return null;
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'UMAC') return null;
  return {
    transportVersion: data[4]!,
    formatVersion: data[5]!,
    variant: (data[6]! & 1) as 0 | 1,
    keyCount: data[7]!,
    ledCount: data[8]!,
    maxLayers: data[9]!,
    imageSize: data[10]!,
    paletteVersion: data[11]!,
    actionMask: data[12]! | (data[13]! << 8),
  };
}

export interface DeviceStatus {
  flashValid: boolean;
  currentLayer: number;
  startupLayer: number;
  uploadState: 0 | 1 | 2;
  droppedButtonActions: number;
  droppedRotationActions: number;
}

export function parseStatus(data: Uint8Array): DeviceStatus | null {
  if (data.length < 6) return null;
  return {
    flashValid: data[0] !== 0,
    currentLayer: data[1]!,
    startupLayer: data[2]!,
    uploadState: Math.min(data[3]!, 2) as 0 | 1 | 2,
    droppedButtonActions: data[4]!,
    droppedRotationActions: data[5]!,
  };
}
