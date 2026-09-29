# Macropad configuration image, version 2

The firmware uses one 128-byte image. All unused bytes are zero. Multibyte
values are little endian. Byte offsets and action codes are fixed for version 2.
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

The CRC uses polynomial `0x1021`, initial value `0xFFFF`, no reflection, and
final XOR zero. It covers bytes 0–5 and 8–127 in that order.

Each layer occupies 22 bytes for six keys or 15 bytes for three keys, beginning
at byte 9. A layer contains a two-byte binding for each physical key, then the
encoder button, clockwise rotation, and counterclockwise rotation. LED palette
indices follow, packed with the even key in the low nibble. The last byte has
bit 0 = full brightness for idle LEDs in Always on mode, bit 1 = bootloader from
encoder hold, bits 2–3 = layer-selection LED behavior (0 = none, 1 = blink
once, 2 = blink once per layer number, 3 = always on), and bits
4–7 = palette index for the layer-indicator color. Holding the first three keys
while powering up always enters the bootloader; this recovery gesture is not
configurable. In Always on mode, unpressed keys use a dimmed indicator color
when bit 0 is clear or full brightness when it is set. Pressed keys use their
per-key color at full brightness. With palette version 3 firmware, indicator
color index 15 in Always on mode gives idle keys a rainbow that cycles across
the keys at the selected brightness. Index 15 remains Off for key colors and
other indicator behaviors. The unused high LED nibble for three keys is zero.

After the layers come the configured chords, each three bytes. The first byte
holds a physical-key pair index in bits 0–3 and a layer index in bits 4–5.
Pair indices enumerate `(0,1)`, `(0,2)`, and so on in lexicographic order.
Chord identifiers are strictly ascending. The remaining two bytes are the
chord's button action. The string pool immediately follows the chords. Strings
are zero-terminated printable US ASCII, tab, or LF; action offsets must point
to a string start. Multiple actions may share one string.

Action byte 0 holds a type in the low nibble and auxiliary data in the high
nibble. Byte 1 holds the parameter. The types are:

| Type | Action | Auxiliary data and parameter |
| --- | --- | --- |
| 0 | None | Both zero |
| 1 | Keyboard tap | Ctrl/Shift/Alt/GUI mask; raw key usage |
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
| D | Next layer | Both zero |
| E | Mouse X step | Zero; signed X delta other than -128 |
| F | Mouse Y step | Zero; signed Y delta other than -128 |

Rotation bindings cannot use keyboard hold, mouse hold, or momentary layer.
Keyboard usages are zero or supported non-modifier HID usages `0x04`–`0x65`
and `0x68`–`0x73`. A zero usage permits modifier-only actions. Palette version 3
uses these firmware RGB triplets by index: (255,0,0), (255,22,7), (255,16,0),
(255,66,0), (255,124,0), (60,255,0), (100,200,20), (29,123,67),
(0,255,200), (0,91,255), (0,0,255), (115,0,180), (255,0,194),
(255,0,72), (255,255,255), and (0,0,0) (Off). The web editor uses separate
hex colors chosen to make its on-screen swatches look as close as possible to
the corresponding firmware colors; those display hex values are intentionally
not exact conversions of the firmware RGB values. Only palette indices are
stored in the configuration image.

The editor's starter profile has two layers: Mac shortcuts followed by Windows
shortcuts. Six-key pads use Undo, Copy, Paste, Redo, Cut, and Select all; three-
key pads use the first three shortcuts on each layer. The layers use persistent
white and yellow lighting respectively, and the profile has a 40 ms chord
window with no chords or strings.
