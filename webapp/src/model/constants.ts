/** Current firmware layout and shared HID transport constants. */

export const IMAGE_SIZE = 128;
export const FORMAT_VERSION = 16;
export const PREVIOUS_LAYER = 0xff;
export const HEADER_SIZE = 9;
export function maxLayers(variant: Variant): number {
  return variant === VARIANT_THREE_KEYS ? 7 : 5;
}
export const CHORD_ENTRY_SIZE = 3;
export const MAX_TIMED_ACTIONS = 4;
export const MAX_TIMED_TICKS = 2048;
export const TIMED_ENTRY_SIZE = 6;
export const TIMED_TICK_SECONDS = 4.096;
export const HEADER_MARKER = 0x42; // B, for board
export const MAX_CHORD_WINDOW_UNITS = 18; // Editor stores 5ms units; 4, 6, …, 18 encode 20ms–90ms.
export const CHORD_WINDOW_STEP_MS = 5;
export const RAINBOW_PHASE_DEGREES = [0, 30, 60, 150] as const;
export const RAINBOW_PHASE_LABELS = ['0°', '30°', '60°', 'Variable'] as const;
export const DEFAULT_RAINBOW_PHASE = 2;
export const HEADER_RAINBOW_PHASE_SHIFT = 4;
export const RAINBOW_SPEED_LABELS = ['Extra Fast', 'Fast', 'Slow', 'Extra Slow'] as const;
export const RAINBOW_SPEED_FRAME_MS = [4, 6, 10, 18] as const;
export const DEFAULT_RAINBOW_SPEED = 1;
export const HEADER_RAINBOW_SPEED_SHIFT = 6;

export const USB_VENDOR_ID = 0x1209;
export const USB_PRODUCT_ID = 0xc55d;
export const HID_USAGE_PAGE = 0xff00;
export const HID_USAGE = 0x0001;
export const REPORT_ID_REQUEST = 3;
export const REPORT_ID_REPLY = 4;
export const PAYLOAD_SIZE = 31;
export const MAX_CHUNK = 23;

export type Variant = 0 | 1;
export const VARIANT_SIX_KEYS: Variant = 0;
export const VARIANT_THREE_KEYS: Variant = 1;

export function keyCount(variant: Variant): number {
  return variant === VARIANT_THREE_KEYS ? 3 : 6;
}

export function layerSize(variant: Variant): number {
  return variant === VARIANT_THREE_KEYS ? 15 : 22;
}

export function layerPaletteSize(variant: Variant): number {
  return Math.ceil(keyCount(variant) / 2);
}

export function pairCount(variant: Variant): number {
  return variant === VARIANT_THREE_KEYS ? 3 : 15;
}

export function variantName(variant: Variant): string {
  return variant === VARIANT_THREE_KEYS ? 'Three-Key' : 'Six-Key';
}

/** Action type codes; the numbering is part of the saved format. */
export const enum ActionCode {
  None = 0x0,
  Pause = 0x10,
  String = 0x20, // Full first byte: type None with auxiliary 2.
  KeyTap = 0x1,
  KeyHold = 0x2,
  MouseClick = 0x3,
  MouseToggle = 0x4,
  MouseDown = 0x14,
  MouseUp = 0x24,
  MouseHold = 0x34,
  Scroll = 0x5,
  MouseAxis = 0x6,
  MouseXY = 0x7,
  Consumer = 0x8,
  ConsumerHold = 0x9,
  ConsumerModified = 0xa,
  ConsumerModifiedHold = 0xb,
  SetLayer = 0xc,
  MomentaryLayer = 0x2c,
  RelativeLayer = 0x4c,
  MomentaryRelativeLayer = 0x6c,
  LedControl = 0xd,
  Macro = 0xe,
}

export const MOD_CTRL = 1;
export const MOD_SHIFT = 2;
export const MOD_ALT = 4;
export const MOD_GUI = 8;

export const MOUSE_LEFT = 1;
export const MOUSE_RIGHT = 2;
export const MOUSE_MIDDLE = 4;
/** UI order and HID bit positions; neither is DOM MouseEvent.button order. */
export const MOUSE_BUTTONS = [
  { bit: MOUSE_LEFT, label: 'Left', domButton: 0 },
  { bit: MOUSE_MIDDLE, label: 'Middle', domButton: 1 },
  { bit: MOUSE_RIGHT, label: 'Right', domButton: 2 },
  ...Array.from({ length: 5 }, (_, i) => ({ bit: 1 << (i + 3), label: `Button ${i + 4}`, domButton: i + 3 })),
] as const;

export const LAYER_OPT_FULL_BRIGHTNESS = 0x01;
export const LAYER_OPT_AUTO_SLEEP = 0x02;
export const LAYER_OPT_INDICATOR_SHIFT = 2;
export const LAYER_OPT_COLOR_SHIFT = 4;

export const enum LayerIndicatorBehavior {
  None = 0,
  TimedOn = 1,
  BlinkByLayer = 2,
  AlwaysOn = 3,
}

export const SLEEP_TIMEOUT_MINUTES = [15, 30, 60, 120] as const;
export const SLEEP_TIMEOUT_LABELS = ['15 Minutes', '30 Minutes', '1 Hour', '2 Hours'] as const;
