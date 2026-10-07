# Macropad configuration image, version 10

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | `0` |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 10 |
| Header size | 9 bytes |
| Layer count | 1–5 for six keys; 1–7 for three keys |
| Action record size | 2 bytes |
| Chord record size | 3 bytes |
| Timed-action record size | 6 bytes, at most four timers |
| Palette version | 3 |
| HID transport version | 1 |

The firmware validates the version, variant, structure, action parameters, bounds,
and CRC before using an image. Ignored reserved bits and trailing unused bytes
are not checked for zero in firmware; the configurator still requires canonical
zero values for those fields. CRC covers them regardless.

This document specifies the complete v10 configuration image and its HID
configuration transport. Timed actions can run globally or on one assigned
layer, with intervals of 1–2,048 ticks of 4.096 seconds. The maximum duration is
8,388.608 seconds (2 h 19 min 48.608 s).

## Version and migration

Header byte 2 is `10`. GET_INFO advertises configuration format 10; HID transport
remains version 1. Firmware accepts only v10. It leaves older DataFlash readable
and unchanged, but physical inputs and timers remain inactive until a valid v10
profile is explicitly saved. A firmware update alone does not migrate or erase
a profile.

The configurator decodes each legacy action using its source version. Old type-9
text records remain **Type Text**, never **Consumer Hold**. Keys, encoder bindings,
chords and both timer slots are migrated. Legacy double-click bindings become
**Mouse click** with a count of two. Existing media actions remain taps; existing
scroll actions retain their axis, signed step and **Tap**/**Hold** behavior.
Strings, layer settings and editor metadata are preserved.

Before updating hardware, export a JSON/raw backup using the matching editor.
After updating, import or read the old profile and explicitly **Save to device**.
The simulator models v10-only validation and the same inactive legacy-flash state.

## JSON, drafts and migration

JSON version 10 uses an optional `timedActions` list with up to four entries;
omission means no timers. Each entry contains `ticks`, boolean `resetOnInput`,
boolean `consumeInput`, `action` and `resumeAction`. Import validates their
types and ranges; interval edits clamp to 1–2,048 ticks. Optional
`layer` is a zero-based layer index; omit it for a global timer. `ticks` must be
1–2,048. The editor provides **Run on**, **All layers** or a specific layer, and
an interval slider in 4.096-second steps with a duration label including hours
for long intervals. Layer reordering remaps timer assignments. Removing an assigned layer preserves the timer and both
actions, marks its assignment invalid, and requires explicit reassignment before
saving.

The editor reads binary formats 2–10 and JSON versions 1–10. V7–v9 timer ticks
are multiplied by 32 exactly, preserving their durations, both flags and both
actions; migrated timers remain global. Earlier action migration rules remain
source-version-specific, so old text records cannot become consumer holds.

Each migrated timer needs one additional storage byte. If a valid legacy image
no longer fits, the editor preserves the complete profile, reports the precise
storage excess and blocks encoding/device saving. The user can export JSON and
explicitly reduce text, chords, timers or layers to make room. No data is
automatically dropped. Oversized JSON imports and drafts remain editable too.

V10 drafts use `universal-macropad:format-v10:` and recover v9 and older drafts
without overwriting the originals. Legacy timer conversion occurs once according
to the source version; current drafts/JSON are not scaled again. The active
editor refuses connections to older firmware and links to its frozen editor,
including the archived v9 configurator and live view. Firmware upgrades
require an explicit **Save to device** after migration to reactivate inputs.

## Header and rainbow settings

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `10` |
| 3 | Layers, startup layer, timer count | Bits 0–2: layer count minus one<br>Bits 3–5: startup layer<br>Bits 6–7: low two bits of timer count |
| 4 | **String**-pool length and timer count | Bits 0–6: used pool bytes<br>Bit 7: high bit of timer count |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: transparent black key LEDs (`0` = opaque, `1` = transparent) |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | **Chord window** and rainbow settings | Bits 0–3: chord duration in 5ms units<br>Bits 4–5: rainbow phase spacing (`00` = **0°**, `01` = **30°**, `10` = **60°**, `11` = 150°)<br>Bits 6–7: rainbow speed (`00` = **Extra fast**, `01` = **Fast**, `10` = **Slow**, `11` = **Extra slow**) |

Timer count is `(byte3 >> 6) | ((byte4 >> 7) << 2)` and must be 0–4.
Layer and startup-layer indices are zero-based. The startup layer must exist.
The chord window is 0–75ms in 5ms units; zero disables chord recognition.
A second press must arrive strictly before the window expires to activate a
mapped chord. The old auto-sleep experiment is not part of v10.

**Rainbow** phase settings use hue increments `0`, `21`, `42`, and `109` in a
256-step cycle. Three-key positions are `0, 1, 2`; six-key positions are
`0, 1, 2, 5, 4, 3`, preserving the physical perimeter order
`1 → 2 → 3 → 6 → 5 → 4`. Each LED's hue is the shared hue plus its position
times the selected increment, modulo 256. A **0°** setting makes all LEDs identical.
The 150° “Scattered colors” preset starts at approximately 153° (109 hue steps)
and adds independent forward drift: LEDs 1–6 gain one extra hue step every
4, 32, 8, 64, 16, and 128 rainbow frames respectively. This alternates
fast/slow/fast on the top row and slow/fast/slow on the bottom row. Three-key
boards use intervals of 4, 16, and 8 frames (fast/slow/fast). Drift applies only to this preset; other spacing options
keep fixed relative phases. Drift follows the selected animation speed, advances
with rainbow frames, and resets with the base hue on configuration application or
USB reset. Color previews use the saved spacing preset, including its drift.
This is deterministic motion rather than random sampling.

The frame interval is independent of phase spacing:

| Speed bits | Setting | Hue step interval | Full 256-step cycle |
| --- | --- | --- | --- |
| `00` | **Extra fast** | 4ms | 1.024 s |
| `01` | **Fast** (default) | 6ms | 1.536 s |
| `10` | **Slow** | 10ms | 2.560 s |
| `11` | **Extra slow** | 18ms | 4.608 s |

The starter profile and bundled JSON profiles encode **Fast** as `01`. JSON exports
use `rainbowSpeed` with values `extra fast`, `fast`, `slow`, or `extra slow`; older files
and drafts missing this field migrate to **Fast**. Previous experimental JSON speed
names (`double`, `normal`, `half`, `quarter`) are accepted at the same indices. Binary formats 2–4 also migrate
to **Fast**. Legacy v5 binary images with zero speed bits select **Extra fast**, including images
from before speed was introduced; this ambiguity is preserved during migration.

Spacing applies to every layer's rainbow indication, including timed and blinking
indications. Solid colors and pressed-key overrides retain their existing behavior.
Hardware color previews use the saved profile's phase spacing and speed; save an edited
setting before previewing it. Bits 0–3 still control chords independently.

Version 10 JSON exports use `rainbowPhaseDegrees` with values `0`, `30`, `60`, or
`150`; this field is required in JSON versions 5–8. The starter profile and bundled
JSON profiles default to `60`. Imports accept the previous `120` value as an alias
for `150`, preserving the fourth spacing preset. Existing binary profiles retain
index 3, which now selects 150°. Older JSON files and drafts missing the setting
migrate to the same default.

## CRC

| CRC16-CCITT-FALSE setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | None |
| Final XOR | `0x0000` |
| Covered bytes, in order | 0–5, then 8–127 (skip the stored CRC at 6–7) |

## Layers and LED behavior

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
| 0 | Layer-indicator brightness | `0` = dimmed, `1` = full brightness; applies in **On for 1.5 seconds**, **Blink by layer number**, and **Always on** modes |
| 1 | Encoder-hold bootloader entry | `0` = disabled, `1` = enabled |
| 2–3 | Layer-selection LED behavior | `0` = **Do not indicate**, `1` = **On for 1.5 seconds**, `2` = **Blink by layer number**, `3` = **Always on** |
| 4–7 | Layer-indicator color | Palette index 0–15 |

Holding the encoder button while powering up always enters the bootloader;
this recovery gesture is not configurable. In **Always on** mode, idle keys use the
indicator color at the brightness selected by bit 0. Pressed keys normally use
their per-key color at full brightness. With header byte 5 bit 7 set, a pressed
key whose color is index 15 (**Off**) instead displays its idle background,
including dimming and animated **Rainbow**. Without an always-on background it is dark.

**On for 1.5 seconds** displays the indicator continuously after a layer change.
**Blink by layer number** displays one blink per one-based layer number, with
250ms lit and 250ms dark phases. Both indications override all pressed-key
colors throughout the animation; dark blink phases are fully dark. Each new
layer change replaces the previous animation. Timing uses 2ms ticks, so the
first phase can be up to 1ms shorter than its nominal duration.

Indicator color index 15 means animated **Rainbow** in **Always on**, **On for 1.5
seconds**, and **Blink by layer number** modes, at the selected brightness. Numbered
blinks alternate between animated **Rainbow** and fully dark phases. Per-key index
15 remains **Off**; the global flag only
changes whether it obscures an idle background. USB color preview retains its
separate solid-**Off** versus **Rainbow** selection.

## Chords and shared string pool

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

| **String**-pool property | Encoding |
| --- | --- |
| Location | Immediately after the last timed action (or last chord when no timers exist) |
| Used length | Header byte 4 bits 0–6 |
| **String** encoding | Zero-terminated printable US ASCII (`0x20`–`0x7E`), tab (`0x09`), or LF (`0x0A`) |
| Action offset | Zero-based byte offset from the start of the pool; must point to a string start |

## Action records

| Action byte | Field | Encoding |
| --- | --- | --- |
| 0, bits 0–3 | Type | Action code in the table below |
| 0, bits 4–7 | Auxiliary data | Meaning depends on action type |
| 1 | Parameter | Meaning depends on action type |

The action types are:

| Type | Action | Auxiliary data | Parameter |
| --- | --- | --- | --- |
| 0 | **Nothing** | `0` | `0` |
| 0 | **Type Text** (full first byte `0x10`) | `1` | **String**-pool offset |
| 1 | **Keyboard tap** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage |
| 2 | **Keyboard hold** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage; button release ends the hold |
| 3 | **Mouse click** | **Click count** minus one (`0`–`15` = 1–16 clicks) | Button mask 1–7 |
| 4 | Reserved | Rejected | Rejected |
| 5 | **Mouse hold** | `0` | Button mask 1–7 |
| 6 | **Mouse toggle** | `0` | Button mask 1–7 |
| 7 | **Scroll Tap** / **Scroll Hold** | Bit 2 (`4`) selects hold; bit 3 (`8`) selects horizontal; values `0`, `4`, `8`, `12` | Signed 8-bit wheel delta from -127 to +127; firmware sends one-count reports in the requested direction |
| 8 | **Consumer tap** | High four bits of the usage | Low eight bits of the usage |
| 9 | **Consumer hold** | High four bits of the usage | Low eight bits of the usage; button release ends the hold |
| A | **Set layer** | `0` for persistent; `1` for one-shot | Layer index, or `0xFF` for previous persistent layer |
| B | **Momentary layer** | `0` | Layer index |
| C | **Relative layer** | `0` for persistent; `1` for one-shot | Signed 8-bit offset from -6 to +6; added to the selected base-layer index with wraparound. `0` has no effect. |
| D | **Mouse X movement** | `0` for tap; `1` for hold | Signed 8-bit X delta from -127 to +127 |
| E | **Mouse Y movement** | `0` for tap; `1` for hold | Signed 8-bit Y delta from -127 to +127 |
| F | **LED control** | Value or signed step (see below) | Full command byte (see below) |

Keyboard modifier bits are `1` = **Ctrl**, `2` = **Shift**, `4` = **Alt**, and `8` = **GUI**;
combine them with bitwise OR. Mouse button bits are `1` = **Left**, `2` = **Right**,
and `4` = **Middle**; any nonzero combination up to `7` is valid. Consumer actions
accept nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. **Type Text** must
point to the start of a complete NULL-terminated pool string, including for
empty text. Type 0 auxiliary values other than 0 and 1 reject.

For action A and C, auxiliary value `0` changes the selected base layer
persistently. Auxiliary value `1` makes that layer active for the next input
action, then returns to the previously selected base layer. Other auxiliary
values are invalid. These meanings are preserved when migrating old A/D records to v10 A/C.

**Set layer** parameter `0xFF` (255) selects the previous persistent base layer.
Both persistent and one-shot forms support this target; **Momentary layer**
rejects it. All other targets must be actual configured layer indices.
The editor offers **Previous layer** in persistent and one-shot target selectors,
but not **Momentary layer**. JSON retains the existing action shape with `layer: 255`.
Layer insertion, deletion, duplication and reordering preserve this reserved target.
Formats before v7 reject it rather than treating it as a real layer. Return-path
advice marks this target as history-dependent; it cannot by itself make a
previously unreachable layer reachable.

History starts at the startup layer. Actual persistent absolute/relative changes
remember the base layer being left; selecting the same base layer preserves
history. Persistent previous-layer selection swaps the current and remembered
layers, so repeated selections toggle between them. Momentary overlays and
one-shot visits/automatic returns do not update history. One-shot previous visits
the remembered layer and returns without rewriting history. A held momentary
layer retains priority over the selected base layer. During an armed one-shot
visit, a persistent selection remembers the underlying return layer rather than
the transient visit. Timed expiry and next-input actions can use this target.

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
Auxiliary values 2–15 are invalid. **Tap** and hold action encodings are unchanged
from the corresponding version 2 extension.

Rotation bindings cannot use **Keyboard hold**, **Mouse hold**, **Consumer Hold**,
**Scroll Hold**, **Momentary layer**, or X/Y movement in hold mode. Timed expiry and
next-input actions have the same restrictions.
For keyboard actions, the parameter byte is an HID key usage: `0` means no
non-modifier key, while `0x04`–`0x65` and `0x68`–`0x73` select supported keys.
With usage `0`, the modifier mask can produce a modifier-only action (particularly useful for **Keyboard hold** actions).

## LED control action F

Record byte 0 is `(value << 4) | 0xF`; byte 1 is the full command ID.
For commands `00`–`0D`, the `0xF` absolute sentinel means **As configured** (the earlier proposed `0xFF`
value occupies only four bits here). Relative values use four-bit two's complement:
`1..7` represent +1..+7 and `9..F` represent -7..-1. Zero and -8 are invalid.

| Command byte | Command | Valid auxiliary values |
| --- | --- | --- |
| `00` | **Set rainbow phase spacing** | 0=**0°**, 1=**30°**, 2=**60°**, 3=150°, F=configured |
| `01` | **Relative rainbow phase spacing** | Signed nonzero step -7..+7 |
| `02` | **Set rainbow speed** | 0=**Extra fast**, 1=**Fast**, 2=**Slow**, 3=**Extra slow**, F=configured |
| `03` | **Relative rainbow speed** | Signed nonzero step; positive is faster |
| `04` | **Set layer-indicator brightness** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `05` | **Relative layer-indicator brightness** | Signed nonzero step |
| `06` | **Set key-press brightness** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `07` | **Relative key-press brightness** | Signed nonzero step |
| `08` | **Set both brightness policies** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `09` | **Relative both brightness policies** | Signed nonzero step; step from the brighter resolved policy and set both to the result |
| `0A` | **Restore all configured LED settings** | Only 0 |
| `0B` | **Set common brightness preset** | Preset index 0..4 |
| `0C` | **Relative common brightness preset** | Signed nonzero step |
| `0D` | Toggle common brightness preset / configured | Preset index 1..4 |
| `80` | Clear temporary effect / as configured | Only 0 |
| `81` | **Bright** temporary effect: always on | Palette index, including rainbow |
| `82`–`89` | **Bright** temporary effect: blink 1–8 times | Palette index, including rainbow |
| `90` | (Reserved) | (Reserved) |
| `91` | **Dim** temporary effect: always on | Palette index, including rainbow |
| `92`–`99` | **Dim** temporary effect: blink 1–8 times | Palette index, including rainbow |

All other command IDs and payload values are rejected during image validation.
There are 405 valid firmware payloads. LED commands are legal for every binding, including
rotation, chords, and both timer actions. They execute immediately after chord/one-shot resolution,
redraw once, and queue no HID report. Holding a binding does not repeat it.
A resolved LED action consumes a one-shot layer before applying its policy.

Overrides are global across layers and reset on power-up, configuration application,
and USB reset/reconfiguration. They change neither the active image nor flash or CRC.
Phase and speed preserve current hue; changing/restoring speed rebases the frame timer.
Brightness cycles **Off** → **Dim** → **Bright** → **Off**. Before ordinary relative stepping,
configured indicator brightness resolves from the current layer and configured key
brightness resolves to **Bright**. Command `09` compares those resolved policies, applies
the step once to the brighter value, and stores that concrete result for both
brightnesses. It uses policy levels rather than instantaneous rendered RGB or
indicator visibility. **Dim** indicator / **Bright** keys with +1 becomes **Off** / **Off**;
with -1 it becomes **Dim** / **Dim**. Multiples of three also synchronize a mixed pair
even though the brighter value completes a full cycle. Earlier firmware builds
advanced the two policies independently; the updated behavior requires a firmware
update but does not change the encoding or require profile migration.
Common-preset cycling includes configured policies:

| Preset | Indicator policy | Key policy |
| --- | --- | --- |
| 0 | **As configured** | **As configured** |
| 1 | **Dim** | **As configured** |
| 2 | **Dim** | **Dim** |
| 3 | **Off** | **Dim** |
| 4 | **Off** | **Off** |

Positive common steps advance through this order, wrapping 4 → 0; negative steps
reverse it. The current position is derived from actual policies, so individual
or both-brightness commands can establish a preset. For an unmatched pair, +1 enters
preset 0 and -1 enters preset 4. Larger steps use `(delta - 1) mod 5` for positive
steps and `delta mod 5` for negative steps, with nonnegative modulo.

Toggle compares the current indicator/key policy pair with the selected preset.
If it matches, both policies become **As configured**; otherwise the preset is applied.
It compares policies, not rendered brightness, and preserves phase and speed.
There is no remembered toggle state. Other LED commands can establish or replace
the matching pair. Preset 0 is invalid for toggle because both endpoints would be
configured. The editor defaults this command to preset 3 (**Layers off, keys dim**).

Command `0D` is part of v10. It was introduced as a v6 extension; earlier v6
firmware rejects images containing it during validation.

Indicator overrides retain the saved color and visibility mode. **Off** removes
indicator animation priority, allowing key feedback. Key **Off** removes the key overlay,
allowing an always-on idle background. Both **Off** blacks out normal lighting.
**Blink** dark phases remain black; dimming retains `(component >> 4) | (component != 0)`.
Hardware preview, invalid-config feedback, and bootloader feedback bypass overrides;
preview uses saved phase/speed. Common presets restore brightness only; Restore all
also restores phase and speed.

JSON uses `{ "type": "ledControl", "command": "commonPresetRelative", "value": 1 }`.
Command names and explicit numeric IDs are defined by the entries in `webapp/src/model/ledControl.ts`:
`rainbowPhaseSet`, `rainbowPhaseRelative`, `rainbowSpeedSet`, `rainbowSpeedRelative`,
`brightnessIndicatorSet`, `brightnessIndicatorRelative`, `brightnessKeySet`,
`brightnessKeyRelative`, `brightnessBothSet`, `brightnessBothRelative`, `restoreAll`,
`commonPresetSet`, `commonPresetRelative`, `commonPresetToggle`. Absolute values are numeric indices or
`"asConfigured"`; relative values are signed numbers. Restore all uses numeric zero.
Commands 00–0D require JSON/draft version 6 or newer; temporary effects require version 7.

## Palette and starter profile

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
profile has a 40ms chord window, **60°** rainbow spacing, **Fast** rainbow speed, and no chords, timers or strings.

## Mouse clicks

**Mouse click** uses type `0x3` for every click count. The first byte is
`((clicks - 1) << 4) | 0x03`; the second byte is the mouse button mask.
For example, `[0x03, 0x01]` is one left click, `[0x13, 0x01]` is two left clicks,
and `[0xF3, 0x01]` is sixteen left clicks. Counts 1–16 require no additional
configuration bytes. Type `0x4` is reserved and rejects in v10 images.

The configurator offers **Single / Double / Custom** under **Mouse click**.
**Single** selects one click; **Double** selects two; **Custom** shows a 3–16 click-count
slider and selects three until a custom count has been remembered for that slot.
Switching to **Single** or **Double** and back restores the last custom count using the
editor's local settings memory. All modes retain the selected mouse buttons.
**Custom** also displays an estimated duration, rounded to one decimal second:
`(8 * clicks + 200 * (clicks - 1)) / 1000`. This is about 0.4 seconds for three
clicks and 3.1 seconds for sixteen, before additional transport/playback latency.
**Mouse click** is available on keys, encoder press/rotation, chords and both timer
slots; it does not need a physical release. A brief physical press plays the
complete configured sequence.

Each click is an ordinary mouse-button press followed by release. Presses last
at least 8ms, with a 200ms pause after release before the next click. USB
backpressure can lengthen these times. The host decides whether a sequence
counts as a double-click or another multiple-click gesture. Keyboard, held mouse
buttons and toggled mouse buttons retain their existing composition rules.
The sequence occupies the queued playback lane, delaying later queued actions.
Held outputs, consumer controls, and layer/LED actions use independent handling.

JSON uses `{ "type": "mouseClick", "buttons": 1, "clicks": 2 }` for a double
left click. The optional `clicks` field is an integer from 1 to 16; omission means
one click. The editor omits the field for **Single**. Legacy JSON and draft
`mouseDouble` actions migrate to `mouseClick` with `clicks: 2`, including in timer
slots. Binary formats 2–7 migrate type `0x4` the same way; their type `0x3` still
requires auxiliary zero. V8–v10 binary images reject type `0x4`, including images
from earlier v8 prototypes; their JSON exports or drafts can be imported and
saved with the new encoding.

## Action encoding examples

| Action | First byte | Second byte |
| --- | --- | --- |
| **Mouse click** | `0x03 \| ((clicks - 1) << 4)` | Mouse button mask 1–7 |
| **Nothing** | `0x00` | `0x00` |
| **Type Text** | `0x10` | Offset of a complete NULL-terminated string in the shared pool |
| **Consumer Tap** | `0x08 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Consumer Hold** | `0x09 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Scroll Tap** | `0x07` | Signed wheel step, -127–127 |
| **Scroll Hold** | `0x47` | Signed vertical wheel step, -127–127 |
| **Scroll Tap**, **Horizontal** | `0x87` | Signed horizontal step, -127–127 |
| **Scroll Hold**, **Horizontal** | `0xC7` | Signed horizontal step, -127–127 |

**Type Text** shares low-nibble type 0 with **Nothing**: auxiliary 0 is **Nothing** and must
have parameter 0; auxiliary 1 is **Type Text**. Other auxiliary values reject. Empty
text still requires a valid pool offset pointing at a NULL byte.

**Consumer Hold** occupies low-nibble type 9, directly after **Consumer Tap** (type 8).
Both retain nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. **Hold** is
allowed on keys, encoder press and chords, but rejects on wheel rotation and on
both timer action slots. It adds no configuration bytes.

**Scroll Hold** uses auxiliary bit 2 (`0x40` in the first byte). Auxiliary bit 3 (`0x80` in the first byte) selects
horizontal scrolling. Only auxiliary values 0, 4, 8 and 12 are accepted. Acceleration bits remain reserved
and reject. **Hold** rejects on rotation and both timer action slots. -128 rejects;
zero is a firmware no-op, although the editor asks for a nonzero step.

Type `0x3` encodes **Mouse click** and type `0x4` is reserved. A full first byte
of `0x10` for **Type Text** uses low-nibble type 0 with auxiliary value 1.

## Consumer ownership and release

The most recent consumer action wins, consistently for hold-over-hold and
tap-over-hold. Previous still-held usages are *not restored*. A newer tap
interrupts a hold, sends a fresh press/release, and leaves the consumer released.
Releasing an older superseded input does not release a newer owner's hold.
Consumer outputs use a shared latest-wins pending lane; an older queued tap
cannot later replace a newer pending hold. Reports already accepted by the USB
transport retain their order.

Keyboard and consumer holds retain the binding chosen at press time across
layer changes, until physical release. Releasing either chord member ends a
chord hold. A brief press still asserts and releases under USB backpressure;
releases retry until accepted. Configuration clearing releases consumer output.
USB report-generation changes reassert the winning hold. Sustained usages use
host/application repeat behavior; firmware does not synthesize repeated taps.

## Scroll axis and HID reports

The **Scroll axis** control offers **Vertical** and **Horizontal**. A clear
auxiliary bit 3 selects vertical; a set bit selects horizontal. **Scroll direction**
offers **Up**/**Down** for vertical or **Left**/**Right** for horizontal. The signed
parameter keeps its magnitude (1–127 in the editor); horizontal negative is left
and positive is right. Horizontal HID AC Pan retains the configured sign.
Host settings and applications can change the visible
scrolling direction or ignore horizontal input. Both axes support **Tap** on any
binding, including encoder rotation and timed actions, and **Hold** on keys,
encoder press and chords. Changing axes does not change step size or hold mode.

The direction hint explains that some computers invert these settings.
**Click here** opens **Scroll & click test**, with a scrollable area on both axes
and separate **Left**, **Middle**, and **Right** click counters. It warns about
unsaved edits before testing; the device continues to use its saved profile.

Mouse report ID 2 remains five USB bytes including the report ID:

| Payload byte | Field |
| --- | --- |
| 0, bits 0–2 | Mouse buttons 1–3 |
| 0, bits 3–5 | Zero padding |
| 0, bits 6–7 | Signed two-bit horizontal AC Pan, -1, 0 or +1 |
| 1 | Signed 8-bit pointer X |
| 2 | Signed 8-bit pointer Y |
| 3 | Signed 8-bit vertical wheel |

Horizontal playback sends one-count Consumer Page AC Pan reports instead of
vertical wheel counts; the other scroll axis is zero. The descriptor declares
AC Pan with logical range -1 to +1, preserving the report's existing size.
GET_REPORT and idle reports contain the held mouse buttons with both scroll
axes and pointer movement zero, so polling cannot repeat a scroll.

## Held scrolling

Initial press sends one configured step. Holding a key, chord or encoder button
repeats that step when action playback and the USB transport are idle, with at
least 100ms after the previous complete scroll step before repeating.
Step 1 produces about ten wheel counts per second while held. Each configured
step plays as individual signed unit wheel reports, so large steps can take
longer and delay later actions. Repeat eligibility is checked on the shared 8ms
pointer polling cadence, so actual spacing may be slightly longer; pointer
movement itself retains its 8ms interval. Delayed repeats do not accumulate
for a catch-up burst.
Release stops future repeats; already accepted steps finish. Multiple eligible
held scroll bindings are visited in input-index order, matching pointer holds.
Bindings survive layer changes until release. **Scroll** acceleration was investigated,
but remains disabled in v10. Reserved acceleration bits reject during validation.

## Timed actions

After the layers and sorted three-byte chords come up to four timed actions in
editor order, followed by the shared string pool. Each timer occupies six bytes:

| Offset | Meaning |
| --- | --- |
| 0 | Low eight bits of interval minus one |
| 1–2 | Expiry action, ordinary two-byte encoding |
| 3–4 | Next-input action, ordinary two-byte encoding; **Nothing** is allowed |
| 5 bits 0–2 | Scope: 0 means **All layers**; 1–7 means zero-based layer index plus one |
| 5 bits 3–5 | High three bits of interval minus one |
| 5 bit 6 | Consume the first physical input after firing |
| 5 bit 7 | Restart interval on physical input |

The interval is `(byte0 | ((byte5 & 0x38) << 5)) + 1`: 1–2,048 ticks.
One tick is 4.096 seconds. Scope must be zero or no greater than the layer count.
Every metadata bit is defined. Expiry and next-input actions must be compatible
with rotation: no action requiring physical release may be stored in either
slot. Action codes, text addressing and parameter validation are specified in the
action-record sections above.

### Runtime behavior

Global timers count regardless of the effective layer. A scoped timer counts
only on its assigned effective layer. Every actual effective-layer transition
resets all scoped timers' interval age and fractional phase, including momentary
and one-shot transitions. Selecting the already-effective layer does not reset
them; global phases are unaffected by layer changes.

Timers repeat. Key presses, encoder button presses and completed encoder detents
reset timers whose input-restart flag is set, including inactive scoped timers.
Releases, held repeats, partial encoder motion and timer-generated actions do
not constitute physical input.

Expiry arms one next-input action; repeated expiries coalesce into one pending
action. Layer transitions preserve that pending state. On the next physical
input, all armed timers run their next-input actions in record order, even if
their assigned layers are inactive. If any requests consumption, the normal
binding is skipped. Consumption works with **Nothing** too. Otherwise the normal
binding is resolved after the follow-ups, so their layer changes can affect it.
Timer actions and a consumed input leave an armed one-shot layer return intact.
Encoder-hold bootloader detection remains available for consumed presses.

Each timer retains an independent fractional byte. A carry of 256 fine ticks
advances its interval age; each fine tick is 16ms. Start/reset alignment error
is less than approximately 16ms early, separately from poll/queue delays and
oscillator drift. The byte fine clock wraps every 4.096 seconds; poll gaps must
remain below that duration.

Timer expiry is processed before physical input if both occur in one loop.
A consumed event creates no normal binding, chord participation or held action;
its release is harmless and subsequent input works normally.
Timer actions share the normal bounded action queue. A busy host can cause
outputs to be dropped under the same policy as other actions; timers do not
accumulate an unbounded backlog. Periodic firing preserves fractional phase;
input/configuration resets clear it. Configuration application and USB reset
clear pending follow-ups and restart timer state.

## Temporary LED effects

The editor groups bright and dim commands under **Set all LEDs**. Choose
**As configured**, **Always on**, or **Blink**. **Blink** exposes a 1–8 count slider.
Choose a palette swatch and **Full Brightness / Dim**; index F means **Rainbow**,
including on a layer without configured rainbow. Existing commands use **Bright**.
**Dim** sets command bit `0x10` on **Always on** or **Blink**
(`91`–`99`). **Dim** uses the existing layer-indicator color reduction for both solid
colors and rainbow; no extra record or runtime RAM bytes are required. `90` is
invalid: **As configured** remains `80` with auxiliary zero and has no brightness.
**As configured** hides color, brightness and blink-count controls and encodes auxiliary zero. JSON retains
ordinary LED-control actions with commands `effectRestore`, `effectOn`, or
`effectBlink1` through `effectBlink8`; value is the numeric palette index, not the
legacy `asConfigured` sentinel. The optional `brightness` field is `"dim"` or
`"bright"`; omitted means **Bright**. It is valid only on **Always on** and **Blink** effects.
The editor/decoder omit the **Bright** field by default, preserving existing profile
shapes and wire bytes. JSON import normalizes explicit `"bright"` to omission.

Always-on effects persist until replaced, explicitly cleared, an actual layer
change, or configuration application/USB reset. Selecting the already active
layer leaves the effect intact. Key feedback can cover an always-on effect;
blinking effects cover key feedback and include fully dark alternating phases.
Each phase lasts 250ms; when blinking finishes, normal LED rendering resumes
without replaying the layer's blink/timed indication. **Rainbow** uses the current
runtime speed and phase policies.

Clearing an effect reveals the layer's steady state under current runtime brightness
policies, without replaying its blink/timed indication. Always-on indicators resume;
blink/timed indicators remain finished until another layer selection. It does not
reset other LED overrides; use the separate **Restore all configured LED settings** command for those. Ordinary LED-control commands may
change the underlying policies while an effect persists. USB color preview and
effects share state and replace each other; physical input cancels USB preview,
but an effect persists unless its configured next-input action clears it.

Example break reminder: expiry `{type: "ledControl", command: "effectOn", value: 15}`,
next input `{type: "ledControl", command: "effectRestore", value: 0}`, consume enabled.
No extra layer is needed, and dismissal does not trigger a binding.
To turn LEDs fully off after inactivity, use the existing **Both off** brightness
preset and restore brightness on next input; effect swatches intentionally have
**Rainbow** rather than an **Off** color.

## Storage and verification

The image order is header → layers → sorted chords → timers in editor order →
shared string pool → zero padding. Section starts are:

| Section | Absolute byte offset |
| --- | --- |
| Layers | `9` |
| **Chords** | `9 + layerCount * layerSize` |
| **Timed actions** | `9 + layerCount * layerSize + chordCount * 3` |
| **String** pool | `9 + layerCount * layerSize + chordCount * 3 + timerCount * 6` |

The complete image must satisfy:

`9 + layerCount * layerSize + chordCount * 3 + timerCount * 6 + poolBytes <= 128`.

Chord count is encoded in six bits (0–63), but the capacity formula limits the
number that can actually fit. Pair indices must be valid for the hardware
variant: 0–14 for six keys, 0–2 for three keys. Pool length is encoded in seven
bits (0–127) and must fit the remaining image space. A nonempty pool must end in
NULL. **String** sharing includes keys, encoder actions, chords, expiry and next-input
bindings. All 128 bytes remain available; trailing bytes are CRC-covered.

## HID configuration protocol

The v10 configuration uses the following transport-v1 protocol. The shared
[HID transport reference](hid-v1.md) also contains historical format notes;
the v10 version and validation rules in this document apply to v10 firmware.

The USB device retains VID `0x1209` and PID `0xC55D`. Its product string is
`Universal Macropad`. Keyboard and mouse reports use IDs 1 and 2; consumer
controls use ID 5.
A separate vendor-defined Application collection uses usage page `0xFF00`,
usage `0x0001`. Report ID 3 carries 31-byte Output requests and report ID 4
carries 31-byte Input replies. The USB interrupt endpoint packet size is 32
bytes, including the report ID. WebHID passes the report ID separately.

Each request and reply payload has this layout:

| Payload byte | Meaning |
| ---: | --- |
| 0–1 | ASCII `UM` signature |
| 2 | Transport version, currently 1 |
| 3 | Opcode, echoed in the reply |
| 4 | Sequence number, echoed in the reply |
| 5 | Image offset, echoed in the reply |
| 6 | Data length, at most 23 |
| 7 | Reply status; zero in requests |
| 8–30 | Data, padded with zero |

Use one outstanding request at a time. The device accepts requests via
interrupt OUT or HID SET_REPORT(Output) on interface 0, and sends replies via
interrupt IN. SET_REPORT must include report ID 3 and exactly 32 USB bytes.
Report ID 1's two-byte keyboard LED Output is also accepted by both
delivery paths. The USB interface is report protocol HID, without boot
subclass support.

GET_INFO advertises configuration format 10, palette version 3, and
action mask `0xFFEF` (type `0x4` excluded). The maximum layer count is 5 for six keys and 7 for three
keys; image capacity is 128 bytes. The format version identifies the action map:
the mask alone cannot distinguish **Type Text** from **Consumer Hold** or determine
hold-mode support. Transport version remains 1.

| Opcode | Request | Reply data |
| ---: | --- | --- |
| 1 | `GET_INFO`, offset and length zero | `UMAC`, transport version, format version, physical variant, key count, LED count, maximum layers, image capacity, palette version, 16-bit action mask |
| 2 | `GET_STATUS`, offset and length zero | Flash-valid flag, current layer, startup layer, upload state, saturated dropped button-action count, saturated dropped rotation-action count |
| 3 | `READ_FLASH`, offset and length 1–23 | Actual DataFlash bytes |
| 4 | `READ_ACTIVE`, offset and length 1–23 | Active RAM image bytes; invalid flash means no active profile |
| 5 | `BEGIN_WRITE`, offset zero, length 3 | Data bytes: image size 128, expected CRC low byte, expected CRC high byte. Starts a new upload and discards any prior staging. |
| 6 | `WRITE_CHUNK`, next offset, length 1–23 | Copies the next sequential chunk. Identical duplicate chunks are acknowledged; conflicting or partially overlapping chunks are rejected. |
| 7 | `COMMIT_WRITE`, offset and length zero | Validates the full image and CRC, saves changed DataFlash bytes, verifies all 128 bytes, then activates the configuration. Repeated commit is safe. |
| 8 | `ABORT_WRITE`, offset and length zero | Discards staging without changing flash or the active profile. |
| 9 | `PREVIEW_COLOR`, options in offset, length zero | Overrides every LED; offset zero cancels. Empty reply. |

GET_INFO returns 14 data bytes (offsets below are relative to reply data):

| Data byte | Field | V10 value |
| --- | --- | --- |
| 0–3 | Application identity | ASCII `UMAC` |
| 4 | Transport version | `1` |
| 5 | Configuration format | `10` |
| 6 | Physical variant | `0` = six keys, `1` = three keys |
| 7 | Key count | `6` or `3` |
| 8 | LED count | `6` or `3` |
| 9 | Maximum layers | `5` or `7` |
| 10 | Image capacity | `128` |
| 11 | Palette version | `3` |
| 12–13 | Action mask | `0xFFEF`, little endian (`EF FF`) |

GET_STATUS returns six data bytes: flash-valid flag (0 or 1), current layer,
startup layer, upload state, dropped button-action count, and dropped
rotation-action count. Layer indices are zero-based and reported as zero when
there is no valid active profile. Drop counts saturate at 255.

PREVIEW_COLOR uses the offset byte as compact LED options: bits 4–7 are the
palette index, bit 0 selects full brightness, bit 2 enables preview, and bit 3
allows **Rainbow** at index 15. Bit 1 must be zero. Any nonzero options byte must
have bit 2 set. Index 15 is **Off** when bit 3 is clear. Dimming and rainbow timing
match the always-on layer indicator. Preview works even without a valid saved
profile and changes neither the active image nor flash. It remains active until
explicit cancellation or any debounced button edge / encoder state transition,
including unmapped inputs and partial encoder turns. Inputs retain their normal
actions. Configuration saves preserve preview. Preview commands do not refresh
the upload timeout. Older firmware and
builds with `ENABLE_COLOR_PREVIEW=0` reject opcode 9 as unsupported. The editor
sends one cancel command (offset zero) on every connection: success enables
preview, BAD_OPCODE disables it, and any other error leaves support unknown.
This intentionally cancels any existing preview and adds no capability bytes
to GET_INFO.

A preview start should not be automatically retried after a timeout: a physical
input may have canceled the original command before its acknowledgment was lost.
Canceling preview is safe to retry.

| Status | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unsupported transport version |
| 2 | Unsupported opcode |
| 3 | Invalid offset or length |
| 4 | Malformed packet |
| 5 | Incomplete upload |
| 6 | Invalid configuration |
| 7 | CRC mismatch |
| 8 | Reserved |
| 9 | Flash verification failure |
| 10 | Out-of-order or conflicting chunk |

Error replies have zero data length and zero data bytes. Request padding and
the request status byte must be zero. Reads ending exactly at image byte 127 are legal. GET_INFO
is the application identity check because VID/PID alone do not distinguish
this firmware from other CH55xDuino devices.

The upload state is 0 idle, 1 receiving, or 2 committed. It expires after five
seconds without a valid upload command. Bus reset, interface reconfiguration,
and ABORT_WRITE discard it. A new BEGIN_WRITE always starts over. COMMIT_WRITE
may be retried after a lost reply; a repeated successful commit does not write
flash again. After commit, the host should independently read all 128 flash
bytes and compare them with the image it sent.

For a changed image, firmware invalidates the two-byte magic, writes and checks
the body, restores the magic last, and compares the stored image byte for byte.
If a write fails, the previous active RAM configuration remains in use so the
host can retry. An interrupted save may leave invalid flash; at startup, the
device leaves keys and encoder actions inactive and blinks one red LED at 1 Hz
until a valid profile is uploaded. USB configuration access remains available.
Configuration activation releases held outputs, cancels pending actions, resets encoder state, and
suppresses inputs that remain held until they are released.

After a bus reset, an incomplete request is discarded. Configuration reports
share the input endpoint with short keyboard, mouse, and consumer reports. The
scheduler alternates them under sustained traffic so neither class can wait
indefinitely. Endpoint halt status and CLEAR_FEATURE are supported. Remote
wake-up is not advertised. HID GET_REPORT returns current keyboard, mouse
button, and consumer state; relative mouse movement is always returned as zero.
GET_IDLE and SET_IDLE support report IDs 1, 2, and 5, plus report ID 0 to set
all three idle rates. Idle rates use the standard four millisecond units, and
the scheduler sends unchanged reports when their configured interval expires.

## Builds and measurements

The production v10 measurements are:

| Hardware | Flash used / capacity | Flash spare | Paged RAM | External RAM | Stack capacity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,294 / 14,336 bytes | 42 bytes | 108 bytes | 496 bytes | 75 bytes |
| Three keys | 14,292 / 14,336 bytes | 44 bytes | 108 bytes | 487 bytes | 78 bytes |

Stack capacity is 36 bytes lower on either board than the original v9 builds:
11 bytes for timer changes and 25 bytes for flash-saving RAM placement changes.
These are linker capacities rather than measured worst-case stack use. The
completed six-key hardware sanity run observed 39 bytes used, with 36 untouched.
See the [eleven-bit timer measurements](eleven-bit-timer-findings.md) and
[v10 hardware validation](v10-hardware-validation.md) for measurement provenance.

Checked-in releases and the bundled uploader carry v10 firmware from revision
`30101c94`: [three-key](../releases/ch552-macropad-3-key-30101c94.hex) and
[six-key](../releases/ch552-macropad-6-key-30101c94.hex). Use the v10 editor with
these releases. Frozen editors remain available for older firmware, including v9.

**Mouse click**, **Mouse hold** and **Mouse toggle** also offer **Click here** to
open **Scroll & Click Test**. Each mouse button shows **Held** or **Released**
next to its click counter, so held and toggled outputs can be checked. Releases
outside the test area are tracked; leaving the browser clears the display until
another mouse event reports its current button state.
