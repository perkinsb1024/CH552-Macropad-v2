import { IMAGE_SIZE } from '../model/constants';

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

/** CRC over image bytes 0–5 followed by 8–127. */
export function imageCrc(image: Uint8Array): number {
  const covered = new Uint8Array(IMAGE_SIZE - 2);
  covered.set(image.subarray(0, 6), 0);
  covered.set(image.subarray(8, IMAGE_SIZE), 6);
  return crc16(covered);
}

export function sealImage(image: Uint8Array): void {
  const crc = imageCrc(image);
  image[6] = crc & 0xff;
  image[7] = crc >> 8;
}

export function storedCrc(image: Uint8Array): number {
  return image[6]! | (image[7]! << 8);
}
