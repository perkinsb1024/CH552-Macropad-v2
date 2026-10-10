/** Keep the default release separate from the optional historical choices. */
export function firmwareChoices(manifest, keys) {
  return (manifest.previousFirmware ?? []).filter(entry => entry.keys === keys)
    .sort((a, b) => b.formatVersion - a.formatVersion || a.name.localeCompare(b.name));
}

export function selectedFirmware(manifest, keys, release = 'latest') {
  return release === 'latest' ? manifest.firmware.find(entry => entry.keys === keys)
    : firmwareChoices(manifest, keys).find(entry => entry.name === release);
}

/** Offer the most recently published build of each format, once per version. */
export function previousReleases(manifest, keys) {
  const entries = firmwareChoices(manifest, keys).sort((a, b) =>
    (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.name.localeCompare(b.name));
  const versions = new Map();
  for (const entry of entries) if (!versions.has(entry.formatVersion)) versions.set(entry.formatVersion, entry);
  return [...versions.values()].sort((a, b) => b.formatVersion - a.formatVersion);
}
