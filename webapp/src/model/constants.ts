/** Shared constants from protocol/config-v1.md and protocol/hid-v1.md. */

export const IMAGE_SIZE = 128;
export const FORMAT_VERSION = 1;
export const HEADER_SIZE = 9;
export const MAX_LAYERS = 4;
export const CHORD_ENTRY_SIZE = 3;
export const MAX_CHORD_WINDOW_UNITS = 15; // 5 ms units, 0–75 ms
export const CHORD_WINDOW_STEP_MS = 5;

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

export function pairCount(variant: Variant): number {
  return variant === VARIANT_THREE_KEYS ? 3 : 15;
}

export function variantName(variant: Variant): string {
  return variant === VARIANT_THREE_KEYS ? 'Three-key' : 'Six-key';
}

/** Action type codes; the numbering is part of the saved format. */
export const enum ActionCode {
  None = 0x0,
  KeyTap = 0x1,
  KeyHold = 0x2,
  MouseClick = 0x3,
  MouseDouble = 0x4,
  MouseHold = 0x5,
  MouseToggle = 0x6,
  Scroll = 0x7,
  Consumer = 0x8,
  String = 0x9,
  SetLayer = 0xa,
  MomentaryLayer = 0xb,
  ToggleLayer = 0xc,
  NextLayer = 0xd,
  MouseX = 0xe,
  MouseY = 0xf,
}

export const MOD_CTRL = 1;
export const MOD_SHIFT = 2;
export const MOD_ALT = 4;
export const MOD_GUI = 8;

export const MOUSE_LEFT = 1;
export const MOUSE_RIGHT = 2;
export const MOUSE_MIDDLE = 4;

export const LAYER_OPT_BOOTLOADER_BOOT = 0x01;
export const LAYER_OPT_BOOTLOADER_RUN = 0x02;
export const LAYER_OPT_INDICATOR_SHIFT = 2;
export const LAYER_OPT_COLOR_SHIFT = 4;

export const enum LayerIndicatorBehavior {
  None = 0,
  BlinkOnce = 1,
  BlinkByLayer = 2,
  AlwaysOn = 3,
}
