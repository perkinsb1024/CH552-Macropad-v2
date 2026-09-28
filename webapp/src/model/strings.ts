/** Version 1 strings: printable US ASCII (0x20–0x7E) plus tab and LF. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function invalidCharacters(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || (code >= 32 && code <= 126)) continue;
    bad.add(ch);
  }
  return [...bad];
}

export function describeCharacter(ch: string): string {
  const code = ch.codePointAt(0)!;
  if (code < 32 || code === 127) return `control U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return `“${ch}” (U+${code.toString(16).toUpperCase().padStart(4, '0')})`;
}

/** Encoded size of one string in the pool, including its terminator. */
export function encodedLength(text: string): number {
  return text.length + 1;
}
