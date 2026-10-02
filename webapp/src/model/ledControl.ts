import { RAINBOW_PHASE_LABELS, RAINBOW_SPEED_LABELS } from './constants';

export const LED_COMMANDS = [
  { command: 'rainbowPhaseSet', label: 'Set rainbow phase spacing', relative: false },
  { command: 'rainbowPhaseRelative', label: 'Relative rainbow phase spacing', relative: true },
  { command: 'rainbowSpeedSet', label: 'Set rainbow speed', relative: false },
  { command: 'rainbowSpeedRelative', label: 'Relative rainbow speed', relative: true },
  { command: 'brightnessIndicatorSet', label: 'Set layer-indicator brightness', relative: false },
  { command: 'brightnessIndicatorRelative', label: 'Relative layer-indicator brightness', relative: true },
  { command: 'brightnessKeySet', label: 'Set key-press brightness', relative: false },
  { command: 'brightnessKeyRelative', label: 'Relative key-press brightness', relative: true },
  { command: 'brightnessBothSet', label: 'Set both brightnesses', relative: false },
  { command: 'brightnessBothRelative', label: 'Relative both brightnesses', relative: true },
  { command: 'restoreAll', label: 'Restore all configured LED settings', relative: false },
  { command: 'commonPresetSet', label: 'Set common brightness preset', relative: false },
  { command: 'commonPresetRelative', label: 'Relative common brightness preset', relative: true },
  { command: 'commonPresetToggle', label: 'Toggle preset on/off', relative: false },
] as const;
export type LedCommand = typeof LED_COMMANDS[number]['command'];
export type LedValue = number | 'asConfigured';
export const COMMON_PRESET_LABELS = ['Both as configured', 'Layers dim, keys bright', 'Layers and keys dim', 'Layers off, keys dim', 'Both off'] as const;
export const BRIGHTNESS_LABELS = ['Force off', 'Force dim', 'Force bright'] as const;
export function ledCommandCode(command: LedCommand): number {
  return LED_COMMANDS.findIndex((c) => c.command === command);
}
export function ledValueOptions(command: LedCommand): Array<{ value: LedValue; label: string }> {
  const code = ledCommandCode(command);
  const labels = code === 0 ? RAINBOW_PHASE_LABELS
    : code === 2 ? RAINBOW_SPEED_LABELS : code === 11 || code === 13 ? COMMON_PRESET_LABELS : BRIGHTNESS_LABELS;
  const options: Array<{ value: LedValue; label: string }> = labels.map((label, value) => ({ value, label }));
  if (code === 13) return options.slice(1);
  if (code !== 11) options.push({ value: 'asConfigured', label: 'As configured' });
  return options;
}
export function ledProblem(command: LedCommand, value: LedValue): string | null {
  const code = ledCommandCode(command);
  if (code < 0) return 'Unknown LED command.';
  if (LED_COMMANDS[code]!.relative) return typeof value === 'number' && Number.isInteger(value) && value !== 0 && value >= -7 && value <= 7 ? null : 'LED step must be a non-zero whole number from -7 to 7.';
  if (code === 10) return value === 0 ? null : 'Restore all uses value zero.';
  if (code === 13) return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4 ? null : 'Choose a brightness preset to toggle.';
  if (value === 'asConfigured' && code !== 11) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= (code < 4 ? 3 : code === 11 ? 4 : 2) ? null : 'Invalid LED setting.';
}
export function ledSummary(command: LedCommand, value: LedValue, compact = false): string {
  const code = ledCommandCode(command);
  if (code < 0) return 'Unknown LED command';
  if (code === 10) return compact ? 'LED Restore' : LED_COMMANDS[code]!.label;
  const label = compact
    ? code === 13 ? 'LED Toggle' : code >= 11 ? 'LED Preset' : ['LED Phase', 'LED Speed', 'Layer LEDs', 'Key LEDs', 'All LEDs'][code >> 1]
    : LED_COMMANDS[code]!.label;
  if (LED_COMMANDS[code]!.relative) return `${label}: ${typeof value === 'number' && value > 0 ? '+' : ''}${value}`;
  return `${label}: ${ledValueOptions(command).find((o) => o.value === value)?.label ?? '?'}`;
}
