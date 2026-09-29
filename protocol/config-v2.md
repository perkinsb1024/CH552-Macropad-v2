# Macropad configuration image, version 2

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | Zero |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 2 |

The firmware validates an entire image before using it.

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `2` |
| 3 | Layers and startup layer | Bits 0–1: layer count minus one<br>Bits 2–3: startup layer<br>Bits 4–7: zero |
| 4 | String-pool length | Number of used bytes in the string pool. |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: zero |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | Chord window | Bits 0–3: duration in 5 ms units<br>Bits 4–7: zero |

| CRC16-CCITT-FALSE setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | None |
| Final XOR | `0x0000` |
| Covered bytes, in order | 0–5, then 8–127 (skip the stored CRC at 6–7) |

Layers begin at image byte 9. Layer `n` starts at byte `9 + n × layer size`,
with `n` starting at zero. Byte ranges below are relative to the start of a
layer. Each binding uses the two-byte action encoding below.

| Field | Six-key bytes (22-byte layer) | Three-key bytes (15-byte layer) | Encoding |
| --- | --- | --- | --- |
| Physical-key bindings | 0–11 | 0–5 | Two bytes per key, in physical-key order |
| Encoder button binding | 12–13 | 6–7 | Two-byte action |
| Clockwise rotation binding | 14–15 | 8–9 | Two-byte action |
| Counterclockwise rotation binding | 16–17 | 10–11 | Two-byte action |
| Key LED palette indices | 18–20 | 12–13 | One nibble per key: even-numbered key in bits 0–3, odd-numbered key in bits 4–7. On three-key pads, bits 4–7 of byte 13 are zero. |
| Layer options | 21 | 14 | Bit fields below |

| Layer-option bits | Meaning | Encoding |
| --- | --- | --- |
| 0 | Idle LED brightness | `0` = dimmed, `1` = full brightness; applies in *Always on* mode |
| 1 | Encoder-hold bootloader entry | `0` = disabled, `1` = enabled |
| 2–3 | Layer-selection LED behavior | `0` = *Do not indicate*, `1` = *Blink once*, `2` = *Blink by layer number*, `3` = *Always on* |
| 4–7 | Layer-indicator color | Palette index 0–15 |

Holding the first three keys while powering up always enters the bootloader;
this recovery gesture is not configurable. In *Always on* mode, unpressed keys
use the indicator color at the brightness selected by bit 0. Pressed keys use
their per-key color at full brightness. With palette version 3 firmware,
indicator color index 15 in *Always on* mode gives idle keys a rainbow that cycles
across the keys at the selected brightness. Index 15 remains *Off* for key colors
and other indicator behaviors.

After the layers come the configured chords, each three bytes. Byte ranges
below are relative to the start of a chord.

| Byte | Field | Encoding |
| --- | --- | --- |
| 0 | Chord identifier | Bits 0–3: physical-key pair index<br>Bits 4–5: layer index<br>Bits 6–7: zero |
| 1–2 | Button action | Two-byte action encoding below |

Pair indices enumerate `(0,1)`, `(0,2)`, and so on in lexicographic order.
Chord identifiers are strictly ascending. Multiple actions may share one
string.

| String-pool property | Encoding |
| --- | --- |
| Location | Immediately after the last chord |
| Used length | Header byte 4 |
| String encoding | Zero-terminated printable US ASCII (`0x20`–`0x7E`), tab (`0x09`), or LF (`0x0A`) |
| Action offset | Zero-based byte offset from the start of the pool; must point to a string start |

| Action byte | Field | Encoding |
| --- | --- | --- |
| 0, bits 0–3 | Type | Action code in the table below |
| 0, bits 4–7 | Auxiliary data | Meaning depends on action type |
| 1 | Parameter | Meaning depends on action type |

The action types are:

| Type | Action | Auxiliary data and parameter |
| --- | --- | --- |
| 0 | None | Both zero |
| 1 | Keyboard tap | `Ctrl`/`Shift`/`Alt`/`GUI` mask; raw key usage |
| 2 | Keyboard hold | Same encoding; button release ends hold |
| 3 | Mouse click | Zero; button mask 1–7 |
| 4 | Mouse double-click | Zero; button mask 1–7 |
| 5 | Mouse hold | Zero; button mask 1–7 |
| 6 | Mouse toggle | Zero; button mask 1–7 |
| 7 | Scroll step | Zero; signed wheel-count magnitude other than -128. Firmware sends one-count reports for the requested magnitude. |
| 8 | Consumer tap | High four and low eight bits of the usage |
| 9 | String | Zero; string-pool offset |
| A | Set layer | Zero; layer index |
| B | Momentary layer | Zero; layer index |
| C | Reserved | Rejected by current firmware |
| D | Relative layer | Auxiliary zero; signed 8-bit parameter from -3 to +3. Add to the selected base-layer index and wrap by the configured layer count. Zero has no effect. |
| E | Mouse X step | Zero; signed X delta other than -128 |
| F | Mouse Y step | Zero; signed Y delta other than -128 |

Rotation bindings cannot use *Keyboard hold*, *Mouse hold*, or *Momentary layer*.
For keyboard actions, the parameter byte is an HID key usage: `0` means no
non-modifier key, while `0x04`–`0x65` and `0x68`–`0x73` select supported keys.
With usage `0`, the modifier mask can produce a modifier-only action (particularly useful for *Keyboard hold* actions).

Palette version 3 uses the following colors. The representative hex values are
the web editor's display colors, chosen to resemble the firmware LEDs on
screen; they are intentionally not exact conversions of the firmware RGB
values. Only palette indices are stored in the configuration image.

| Index | Firmware RGB | Representative hex | Display name | Swatch |
| --- | --- | --- | --- | --- |
| 0 | `(255, 0, 0)` | `#FF0000` | Red | ![Red](swatches/00.svg) |
| 1 | `(255, 22, 7)` | `#FF6B5E` | Coral | ![Coral](swatches/01.svg) |
| 2 | `(255, 16, 0)` | `#FF4B00` | Orange | ![Orange](swatches/02.svg) |
| 3 | `(255, 66, 0)` | `#FFB400` | Amber | ![Amber](swatches/03.svg) |
| 4 | `(255, 124, 0)` | `#FFFF00` | Yellow | ![Yellow](swatches/04.svg) |
| 5 | `(60, 255, 0)` | `#00FF00` | Green | ![Green](swatches/05.svg) |
| 6 | `(100, 200, 20)` | `#40C820` | Leaf | ![Leaf](swatches/06.svg) |
| 7 | `(29, 123, 67)` | `#209696` | Teal | ![Teal](swatches/07.svg) |
| 8 | `(0, 255, 200)` | `#00FFFF` | Cyan | ![Cyan](swatches/08.svg) |
| 9 | `(0, 91, 255)` | `#0040FF` | Azure | ![Azure](swatches/09.svg) |
| 10 | `(0, 0, 255)` | `#0000FF` | Blue | ![Blue](swatches/10.svg) |
| 11 | `(115, 0, 180)` | `#8000FF` | Violet | ![Violet](swatches/11.svg) |
| 12 | `(255, 0, 194)` | `#FF00FF` | Magenta | ![Magenta](swatches/12.svg) |
| 13 | `(255, 0, 72)` | `#FF0064` | Rose | ![Rose](swatches/13.svg) |
| 14 | `(255, 255, 255)` | `#FFFFFF` | White | ![White](swatches/14.svg) |
| 15 | `(0, 0, 0)` | `#000000` | Off | ![Off](swatches/15.svg) |

The editor's starter profile has two layers: *Mac shortcuts* followed by
*Windows shortcuts*. Six-key pads use *Undo*, *Copy*, *Paste*, *Redo*, *Cut*,
and *Select all*; three-key pads use the first three shortcuts on each layer.
The layers use persistent *White* and *Yellow* lighting respectively, and the
profile has a 40 ms chord window with no chords or strings.
