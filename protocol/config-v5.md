# Macropad configuration image, version 5

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | `0` |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 5 |

The firmware validates the version, variant, structure, action parameters, bounds,
and CRC before using an image. Ignored reserved bits and trailing unused bytes
are not checked for zero in firmware; the configurator still requires canonical
zero values for those fields. CRC covers them regardless.

Version 5 uses header byte 8 bits 4–5 for global rainbow phase spacing and
bits 6–7 for global rainbow speed. Layer capacity, action encodings, palette, and the 128-byte image size are
unchanged from version 4. Rainbow colors cycle red → blue → green → red.

The active editor reads version 2, 3, and 4 images, imports version 1–4 JSON
profiles, and recovers older drafts. Bindings, startup layers, chords, colors,
and indicator options are preserved. Rainbow spacing migrates to ~60° on both
variants, and speed to Fast when absent from older formats, JSON files, or drafts. The editor writes only version 5 binary images and version 5 JSON.
Firmware accepts only version 5 and does not migrate flash itself. After upgrading,
load and save the existing profile to activate physical inputs. Frozen editors
for formats 2, 3, and 4 remain under `versions/format-vN/`.

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `5` |
| 3 | Layers and startup layer | Bits 0–2: layer count minus one<br>Bits 3–5: startup layer<br>Bits 6–7: `0` |
| 4 | String-pool length | Number of used bytes in the string pool. |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: transparent black key LEDs (`0` = opaque, `1` = transparent) |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | Chord window and rainbow phase | Bits 0–3: chord duration in 5 ms units<br>Bits 4–5: rainbow phase spacing (`00` = 0°, `01` = ~30°, `10` = ~60°, `11` = ~120°)<br>Bits 6–7: rainbow speed (`00` = Extra fast, `01` = Fast, `10` = Slow, `11` = Extra slow) |

Rainbow phase settings use hue increments `0`, `21`, `42`, and `85` in a
256-step cycle. Three-key positions are `0, 1, 2`; six-key positions are
`0, 1, 2, 5, 4, 3`, preserving the physical perimeter order
`1 → 2 → 3 → 6 → 5 → 4`. Each LED's hue is the shared hue plus its position
times the selected increment, modulo 256. A 0° setting makes all LEDs identical.
The frame interval is independent of phase spacing:

| Speed bits | Setting | Hue step interval | Full 256-step cycle |
| --- | --- | --- | --- |
| `00` | Extra fast | 4 ms | 1.024 s |
| `01` | Fast (default) | 6 ms | 1.536 s |
| `10` | Slow | 10 ms | 2.560 s |
| `11` | Extra slow | 18 ms | 4.608 s |

The starter profile and bundled JSON profiles encode Fast as `01`. JSON exports
use `rainbowSpeed` with values `extra fast`, `fast`, `slow`, or `extra slow`; older files
and drafts missing this field migrate to Fast. Previous experimental JSON speed
names (`double`, `normal`, `half`, `quarter`) are accepted at the same indices. Binary formats 2–4 also migrate
to Fast. The configuration version remains 5: a pre-speed format 5 binary image
with `00` in bits 6–7 now selects Extra fast, indistinguishably from a newly saved
Extra fast profile. No automatic format 5 binary migration is possible.

Spacing applies to every layer's rainbow indication, including timed and blinking
indications. Solid colors and pressed-key overrides retain their existing behavior.
Hardware color previews use the saved profile's phase spacing and speed; save an edited
setting before previewing it. Bits 0–3 still control chords independently.

Version 5 JSON exports use `rainbowPhaseDegrees` with values `0`, `30`, `60`, or
`120`; this field is required in version 5 files. The starter profile and bundled
JSON profiles default to `60`. Older JSON files and drafts missing the setting
migrate to the same default.

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
| Key LED palette indices | 18–20 | 12–13 | One nibble per key: even-numbered key in bits 0–3, odd-numbered key in bits 4–7. On three-key pads, bits 4–7 of byte 13 are `0`. |
| Layer options | 21 | 14 | Bit fields below |

| Layer-option bits | Meaning | Encoding |
| --- | --- | --- |
| 0 | Layer-indicator brightness | `0` = dimmed, `1` = full brightness; applies in *On for 1.5 seconds*, *Blink by layer number*, and *Always on* modes |
| 1 | Encoder-hold bootloader entry | `0` = disabled, `1` = enabled |
| 2–3 | Layer-selection LED behavior | `0` = *Do not indicate*, `1` = *On for 1.5 seconds*, `2` = *Blink by layer number*, `3` = *Always on* |
| 4–7 | Layer-indicator color | Palette index 0–15 |

Holding the encoder button while powering up always enters the bootloader;
this recovery gesture is not configurable. In *Always on* mode, idle keys use the
indicator color at the brightness selected by bit 0. Pressed keys normally use
their per-key color at full brightness. With header byte 5 bit 7 set, a pressed
key whose color is index 15 (*Off*) instead displays its idle background,
including dimming and animated Rainbow. Without an always-on background it is dark.

*On for 1.5 seconds* displays the indicator continuously after a layer change.
*Blink by layer number* displays one blink per one-based layer number, with
250 ms lit and 250 ms dark phases. Both indications override all pressed-key
colors throughout the animation; dark blink phases are fully dark. Each new
layer change replaces the previous animation. Timing uses 2 ms ticks, so the
first phase can be up to 1 ms shorter than its nominal duration.

Indicator color index 15 means animated Rainbow in *Always on*, *On for 1.5
seconds*, and *Blink by layer number* modes, at the selected brightness. Numbered
blinks alternate between animated Rainbow and fully dark phases. Per-key index
15 remains *Off*; the global flag only
changes whether it obscures an idle background. USB color preview retains its
separate solid-Off versus Rainbow selection.

After the layers come the configured chords, each three bytes. Byte ranges
below are relative to the start of a chord.

| Byte | Field | Encoding |
| --- | --- | --- |
| 0 | Chord identifier | Bits 0–3: physical-key pair index<br>Bits 4–6: layer index<br>Bit 7: `0` = layer-specific, `1` = global |
| 1–2 | Button action | Two-byte action encoding below |

Pair indices enumerate `(0,1)`, `(0,2)`, and so on in lexicographic order.
The layer index must identify an existing layer. A global chord applies on
every layer; its encoded layer index is retained as its home layer in the
editor. When a layer-specific chord and a global chord have the same key pair,
the layer-specific chord takes precedence on that layer. Chord identifiers are
strictly ascending. Multiple actions may share one string.

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

| Type | Action | Auxiliary data | Parameter |
| --- | --- | --- | --- |
| 0 | None | `0` | `0` |
| 1 | Keyboard tap | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage |
| 2 | Keyboard hold | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage; button release ends the hold |
| 3 | Mouse click | `0` | Button mask 1–7 |
| 4 | Mouse double-click | `0` | Button mask 1–7 |
| 5 | Mouse hold | `0` | Button mask 1–7 |
| 6 | Mouse toggle | `0` | Button mask 1–7 |
| 7 | Scroll step | `0` | Signed 8-bit wheel delta from -127 to +127; firmware sends one-count reports in the requested direction |
| 8 | Consumer tap | High four bits of the usage | Low eight bits of the usage |
| 9 | String | `0` | String-pool offset |
| A | Set layer | `0` for persistent; `1` for one-shot | Layer index |
| B | Momentary layer | `0` | Layer index |
| C | Reserved | Rejected by current firmware | Rejected by current firmware |
| D | Relative layer | `0` for persistent; `1` for one-shot | Signed 8-bit offset from -6 to +6; added to the selected base-layer index with wraparound. `0` has no effect. |
| E | Mouse X movement | `0` for tap; `1` for hold | Signed 8-bit X delta from -127 to +127 |
| F | Mouse Y movement | `0` for tap; `1` for hold | Signed 8-bit Y delta from -127 to +127 |

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
at an 8 ms interval when USB is ready and queued actions have finished.
Releasing a key, the encoder button, or either chord key stops new repeats.
Held inputs retain their original bindings across layer changes, as other holds do.
Repeat reports are skipped when USB is busy; they do not accumulate for later playback.
Auxiliary values 2–15 are invalid. Tap and hold action encodings are unchanged
from the corresponding version 2 extension.

Rotation bindings cannot use *Keyboard hold*, *Mouse hold*, *Momentary layer*,
or X/Y movement in hold mode.
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
profile has a 40 ms chord window, ~60° rainbow spacing, Fast rainbow speed, and no chords or strings.
