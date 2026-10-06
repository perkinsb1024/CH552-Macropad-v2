// GET_INFO's constant record identifies the configuration format in a HEX image.
export function firmwareFormat(image, keys) {
  const matches = [];
  for (let i = 0; i + 6 < image.length; i++) {
    if (image[i] === 0x55 && image[i + 1] === 0x4d &&
        image[i + 2] === 0x41 && image[i + 3] === 0x43 &&
        image[i + 4] === 1 && image[i + 6] === (keys === 3 ? 1 : 0)) {
      matches.push(image[i + 5]);
    }
  }
  if (matches.length !== 1) throw new Error('Cannot identify firmware configuration format.');
  return matches[0];
}

export function configuratorPath(format, currentFormat) {
  if (format === currentFormat) return '../';
  if (Number.isInteger(format) && format >= 2 && format < currentFormat) {
    return `../versions/format-v${format}/`;
  }
  throw new Error('No matching configurator for this firmware.');
}
