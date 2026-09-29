# Macropad configuration image, version 1

The firmware uses one 128-byte image. All unused bytes are zero. Multibyte
values are little endian. Byte offsets and action codes are fixed for version 1.
The firmware validates an entire image before using it.

Bytes 0–1 are ASCII `MP`; byte 2 is version 1. Byte 3 holds layer count minus
one in bits 0–1 and startup layer in bits 2–3. Byte 4 is the used string-pool
length. Byte 5 holds the physical variant in bit 0 (six keys = 0, three keys =
1) and the chord count in bits 1–6. Byte 8 holds the chord window in 5 ms units
in its low nibble. All reserved bits are zero. Bytes 6–7 are CRC16-CCITT-FALSE:
polynomial `0x1021`, initial value `0xFFFF`, no reflection, final XOR zero.
The CRC covers bytes 0–5 and 8–127 in that order; its low byte is stored first.

Each layer occupies 22 bytes for six keys or 15 bytes for three keys, beginning
at byte 9. A layer contains a two-byte binding for each physical key, then the
encoder button, clockwise rotation, and counterclockwise rotation. LED palette
indices follow, packed with the even key in the low nibble. The last byte has
bit 0 reserved for future use and required to be zero, bit 1 = bootloader from
encoder hold, bits 2–3 = layer-selection LED behavior (0 = none, 1 = blink
once, 2 = blink once per layer number, 3 = dim background always on), and bits
4–7 = palette index for the layer-indicator color. Holding the first three keys
while powering up always enters the bootloader; this recovery gesture is not
configurable. In dim-background mode, unpressed keys use a dimmed indicator
color and pressed keys use their per-key color at full brightness. The unused
high LED nibble for three keys is zero.

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
| C | Toggle layer | Zero; layer index |
| D | Next layer | Both zero |
| E | Mouse X step | Zero; signed X delta other than -128 |
| F | Mouse Y step | Zero; signed Y delta other than -128 |

Rotation bindings cannot use keyboard hold, mouse hold, or momentary layer.
Keyboard usages are zero or supported non-modifier HID usages `0x04`–`0x65`
and `0x68`–`0x73`. A zero usage permits modifier-only actions. The initial
palette indices are RGB: `#FF2020`, `#40C820`, `#209696`, `#FF4B00`,
`#0040FF`, `#FF0064`, `#000000`, `#FFFFFF`, `#FFB400`, `#FFFF00`,
`#00FF00`, `#00FFFF`, `#0000FF`, `#8000FF`, `#FF00FF`, `#808080`.

The editor's six-key starter profile begins `4D 50 01 00 00 00 4A 86 08`.
The three-key starter profile begins `4D 50 01 00 00 01 65 F0 08`. They use
one layer, a 40 ms chord window, and no chords or strings.
