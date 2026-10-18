import { sourceKeys } from '../protocol/live';

export function liveSource(source: number, keys: number, userTimers = -1): string {
  if (!(source & 128)) return sourceKeys(source).map(key => key === keys ? 'Encoder Button' : `Key ${key + 1}`).join(' + ');
  const input = source & 127;
  return input === 9 + userTimers ? 'Auto-Sleep' : input === 7 ? 'Clockwise' : input === 8 ? 'Counterclockwise' : input === 15 ? 'Macro Step' : `Timer ${input - 8}`;
}

export function runtimeAction(source: number, second: number, timers: number): string {
  return source === 0x89 + timers ? second === 15 ? 'Wake from Auto-Sleep' : 'Auto-Sleep' : 'Runtime Lighting Action';
}
