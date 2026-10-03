import { PALETTE } from './palette';
import { RAINBOW_PHASE_LABELS, RAINBOW_SPEED_LABELS } from './constants';

export const LED_COMMANDS = [
  { code: 0x00, command: 'rainbowPhaseSet', label: 'Set rainbow phase spacing', relative: false },
  { code: 0x01, command: 'rainbowPhaseRelative', label: 'Relative rainbow phase spacing', relative: true },
  { code: 0x02, command: 'rainbowSpeedSet', label: 'Set rainbow speed', relative: false },
  { code: 0x03, command: 'rainbowSpeedRelative', label: 'Relative rainbow speed', relative: true },
  { code: 0x04, command: 'brightnessIndicatorSet', label: 'Set layer-indicator brightness', relative: false },
  { code: 0x05, command: 'brightnessIndicatorRelative', label: 'Relative layer-indicator brightness', relative: true },
  { code: 0x06, command: 'brightnessKeySet', label: 'Set key-press brightness', relative: false },
  { code: 0x07, command: 'brightnessKeyRelative', label: 'Relative key-press brightness', relative: true },
  { code: 0x08, command: 'brightnessBothSet', label: 'Set both brightnesses', relative: false },
  { code: 0x09, command: 'brightnessBothRelative', label: 'Relative both brightnesses', relative: true },
  { code: 0x0a, command: 'restoreAll', label: 'Restore all configured LED settings', relative: false },
  { code: 0x0b, command: 'commonPresetSet', label: 'Set common brightness preset', relative: false },
  { code: 0x0c, command: 'commonPresetRelative', label: 'Relative common brightness preset', relative: true },
  { code: 0x0d, command: 'commonPresetToggle', label: 'Toggle preset on/off', relative: false },
  { code: 0x80, command: 'effectRestore', label: 'As configured', relative: false },
  { code: 0x81, command: 'effectOn', label: 'Always on', relative: false },
  { code: 0x82, command: 'effectBlink1', label: 'Blink 1 time', relative: false },
  { code: 0x83, command: 'effectBlink2', label: 'Blink 2 times', relative: false },
  { code: 0x84, command: 'effectBlink3', label: 'Blink 3 times', relative: false },
  { code: 0x85, command: 'effectBlink4', label: 'Blink 4 times', relative: false },
  { code: 0x86, command: 'effectBlink5', label: 'Blink 5 times', relative: false },
  { code: 0x87, command: 'effectBlink6', label: 'Blink 6 times', relative: false },
  { code: 0x88, command: 'effectBlink7', label: 'Blink 7 times', relative: false },
  { code: 0x89, command: 'effectBlink8', label: 'Blink 8 times', relative: false },
] as const;
export type LedCommand = typeof LED_COMMANDS[number]['command'];
export type LedValue = number | 'asConfigured';
export type LedBrightness = 'bright' | 'dim';
export const LED_EFFECT_DIM = 0x10;
export const COMMON_PRESET_LABELS = ['Both as configured', 'Layers dim, keys bright', 'Layers and keys dim', 'Layers off, keys dim', 'Both off'] as const;
export const BRIGHTNESS_LABELS = ['Force off', 'Force dim', 'Force bright'] as const;
export function ledCommandCode(command: LedCommand, brightness?: LedBrightness): number {
  const code = ledCommandSpec(command)?.code ?? -1;
  return code >= 0x81 && brightness === 'dim' ? code | LED_EFFECT_DIM : code;
}
export function ledCommandSpec(command: LedCommand) {
  return LED_COMMANDS.find((c) => c.command === command);
}
export function ledCommandFromCode(code: number) {
  if (code >= 0x91 && code <= 0x99) code &= ~LED_EFFECT_DIM;
  return LED_COMMANDS.find((c) => c.code === code);
}
export function isLedEffect(command: LedCommand): boolean {
  return ledCommandCode(command) >= 0x80;
}
export function ledValueOptions(command: LedCommand): Array<{ value: LedValue; label: string }> {
  const code = ledCommandCode(command);
  if (code === 0x80) return [{ value: 0, label: 'As configured' }];
  if (code >= 0x81) return PALETTE.map(c => ({ value: c.index, label: c.index === 15 ? 'Rainbow' : c.name }));
  const labels = code === 0 ? RAINBOW_PHASE_LABELS
    : code === 2 ? RAINBOW_SPEED_LABELS : code === 11 || code === 13 ? COMMON_PRESET_LABELS : BRIGHTNESS_LABELS;
  const options: Array<{ value: LedValue; label: string }> = labels.map((label, value) => ({ value, label }));
  if (code === 13) return options.slice(1);
  if (code !== 11) options.push({ value: 'asConfigured', label: 'As configured' });
  return options;
}
export function ledProblem(command: LedCommand, value: LedValue, brightness?: LedBrightness): string | null {
  const code = ledCommandCode(command);
  if (code < 0) return 'Unknown LED command.';
  if (brightness !== undefined) {
    if (brightness !== 'bright' && brightness !== 'dim') return 'Choose Bright or Dim effect brightness.';
    if (code < 0x81) return 'Brightness applies only to Always on or Blink effects.';
  }
  if (code === 0x80) return value === 0 ? null : 'Effect restore uses value zero.';
  if (code >= 0x81) return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15 ? null : 'Choose an effect color.';
  if (ledCommandSpec(command)!.relative) return typeof value === 'number' && Number.isInteger(value) && value !== 0 && value >= -7 && value <= 7 ? null : 'LED step must be a non-zero whole number from -7 to 7.';
  if (code === 10) return value === 0 ? null : 'Restore all uses value zero.';
  if (code === 13) return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4 ? null : 'Choose a brightness preset to toggle.';
  if (value === 'asConfigured' && code !== 11) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= (code < 4 ? 3 : code === 11 ? 4 : 2) ? null : 'Invalid LED setting.';
}
export function ledSummary(command: LedCommand, value: LedValue, compact = false, brightness?: LedBrightness): string {
  const code = ledCommandCode(command);
  if (code < 0) return 'Unknown LED command';
  if (code >= 0x80) return code === 0x80 ? 'All LEDs: As configured'
    : `All LEDs: ${value === 15 ? 'Rainbow' : PALETTE[Number(value)]?.name ?? '?'} · ${brightness === 'dim' ? 'Dim · ' : ''}${ledCommandSpec(command)!.label}`;
  if (code === 10) return compact ? 'LED Restore' : ledCommandSpec(command)!.label;
  const label = compact
    ? code === 13 ? 'LED Toggle' : code >= 11 ? 'LED Preset' : ['LED Phase', 'LED Speed', 'Layer LEDs', 'Key LEDs', 'All LEDs'][code >> 1]
    : ledCommandSpec(command)!.label;
  if (ledCommandSpec(command)!.relative) return `${label}: ${typeof value === 'number' && value > 0 ? '+' : ''}${value}`;
  return `${label}: ${ledValueOptions(command).find((o) => o.value === value)?.label ?? '?'}`;
}
