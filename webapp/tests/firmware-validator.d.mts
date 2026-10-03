export function createFirmwareValidator(): {
  accepts(image: Uint8Array, variant: number): boolean;
  close(): void;
};
