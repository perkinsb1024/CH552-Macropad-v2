import { HEADER_MARKER, IMAGE_SIZE } from '../model/constants';

/** CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Identify CRC placement from the marker, including retained legacy images. */
export function crcOffset(image: Uint8Array): number {
  return image[0] === HEADER_MARKER ? 7 : 6;
}

/** CRC covers every image byte except its layout's stored two-byte CRC. */
export function imageCrc(image: Uint8Array, offset = crcOffset(image)): number {
  const covered = new Uint8Array(IMAGE_SIZE - 2);
  covered.set(image.subarray(0, offset), 0);
  covered.set(image.subarray(offset + 2, IMAGE_SIZE), offset);
  return crc16(covered);
}

export function sealImage(image: Uint8Array): void {
  const crc = imageCrc(image);
  const offset = crcOffset(image);
  image[offset] = crc & 0xff;
  image[offset + 1] = crc >> 8;
}

export function storedCrc(image: Uint8Array): number {
  const offset = crcOffset(image);
  return image[offset]! | (image[offset + 1]! << 8);
}
