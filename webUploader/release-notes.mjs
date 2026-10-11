/** Convert README version-history rows to plain text for the installer. */
export function parseReleaseNotes(readme) {
  const notes = {};
  for (const match of readme.matchAll(/^\| \[v(\d+)\]\([^|]+\) \| (.*?) \|$/gm)) {
    const version = match[1];
    if (Object.hasOwn(notes, version)) throw new Error(`Duplicate release notes for v${version}.`);
    const text = match[2].split(/<br\s*\/?>/i).map(part => part.trim().replace(/^-\s*/, '')
      .replace(/\*\*/g, '').replace(/\*([^*]+)\*/g, '$1').replace(/ · /g, ' / '))
      .filter(Boolean).join('; ');
    if (!text) throw new Error(`Empty release notes for v${version}.`);
    notes[version] = text;
  }
  return notes;
}
