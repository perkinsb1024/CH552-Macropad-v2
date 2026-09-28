/** Unordered physical-key pairs in lexicographic order: (0,1), (0,2), … (n-2,n-1). */
export function pairIndex(keyA: number, keyB: number, keys: number): number {
  let index = 0;
  for (let i = 0; i < keyA; i++) index += keys - i - 1;
  return index + keyB - keyA - 1;
}

export function pairFromIndex(index: number, keys: number): [number, number] {
  let remaining = index;
  for (let a = 0; a < keys - 1; a++) {
    const span = keys - a - 1;
    if (remaining < span) return [a, a + 1 + remaining];
    remaining -= span;
  }
  throw new RangeError(`pair index ${index} out of range for ${keys} keys`);
}

export function allPairs(keys: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let a = 0; a < keys; a++) for (let b = a + 1; b < keys; b++) pairs.push([a, b]);
  return pairs;
}

export function chordId(layer: number, keyA: number, keyB: number, keys: number): number {
  return (layer << 4) | pairIndex(keyA, keyB, keys);
}
