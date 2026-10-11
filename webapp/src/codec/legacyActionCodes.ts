/** Published v11–v13 numbering, also used after normalizing earlier formats. */
export const enum ActionCode {
  Macro = 0xf,
  Pause = 0x20,
  None = 0x0,
  KeyTap = 0x1,
  KeyHold = 0x2,
  MouseClick = 0x3,
  ConsumerModified = 0x4,
  MouseHold = 0x35,
  MouseToggle = 0x5,
  MouseDown = 0x15,
  MouseUp = 0x25,
  Scroll = 0x6,
  Consumer = 0x7,
  ConsumerHold = 0x8,
  String = 0x10, // Full first byte: type None with auxiliary 1.
  SetLayer = 0x9,
  MomentaryLayer = 0xa,
  RelativeLayer = 0xb,
  MouseAxis = 0xc,
  MouseXY = 0xd,
  LedControl = 0xe,
}
