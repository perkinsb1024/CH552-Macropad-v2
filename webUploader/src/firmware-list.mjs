/** Keep the default release separate from the optional historical choices. */
export function firmwareChoices(manifest, keys) {
  return (manifest.previousFirmware ?? []).filter(entry => entry.keys === keys)
    .sort((a, b) => b.formatVersion - a.formatVersion || a.name.localeCompare(b.name));
}

export function selectedFirmware(manifest, keys, release = 'latest') {
  return release === 'latest' ? manifest.firmware.find(entry => entry.keys === keys)
    : firmwareChoices(manifest, keys).find(entry => entry.name === release);
}
