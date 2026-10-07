# Macropad configuration image, version 2

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | `0` |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 2 |

The firmware validates an entire image before using it.

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `2` |
| 3 | Layers and startup layer | Bits 0–1: layer count minus one<br>Bits 2–3: startup layer<br>Bits 4–7: `0` |
| 4 | **String**-pool length | Number of used bytes in the string pool. |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: `0` |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | **Chord window** | Bits 0–3: duration in 5ms units<br>Bits 4–7: `0` |

| CRC16-CCITT-FALSE setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | **None** |
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
| Key LED palette indices | 18–20 | 12–13 | One nibble per key: even-numbered key in bits 0–3, odd-numbered key in bits 4–7. On three-key pads, bits 4–7 of byte 13 are `0`. |
| **Layer options** | 21 | 14 | Bit fields below |

| Layer-option bits | Meaning | Encoding |
| --- | --- | --- |
| 0 | Layer-indicator brightness | `0` = dimmed, `1` = full brightness; applies in **Blink once**, **Blink by layer number**, and **Always on** modes |
| 1 | Encoder-hold bootloader entry | `0` = disabled, `1` = enabled |
| 2–3 | Layer-selection LED behavior | `0` = **Do not indicate**, `1` = **Blink once**, `2` = **Blink by layer number**, `3` = **Always on** |
| 4–7 | Layer-indicator color | Palette index 0–15 |

Holding the encoder button while powering up always enters the bootloader;
this recovery gesture is not configurable. In **Always on** mode, unpressed keys
use the indicator color at the brightness selected by bit 0. Pressed keys use
their per-key color at full brightness. Both blink modes also use the indicator
color at the brightness selected by bit 0, overriding pressed-key colors during
each lit phase. With palette version 3 firmware,
indicator color index 15 in **Always on** mode gives idle keys a rainbow that cycles
across the keys at the selected brightness. Index 15 remains **Off** for key colors
and other indicator behaviors.

After the layers come the configured chords, each three bytes. Byte ranges
below are relative to the start of a chord.

| Byte | Field | Encoding |
| --- | --- | --- |
| 0 | Chord identifier | Bits 0–3: physical-key pair index<br>Bits 4–5: layer index<br>Bit 6: `0` (reserved)<br>Bit 7: `0` = layer-specific, `1` = global |
| 1–2 | Button action | Two-byte action encoding below |

Pair indices enumerate `(0,1)`, `(0,2)`, and so on in lexicographic order.
The layer index must identify an existing layer. A global chord applies on
every layer; its encoded layer index is retained as its home layer in the
editor. When a layer-specific chord and a global chord have the same key pair,
the layer-specific chord takes precedence on that layer. Chord identifiers are
strictly ascending. Multiple actions may share one string.

| **String**-pool property | Encoding |
| --- | --- |
| Location | Immediately after the last chord |
| Used length | Header byte 4 |
| **String** encoding | Zero-terminated printable US ASCII (`0x20`–`0x7E`), tab (`0x09`), or LF (`0x0A`) |
| Action offset | Zero-based byte offset from the start of the pool; must point to a string start |

| Action byte | Field | Encoding |
| --- | --- | --- |
| 0, bits 0–3 | Type | Action code in the table below |
| 0, bits 4–7 | Auxiliary data | Meaning depends on action type |
| 1 | Parameter | Meaning depends on action type |

The action types are:

| Type | Action | Auxiliary data | Parameter |
| --- | --- | --- | --- |
| 0 | **None** | `0` | `0` |
| 1 | **Keyboard tap** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage |
| 2 | **Keyboard hold** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage; button release ends the hold |
| 3 | **Mouse click** | `0` | Button mask 1–7 |
| 4 | **Mouse double-click** | `0` | Button mask 1–7 |
| 5 | **Mouse hold** | `0` | Button mask 1–7 |
| 6 | **Mouse toggle** | `0` | Button mask 1–7 |
| 7 | **Scroll step** | `0` | Signed 8-bit wheel delta from -127 to +127; firmware sends one-count reports in the requested direction |
| 8 | **Consumer tap** | High four bits of the usage | Low eight bits of the usage |
| 9 | **String** | `0` | **String**-pool offset |
| A | **Set layer** | `0` for persistent; `1` for one-shot | Layer index |
| B | **Momentary layer** | `0` | Layer index |
| C | Reserved | Rejected by current firmware | Rejected by current firmware |
| D | **Relative layer** | `0` for persistent; `1` for one-shot | Signed 8-bit offset from -3 to +3; added to the selected base-layer index with wraparound. `0` has no effect. |
| E | **Mouse X movement** | `0` for tap; `1` for hold | Signed 8-bit X delta from -127 to +127 |
| F | **Mouse Y movement** | `0` for tap; `1` for hold | Signed 8-bit Y delta from -127 to +127 |

For action A and D, auxiliary value `0` changes the selected base layer
persistently. Auxiliary value `1` makes that layer active for the next input
action, then returns to the previously selected base layer. Other auxiliary
values are invalid. Existing records with auxiliary value `0` retain their
meaning; this extension does not change the configuration version.

A chord-eligible press keeps the one-shot layer active through its chord window.
The resolved single-key or chord action consumes it. The selected action runs
to completion after returning, and held outputs retain their bindings until release.

For scroll, X, and Y actions, interpret the parameter as a signed 8-bit
two's-complement value. Thus `0x01`–`0x7F` mean +1 to +127, and
`0x81`–`0xFF` mean -127 to -1. `0x00` means zero movement. Reject `0x80`,
which represents -128 and is excluded so direction reversal can safely
negate any accepted delta.

For X and Y movement, auxiliary bit 0 (record byte 0, bit 4) selects hold mode.
Auxiliary value `0` sends one movement step per press or encoder detent.
Value `1` sends an initial step and repeats the delta while the input is held,
at an 8ms interval when USB is ready and queued actions have finished.
Releasing a key, the encoder button, or either chord key stops new repeats.
Held inputs retain their original bindings across layer changes, as other holds do.
Repeat reports are skipped when USB is busy; they do not accumulate for later playback.
Auxiliary values 2–15 are invalid. Existing tap records remain unchanged, and
the configuration version remains 2. Firmware predating this extension accepts
tap records but rejects hold records.

Rotation bindings cannot use **Keyboard hold**, **Mouse hold**, **Momentary layer**,
or X/Y movement in hold mode.
For keyboard actions, the parameter byte is an HID key usage: `0` means no
non-modifier key, while `0x04`–`0x65` and `0x68`–`0x73` select supported keys.
With usage `0`, the modifier mask can produce a modifier-only action (particularly useful for **Keyboard hold** actions).

Palette version 3 uses the following colors. The representative hex values are
the web editor's display colors, chosen to resemble the firmware LEDs on
screen; they are intentionally not exact conversions of the firmware RGB
values. Only palette indices are stored in the configuration image.

| Index | Firmware RGB | Representative hex | Display name | Swatch |
| --- | --- | --- | --- | --- |
| 0 | `(255, 0, 0)` | `#FF0000` | **Red** | ![Red](swatches/00.svg) |
| 1 | `(255, 22, 7)` | `#FF6B5E` | **Coral** | ![Coral](swatches/01.svg) |
| 2 | `(255, 16, 0)` | `#FF4B00` | **Orange** | ![Orange](swatches/02.svg) |
| 3 | `(255, 66, 0)` | `#FFB400` | **Amber** | ![Amber](swatches/03.svg) |
| 4 | `(255, 124, 0)` | `#FFFF00` | **Yellow** | ![Yellow](swatches/04.svg) |
| 5 | `(60, 255, 0)` | `#00FF00` | **Green** | ![Green](swatches/05.svg) |
| 6 | `(100, 200, 20)` | `#40C820` | **Leaf** | ![Leaf](swatches/06.svg) |
| 7 | `(29, 123, 67)` | `#209696` | **Teal** | ![Teal](swatches/07.svg) |
| 8 | `(0, 255, 200)` | `#00FFFF` | **Cyan** | ![Cyan](swatches/08.svg) |
| 9 | `(0, 91, 255)` | `#0040FF` | **Azure** | ![Azure](swatches/09.svg) |
| 10 | `(0, 0, 255)` | `#0000FF` | **Blue** | ![Blue](swatches/10.svg) |
| 11 | `(115, 0, 180)` | `#8000FF` | **Violet** | ![Violet](swatches/11.svg) |
| 12 | `(255, 0, 194)` | `#FF00FF` | **Magenta** | ![Magenta](swatches/12.svg) |
| 13 | `(255, 0, 72)` | `#FF0064` | **Rose** | ![Rose](swatches/13.svg) |
| 14 | `(255, 255, 255)` | `#FFFFFF` | **White** | ![White](swatches/14.svg) |
| 15 | `(0, 0, 0)` | `#000000` | **Off** | ![Off](swatches/15.svg) |

The editor's starter profile has two layers: **Mac shortcuts** followed by
**Windows shortcuts**. Six-key pads use **Undo**, **Copy**, **Paste**, **Redo**, **Cut**,
and **Select all**; three-key pads use the first three shortcuts on each layer.
The layers use persistent **White** and **Yellow** lighting respectively, and the
profile has a 40ms chord window with no chords or strings.
