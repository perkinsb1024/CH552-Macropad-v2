import { parseHex } from './hex.mjs';

export function installationAllowed({ local, firmware, identified, variantConfirmed, unknownConfirmed }) {
  return !!firmware && variantConfirmed && (!local || identified || unknownConfirmed);
}

export function localFirmware(name, text, keys) {
  if (!/\.hex$/i.test(name)) throw new Error('Choose a .hex file.');
  const image = parseHex(text);
  const identities = [];
  for (let i = 0; i + 6 < image.length; i++) {
    if (image[i] === 0x55 && image[i + 1] === 0x4d && image[i + 2] === 0x41 &&
        image[i + 3] === 0x43 && image[i + 4] === 1 && image[i + 6] <= 1) {
      identities.push({ formatVersion: image[i + 5], keys: image[i + 6] ? 3 : 6 });
    }
  }
  if (identities.length > 1) throw new Error('Ambiguous firmware identity.');
  const identity = identities[0];
  if (identity && keys !== undefined && identity.keys !== keys) throw new Error(`This firmware is for a ${identity.keys}-key pad. Select that variant first.`);
  return { image, entry: { name, ...identity }, identified: !!identity };
}
