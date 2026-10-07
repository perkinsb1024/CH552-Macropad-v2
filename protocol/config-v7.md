# Macropad configuration image, version 7

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | `0` |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 7 |

The firmware validates the version, variant, structure, action parameters, bounds,
and CRC before using an image. Ignored reserved bits and trailing unused bytes
are not checked for zero in firmware; the configurator still requires canonical
zero values for those fields. CRC covers them regardless.

Version 7 retains the v6 palette, layer geometry, action map, and 128-byte image.
It adds four repeating timed actions, optional next-input actions and consumption,
and temporary bright/dim LED effects, plus a **Previous layer** target. No additional configuration byte is
reserved for flags. All v7 work before this format was finalized was unpublished.

The editor writes v7 and reads binary formats 2–7 and JSON versions 1–7. Released
v6 profiles migrate without changing bindings, colors, rainbow settings, strings,
chords, or local metadata, and without adding timers. Original v6 drafts and
files remain intact. Firmware accepts v6 directly as a profile with no timers;
a firmware update therefore does not require erasing configuration. Saving from
the v7 editor writes the migrated format and resets runtime timer/LED state.
Firmware itself does not rewrite DataFlash on startup. Formats before v6 are
migrated by the browser; firmware physical inputs require a valid v6/v7 image.
GET_INFO advertises v7; HID transport remains v1. Firmware for formats 2–6 is
routed to frozen matching editors under `versions/format-vN/`.

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `7` |
| 3 | Layers, startup layer, timer count | Bits 0–2: layer count minus one<br>Bits 3–5: startup layer<br>Bits 6–7: low two bits of timer count |
| 4 | **String**-pool length and timer count | Bits 0–6: used pool bytes<br>Bit 7: high bit of timer count |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: transparent black key LEDs (`0` = opaque, `1` = transparent) |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | **Chord window** and rainbow settings | Bits 0–3: chord duration in 5ms units<br>Bits 4–5: rainbow phase spacing (`00` = **0°**, `01` = **30°**, `10` = **60°**, `11` = 150°)<br>Bits 6–7: rainbow speed (`00` = **Extra fast**, `01` = **Fast**, `10` = **Slow**, `11` = **Extra slow**) |

Timer count is `(byte3 >> 6) | ((byte4 >> 7) << 2)` and must be 0–4.
For v6 loading, byte 4 retains its full pool-length meaning and timer count is
zero, regardless of old reserved header bits. The old auto-sleep experiment is
superseded by timed actions and is not part of v7.

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

Version 7 JSON exports use `rainbowPhaseDegrees` with values `0`, `30`, `60`, or
`150`; this field is required in version 6 files. The starter profile and bundled
JSON profiles default to `60`. Imports accept the previous `120` value as an alias
for `150`, preserving the fourth spacing preset. Existing binary profiles retain
index 3, which now selects 150°. Older JSON files and drafts missing the setting
migrate to the same default.

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

Indicator color index 15 means animated **Rainbow** in **Always on**, *On for 1.5
seconds*, and **Blink by layer number** modes, at the selected brightness. Numbered
blinks alternate between animated **Rainbow** and fully dark phases. Per-key index
15 remains **Off**; the global flag only
changes whether it obscures an idle background. USB color preview retains its
separate solid-**Off** versus **Rainbow** selection.

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
| A | **Set layer** | `0` for persistent; `1` for one-shot | Layer index, or `0xFF` for previous persistent layer |
| B | **Momentary layer** | `0` | Layer index |
| C | **Relative layer** | `0` for persistent; `1` for one-shot | Signed 8-bit offset from -6 to +6; added to the selected base-layer index with wraparound. `0` has no effect. |
| D | **Mouse X movement** | `0` for tap; `1` for hold | Signed 8-bit X delta from -127 to +127 |
| E | **Mouse Y movement** | `0` for tap; `1` for hold | Signed 8-bit Y delta from -127 to +127 |
| F | **LED control** | Value or signed step (see below) | Full command byte (see below) |

For action A and C, auxiliary value `0` changes the selected base layer
persistently. Auxiliary value `1` makes that layer active for the next input
action, then returns to the previously selected base layer. Other auxiliary
values are invalid. These meanings are preserved when migrating old A/D records to v7 A/C.

In v7, **Set layer** parameter `0xFF` (255) selects the previous persistent base layer.
Both persistent and one-shot forms support this target; **Momentary layer** and v6
profiles reject it. All other targets must be actual configured layer indices.
The editor offers **Previous layer** in persistent and one-shot target selectors,
but not **Momentary layer**. JSON retains the existing action shape with `layer: 255`.
Layer insertion, deletion, duplication and reordering preserve this reserved target.
Older binary/JSON profiles and drafts reject it rather than treating it as a real
layer. Return-path advice marks this target as history-dependent; it cannot by
itself make a previously unreachable layer reachable.

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

Rotation bindings cannot use **Keyboard hold**, **Mouse hold**, **Momentary layer**,
or X/Y movement in hold mode. Timed expiry and next-input actions have the same restrictions.
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

Command `0D` extends v6 without changing existing encodings. Earlier v6 firmware
rejects images containing it during validation; using toggle requires updated
firmware. Existing v6 profiles remain valid on the updated firmware.

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
profile has a 40ms chord window, **60°** rainbow spacing, **Fast** rainbow speed, and no chords or strings.

## Timed actions

The image contains the header, all layers, sorted chords, timed actions in editor
order, then the shared string pool. Each timer occupies five bytes:

| Offset | Meaning |
| --- | --- |
| 0 bits 0–5 | Interval minus one: 0–63 means 1–64 ticks |
| 0 bit 6 | Consume the first physical input after firing |
| 0 bit 7 | Restart interval on physical input |
| 1–2 | Expiry action, ordinary two-byte encoding |
| 3–4 | Next-input action, ordinary two-byte encoding; **None** is allowed |

One tick is 131.072 seconds (`millis() >> 17`); maximum duration is 139.81 minutes.
The UI shows “× 131 seconds” and whole minutes/seconds, using the precise value
internally and rounding only for display. Hover over the duration to see the
first-firing range: `(ticks - 1) * 131.072` through `ticks * 131.072` seconds.
The initial firing after a save/reset/input can be almost one tick early because
the timer uses shared uptime boundaries. Subsequent repetitions use full intervals.
Key presses, encoder button presses, and completed detents trigger input handling;
releases, held repeats, partial encoder motion, and timer-generated actions do not.
Input resets only timers whose restart flag is set. Timer actions do not consume
an armed one-shot layer binding. All timers repeat and apply across layers.

After any expiry, its next-input action is armed; repeated expiries coalesce into
one pending next-input action. On physical input, all armed timers run their
next-input actions in record order. If any armed timer has consume set, that
physical event creates no normal binding, chord participation, or held action.
Its release is harmless; subsequent input works normally. This works even when
the next-input action is **None**. Otherwise, next-input actions run before the
normal binding resolves, so a next-input layer change can affect that binding.
Timer expiry is processed before physical input if both occur in one loop.
Encoder-hold bootloader detection remains available even for consumed presses.

Timer actions share the normal bounded action queue. A busy host can cause
outputs to be dropped under the same policy as other actions; timers do not
accumulate an unbounded backlog. Four timers require four age bytes in paged RAM;
flags remain embedded in their existing records.

JSON v7 `timedActions` entries contain `ticks`, boolean `resetOnInput`, boolean
`consumeInput`, `action`, and `resumeAction`. The list is optional; absence means
no timers. JSON import rejects invalid ranges/types; UI edits clamp to 1–64.

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

`9 + layerCount * layerSize + chordCount * 3 + timerCount * 5 + poolBytes <= 128`.
**String** sharing includes keys, encoder actions, chords, expiry and next-input
bindings. All 128 bytes remain available; trailing bytes are CRC-covered.

Final firmware measurements are 14,165 used / 171 free bytes for six keys and
14,161 used / 175 free for three keys, against a 14,336-byte limit. Stack capacity
is 121/124 bytes (six/three) for these historical builds. Subsequent
[hardware stack validation](led-control-implementation.md#stack-usage-hardware-validation)
measured 36 bytes peak observed usage under heavy workloads, leaving ample headroom.
See [implementation measurements](timed-alert-findings.md) for preserved prototypes.
