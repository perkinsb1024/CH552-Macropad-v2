# Macropad Configuration Image, Version 11

| Image property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused bytes | `0` |
| Multibyte values | Little endian |
| Byte offsets and action codes | Fixed for format version 11 |
| Header size | 9 bytes |
| Layer count | 1–5 for six keys; 1–7 for three keys |
| Action record size | 2 bytes |
| Chord record size | 3 bytes |
| Timed-action record size | 6 bytes, at most four timers |
| Palette version | 3 |
| HID transport version | 1 |

This standalone reference specifies format 11 firmware and its web configurator:
dynamically stored macros, 1–16 executions per invocation, and **Pause** actions.
Timed actions use six bytes each. Pre-built v11 release HEX files are available
for [three-key](../releases/ch552-macropad-3-key-f87ca744.hex) and
[six-key](../releases/ch552-macropad-6-key-f87ca744.hex) macropads, built from source
revision `f87ca744`. Firmware hardware testing has been completed on both
three-key and six-key macropads.

The firmware validates the version, variant, section bounds, every action,
string encoding, macro references, and CRC before activation. Reserved fields
retain their stated validation rules. The tail after strings now contains
validated two-byte actions and single-byte zero terminators/padding; arbitrary
legacy padding is no longer ignored.

## Version and Migration

Header byte 2 is `11`. GET_INFO advertises configuration format 11 and transport
version 1. The recommended firmware accepts only v11. Older DataFlash remains
readable and unchanged, with physical inputs inactive until a valid v11 image
is explicitly uploaded. Updating firmware does not migrate or erase a profile.

The editor reads binary formats 2–11 and JSON versions 1–11, decodes actions
using the source version, then encodes only v11. For v10, old low-nibble types
`0x5–0xF` become `0x4–0xE`; high auxiliary bits and parameters keep their meanings.
Old type `0xF` is **LED control**, never **Execute macro**. Remap every layer input,
chord action, expiry action and next-input action. Header fields, six-byte timer
intervals/scopes, layer settings, colors and strings are preserved. Rebuild the
canonical string pool, clear the remaining tail, set byte 2 to 11 and recompute
CRC. V11 migration from v10 adds no configuration bytes when no macros are defined.

For formats 2–5, decode their original relative/pointer action allocation first.
For formats 2–7, old type 4 is a double click and old type 9 is text. For formats
8–10, type 4 is reserved and type 9 is **Consumer hold**. Existing click counts,
consumer usages and scroll axis/hold flags survive migration. Binary formats 2–4
lack rainbow settings and default to phase **60°** and speed **Fast**. Binary v5
zero speed bits still select **Extra fast**. JSON accepts historical speed names
`double`, `normal`, `half`, `quarter` at indices 0–3, and phase `120` as an alias
for `150`. JSON before v5 defaults phase to **60°**; absent speed defaults **Fast**.

V7–v9 five-byte timer records become six-byte records: multiply their 1–64 ticks
by 32 exactly to preserve durations, retain both actions and flags, and omit scope
for global operation. V10/v11 ticks are never scaled. If migration exceeds 128
bytes, preserve all actions, allow JSON export/editing, and block saving until
the user reduces storage. No automatic timer/text deletion occurs.

Export a JSON/raw backup with the matching editor before updating firmware.
Read/import the profile after updating, then explicitly **Save to device** to
reactivate inputs. Firmware never migrates flash on its own. The active editor
links older firmware to frozen configurators for formats 2–10 and does not read
or write their profiles through a v11 connection.

## JSON, Drafts and Editor Behavior

Exports identify `format: "universal-macropad-profile"` and `version: 11`.
`variant` is `six-key` or `three-key`; `startupLayer` is zero-based;
`transparentBlack` is boolean; `chordWindowMs` is 0–75 in steps of 5;
`rainbowPhaseDegrees` is 0, 30, 60 or 150; `rainbowSpeed` is `extra fast`, `fast`,
`slow` or `extra slow`. `layers` contains the physical `keys` list,
`encoderButton`, `clockwise`, `counterclockwise`, palette-name `leds`, boolean
`bootloaderFromRun`, numeric `indicatorBehavior` (0–3), `indicatorColor` (0–15),
and boolean `indicatorFullBrightness`. `chords` contains zero-based `layer`,
`keys: [keyA, keyB]`, boolean `global` and `action`. Optional `localMetadata`
contains `profileName` and `layerNames`; annotations do not reach the device.

Optional `timedActions` is a list of at most four entries. Each has `ticks`
(1–2048), boolean `resetOnInput`, boolean `consumeInput`, `action`, `resumeAction`,
and optional zero-based `layer`. Omit `layer` for **All layers**. Each entry uses
six device bytes. Layer reordering updates explicit targets and timer scope;
removing a scoped layer preserves the timer with an invalid scope until reassigned.

Optional `macros` is an ordered list of `{ "actions": [...] }` objects. Its
zero-based array index is the editor macro number minus one. An invocation is
`{ "type": "macro", "macro": 0, "repeats": 1 }`, with an existing macro index and
1–16 repeats (JSON import defaults omitted repeats to 1). A pause is
`{ "type": "pause", "ticks": 16 }`, with 0–255 ticks of 16ms. These names and
fields are semantic JSON, independent of on-device action numbering/addresses.
Macros/pauses in JSON versions before 11 reject. Nested invocations, held actions
and **Nothing** steps reject; **Nothing** is a wire terminator, so use a zero
**Pause** for an editable no-output step. Empty definitions are allowed.

Other action JSON objects use `type` plus the following fields:

| Types | Fields |
| --- | --- |
| `none` | None |
| `keyTap`, `keyHold` | `usage` (supported raw key usage), `modifiers` (0–15) |
| `mouseClick` | `buttons` (1–7), optional `clicks` (1–16, default 1) |
| `mouseHold`, `mouseToggle` | `buttons` (1–7) |
| `scroll` | `delta` (-127–127), optional boolean `hold`, optional boolean `horizontal` |
| `mouseX`, `mouseY` | `delta` (-127–127), optional boolean `hold` |
| `consumer`, `consumerHold` | `usage` (1–4095) |
| `string` | `text` (printable ASCII, tab or newline) |
| `setLayer`, `oneShotSetLayer`, `momentaryLayer` | `layer` (zero-based target; 255 only for the first two) |
| `relativeLayer`, `oneShotRelativeLayer` | `offset` (-6–6) |
| `ledControl` | `command`, `value` (number or `asConfigured`), optional `brightness: "dim"` for temporary effects |

LED command names are `rainbowPhaseSet`, `rainbowPhaseRelative`, `rainbowSpeedSet`,
`rainbowSpeedRelative`, `brightnessIndicatorSet`, `brightnessIndicatorRelative`,
`brightnessKeySet`, `brightnessKeyRelative`, `brightnessBothSet`,
`brightnessBothRelative`, `restoreAll`, `commonPresetSet`, `commonPresetRelative`,
`commonPresetToggle`, `effectRestore`, `effectOn`, and `effectBlink1`–`effectBlink8`.
Their command/value validation is specified in the LED section below. The editor
also rejects zero-delta movement and a keyboard action with neither key nor modifier;
firmware accepts those no-output records. Text imports normalize CRLF/CR to LF.

The editor lays out every macro in list order after the deduplicated string
pool. It resolves indices to absolute byte addresses on every encode, so changes
to layers, chords, timers, text and steps cannot leave stale pointers. Normally
it writes one `00` terminator per macro. The final nonempty macro may omit its
terminator when its last step ends at byte 127. **Device storage** accounts
for the same boundary optimization. Macro strings share the ordinary string pool.

**Macros** supports adding/removing definitions and steps, dragging steps to insert or swap,
selecting steps in the common **Action editor**, and drag/clipboard action swaps.
**Execute macro** exposes **Macro** and **Repeat count**; **Pause duration** uses
16ms increments. Deleting a macro clears its invocations and renumbers later
references. Undo restores both definitions and bindings. Moving/removing layers
updates explicit targets in macro steps. Layer-route analysis follows macro
steps only until their first effective layer change, where firmware cancels them.
The editor requires every layer-switching step (**Switch to layer**, **Relative layer**,
and their one-shot variants) to be the final step, regardless of the invocation
layer or whether the target is already active. Any invocation of such a macro
must have **Repeat count** 1. **Add step** and **Add pause** stay below the steps
and insert before the first layer switch, at a labeled divider. Layer-switch
steps that are not final have a red border. Storage capacity limits additions;
validation blocks saving invalid ordering or repeat counts at all
binding sites. JSON import enforces the same rules. These are editor constraints;
the wire encoding and firmware validation still accept the broader sequences
and repeat counts described below. Firmware still cancels playback on an actual
effective-layer change.

The live viewer lists macro steps without edit controls.

Binary readback discovers nonempty sequences and referenced empty/suffix
sequences in ascending address order. Ordinal numbers may change if unreferenced
empty definitions disappear; their absence has no device behavior. A noncanonical
shared suffix becomes its own editable definition, so normalization may need
more storage; oversized readbacks remain editable/exportable until reduced.

V11 drafts use `universal-macropad:format-v11:` and recover v10 and older drafts
without changing their original namespaces. Source-version migration runs once;
current JSON/drafts retain v11 timer units. Oversized drafts remain editable.

## Header and Rainbow Settings

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `11` |
| 3 | Layers, startup layer, timer count | Bits 0–2: layer count minus one<br>Bits 3–5: startup layer<br>Bits 6–7: low two bits of timer count |
| 4 | **String**-pool length and timer count | Bits 0–6: used pool bytes<br>Bit 7: high bit of timer count |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: transparent black key LEDs (`0` = opaque, `1` = transparent) |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | **Chord window** and rainbow settings | Bits 0–3: chord duration in 5ms units<br>Bits 4–5: rainbow phase spacing (`00` = **0°**, `01` = **30°**, `10` = **60°**, `11` = 150°)<br>Bits 6–7: rainbow speed (`00` = **Extra fast**, `01` = **Fast**, `10` = **Slow**, `11` = **Extra slow**) |

Timer count is `(byte3 >> 6) | ((byte4 >> 7) << 2)` and must be 0–4.
Layer and startup-layer indices are zero-based. The startup layer must exist.
The chord window is 0–75ms in 5ms units; zero disables chord recognition.
A second press must arrive strictly before the window expires to activate a
mapped chord. The old auto-sleep experiment is not part of v11.

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

Spacing applies to every layer's rainbow indication, including timed and blinking
indications. Solid colors and pressed-key overrides retain their existing behavior.
Hardware color previews use the saved profile's phase spacing and speed; save an edited
setting before previewing it. Bits 0–3 still control chords independently.

## CRC

| CRC16-CCITT-FALSE setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | None |
| Final XOR | `0x0000` |
| Covered bytes, in order | 0–5, then 8–127 (skip the stored CRC at 6–7) |

## Layers and LED Behavior

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

## Chords and Shared String Pool

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

## Action Records

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
| 0 | **Pause** (full first byte `0x20`) | `2` | Unsigned delay in 16ms units, 0–255 |
| 1 | **Keyboard tap** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage |
| 2 | **Keyboard hold** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage; button release ends the hold |
| 3 | **Mouse click** | **Click count** minus one (`0`–`15` = 1–16 clicks) | Button mask 1–7 |
| 4 | **Mouse hold** | `0` | Button mask 1–7 |
| 5 | **Mouse toggle** | `0` | Button mask 1–7 |
| 6 | **Scroll Tap** / **Scroll Hold** | Bit 2 (`4`) selects hold; bit 3 (`8`) selects horizontal; values `0`, `4`, `8`, `12` | Signed 8-bit wheel delta from -127 to +127; firmware sends one-count reports in the requested direction |
| 7 | **Consumer tap** | High four bits of the usage | Low eight bits of the usage |
| 8 | **Consumer hold** | High four bits of the usage | Low eight bits of the usage; button release ends the hold |
| 9 | **Set layer** | `0` for persistent; `1` for one-shot | Layer index, or `0xFF` for previous persistent layer |
| A | **Momentary layer** | `0` | Layer index |
| B | **Relative layer** | `0` for persistent; `1` for one-shot | Signed 8-bit offset from -6 to +6; added to the selected base-layer index with wraparound. `0` has no effect. |
| C | **Mouse X movement** | `0` for tap; `1` for hold | Signed 8-bit X delta from -127 to +127 |
| D | **Mouse Y movement** | `0` for tap; `1` for hold | Signed 8-bit Y delta from -127 to +127 |
| E | **LED control** | Value or signed step (see below) | Full command byte (see below) |
| F | **Execute macro** | Repeat count minus one, 0–15 | Absolute byte address of a macro step in the image |

Keyboard modifier bits are `1` = **Ctrl**, `2` = **Shift**, `4` = **Alt**, and `8` = **GUI**;
combine them with bitwise OR. Mouse button bits are `1` = **Left**, `2` = **Right**,
and `4` = **Middle**; any nonzero combination up to `7` is valid. Consumer actions
accept nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. **Type Text** must
point to the start of a complete NULL-terminated pool string, including for
empty text. Type 0 auxiliary values other than 0, 1 and 2 reject.

**Type Text** uses the US keyboard layout. Each character is pressed for at least
8ms, then released. After the release report drains, playback waits 32ms before
continuing, including after tabs, newlines and the final character. USB and
main-loop delays can lengthen these times. Inputs, timers and LEDs continue to
be serviced; later queued actions wait for text playback to finish. Applications
may still require an explicit **Pause** before Enter in a macro.

For action 9 and B, auxiliary value `0` changes the selected base layer
persistently. Auxiliary value `1` makes that layer active for the next input
action, then returns to the previously selected base layer. Other auxiliary
values are invalid.

**Set layer** parameter `0xFF` (255) selects the previous persistent base layer.
Both persistent and one-shot forms support this target; **Momentary layer**
rejects it. All other targets must be actual configured layer indices.
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
Auxiliary values 2–15 are invalid. Format 11 shifts both movement type codes;
their auxiliary/parameter encodings retain the same meaning.

Rotation bindings cannot use **Keyboard hold**, **Mouse hold**, **Consumer Hold**,
**Scroll Hold**, **Momentary layer**, or X/Y movement in hold mode. Timed expiry and
next-input actions have the same restrictions.
For keyboard actions, the parameter byte is an HID key usage: `0` means no
non-modifier key, while `0x04`–`0x65` and `0x68`–`0x73` select supported keys.
With usage `0`, the modifier mask can produce a modifier-only action (particularly useful for **Keyboard hold** actions).

## LED Control Action E

Record byte 0 is `(value << 4) | 0xE`; byte 1 is the full command ID.
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
rotation, chords, and both timer actions. As direct bindings they execute immediately after chord/one-shot resolution;
inside a macro they execute when their step is reached. They
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

Command `0D` is part of v11. It was introduced as a v6 extension; earlier v6
firmware rejects images containing it during validation.

Indicator overrides retain the saved color and visibility mode. **Off** removes
indicator animation priority, allowing key feedback. Key **Off** removes the key overlay,
allowing an always-on idle background. Both **Off** blacks out normal lighting.
**Blink** dark phases remain black; dimming retains `(component >> 4) | (component != 0)`.
Hardware preview, invalid-config feedback, and bootloader feedback bypass overrides;
preview uses saved phase/speed. Common presets restore brightness only; Restore all
also restores phase and speed.

## Palette and Starter Profile

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

## Mouse Clicks

**Mouse click** uses type `0x3` for every click count. The first byte is
`((clicks - 1) << 4) | 0x03`; the second byte is the mouse button mask.
For example, `[0x03, 0x01]` is one left click, `[0x13, 0x01]` is two left clicks,
and `[0xF3, 0x01]` is sixteen left clicks. Counts 1–16 require no additional
configuration bytes. Type `0xF` is **Execute macro**, defined below.

The nominal duration is `(8 * clicks + 200 * (clicks - 1)) / 1000` seconds,
before additional transport/playback latency.
**Mouse click** is available on keys, encoder press/rotation, chords and both timer
slots; it does not need a physical release. A brief physical press plays the
complete configured sequence.

Each click is an ordinary mouse-button press followed by release. Presses last
at least 8ms, with a 200ms pause after release before the next click. USB
backpressure can lengthen these times. The host decides whether a sequence
counts as a double-click or another multiple-click gesture. Held mouse buttons
and toggled mouse buttons combine with click output using bitwise OR. A click
cannot release a button that is held or toggled on.
The sequence occupies the queued playback lane, delaying later queued actions.
Held outputs, consumer controls, and layer/LED actions use independent handling.

## Mouse Toggle State

All **Mouse toggle** actions share one global three-bit button mask, initially
zero. Each action XORs its parameter mask into that state, whether triggered by
a key, encoder press/rotation, chord, timer expiry/follow-up, or macro step.
A toggle from any source can undo another source's toggle for the same button.
Multi-button masks flip each selected bit independently.

The reported mouse buttons are the bitwise OR of the global toggle state,
physical **Mouse hold** outputs and temporary click output. Toggling a bit off
does not release a button still held by another output source. Releasing a
physical trigger does not clear its toggle. Effective-layer changes,
configuration application and action reset clear the global toggle state;
ordinary macro completion does not. Direct toggle bindings act immediately;
macro steps update the same state when queued playback reaches them.

## Action Encoding Examples

| Action | First byte | Second byte |
| --- | --- | --- |
| **Mouse click** | `0x03 \| ((clicks - 1) << 4)` | Mouse button mask 1–7 |
| **Nothing** | `0x00` | `0x00` |
| **Type Text** | `0x10` | Offset of a complete NULL-terminated string in the shared pool |
| **Pause** | `0x20` | Duration in 16ms units, 0–255 |
| **Execute macro** | `0x0F \| ((repeats - 1) << 4)` | Absolute address of a macro step |
| **Consumer Tap** | `0x07 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Consumer Hold** | `0x08 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Scroll Tap** | `0x06` | Signed wheel step, -127–127 |
| **Scroll Hold** | `0x46` | Signed vertical wheel step, -127–127 |
| **Scroll Tap**, **Horizontal** | `0x86` | Signed horizontal step, -127–127 |
| **Scroll Hold**, **Horizontal** | `0xC6` | Signed horizontal step, -127–127 |

**Type Text** shares low-nibble type 0 with **Nothing**: auxiliary 0 is **Nothing** and must
have parameter 0; auxiliary 1 is **Type Text**, and auxiliary 2 is **Pause**. Other auxiliary values reject. Empty
text still requires a valid pool offset pointing at a NULL byte.
These are two-byte binding records; the macro tail instead uses a single `00`
terminator with no parameter, as specified under Macros and pauses.

**Consumer Hold** occupies low-nibble type 8, directly after **Consumer Tap** (type 7).
Both retain nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. **Hold** is
allowed on keys, encoder press and chords, but rejects on wheel rotation and on
both timer action slots. It adds no configuration bytes.

**Scroll Hold** uses auxiliary bit 2 (`0x40` in the first byte). Auxiliary bit 3 (`0x80` in the first byte) selects
horizontal scrolling. Only auxiliary values 0, 4, 8 and 12 are accepted. Acceleration bits remain reserved
and reject. **Hold** rejects on rotation and both timer action slots. -128 rejects;
zero is a firmware no-op, although the editor asks for a nonzero step.

Type `0x3` encodes **Mouse click** and type `0xF` encodes **Execute macro**. A full first byte
of `0x10` for **Type Text** uses low-nibble type 0 with auxiliary value 1.

## Consumer Ownership and Release

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

## Scroll Axis and HID Reports

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

## Held Scrolling

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
but remains disabled in v11. Reserved acceleration bits reject during validation.

## Timed Actions

After the layers and sorted three-byte chords come up to four timed actions in
stored order, followed by the shared string pool. Each timer occupies six bytes:

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

### Runtime Behavior

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

## Temporary LED Effects

Temporary-effect command IDs select **As configured**, **Always on**, or **Blink**
with 1–8 flashes, using the complete LED command table above.
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

## Macros and Pauses

The macro tail begins at `macroStart = stringPoolStart + poolBytes`. There is no
macro count, directory, fixed slot allocation, presence flag, or extra header
byte. With no macros the tail is zero padding. A sequence is a run of ordinary
two-byte action records. A single `00` byte at an action boundary ends it; no
parameter byte follows that terminator. Reaching the end of the 128-byte image
also ends it. A nonzero action first byte at byte 127 is invalid because its
parameter would be outside the image. Zero parameter bytes inside actions do
not terminate a sequence. Each terminator changes the parity of subsequent
action boundaries; neither absolute nor tail-relative even alignment is required.

**Execute macro** is `((repeats - 1) << 4) | 0x0F`, followed by its absolute start
address. Repeats range from 1 through 16. The address must satisfy all of:

- `macroStart <= address < 128`;
- the address is a boundary reached by scanning the tail from `macroStart`,
  advancing one byte for `00` and two bytes for a nonzero action first byte;
- every action in the tail has an in-bounds parameter and passes the macro-step
  validation below.

The reference may point to any step boundary, including a shared suffix or a
zero terminator. A terminator reference is an empty sequence, including at byte
127. A reference into an action parameter is invalid even if that byte is zero
or looks like a valid opcode. Firmware
does not assign ordinal macro numbers; an editor can name/number definitions and
resolve their addresses after laying out the image. Repacking layers, chords,
timers or strings requires remapping every macro reference in bindings and
both timer action fields. Macro steps cannot reference other macros.

Allowed steps are **Keyboard tap**, **Type Text**, **Mouse click**, **Mouse toggle**,
**Scroll Tap**, **Consumer tap**, persistent/one-shot **Set layer** and **Relative
layer**, X/Y movement in **Tap** mode, **LED control**, and **Pause**.
**Nothing** is represented by the single-byte terminator rather than a step.
All normal parameter rules still apply. Reject **Execute macro**, **Keyboard hold**,
**Mouse hold**, **Consumer hold**, **Scroll Hold**, **Momentary layer**, and held
X/Y movement anywhere in the tail, including unreferenced actions. Strings used
by steps share the existing string pool and its start/bounds checks.

A macro invocation occupies one entry in the normal eight-event queue, regardless
of sequence length or repeat count. One active macro streams one step at a time,
using constant runtime state. It does not recursively call itself or expand all
steps into the event queue. Accepted key/mouse reports, releases and consumer-tap
releases complete before the next step starts. Each repetition reloads the
original actions; string indices and mouse click counts reset. The image is
never modified by playback. Later queued actions wait behind the sequence.
Immediate physical/timer LED, consumer, toggle and layer actions retain their
normal dispatch behavior and may interleave with or interrupt a macro.

Keys, encoder press/rotation, chords, timer expiry and timer resume may invoke a
macro. Releasing its physical trigger does not cancel playback. Physical held
outputs remain active alongside macro taps. Overflow rejects the invocation as
a whole and increments the existing saturated drop counter; steps do not partly
fill the event queue. Continuous input can still fill the queue behind a long
macro. Held pointer/scroll repeats wait for active macro playback as they wait
for other queued output.

An actual effective-layer change, configuration application, USB reset/
reconfiguration through configuration application, or `actionsClear()` cancels active
and queued macros and clears the global mouse-toggle state. A macro's own layer step
therefore ends its remaining steps if the effective layer changes. Selecting the
same effective layer continues. A macro consumes an armed one-shot selection
once at invocation. Steps do not consume another one-shot selection as physical
input would. Relative steps resolve against the then-effective layer.

Macro **Mouse toggle** steps update the same global state as all other toggle
actions, as defined under [Mouse Toggle State](#mouse-toggle-state). There is no
per-trigger or per-macro toggle ownership. Macro consumers use the existing
latest-wins consumer lane;
a new physical consumer action can interrupt it. No held-action lifecycle or
nested macro stack is provided.

**Pause** is `20 nn`, with duration `nn * 16ms`, from 0 to 4,080ms. It is valid
as a direct binding or macro step, and uses the existing nonblocking deadline
state. Inputs, timers, LEDs and USB continue to be serviced while it waits. It
starts after preceding output drains; the next step starts no earlier than its
deadline, subject to main-loop and USB delays. Longer pauses can use successive
pause steps. Timing subtraction remains valid across the 16-bit millisecond
clock wrap because every pause is below half the wrap period.

Example, with a single six-key layer and no chords/timers: store `chrome\0` at
31–37 (`poolBytes = 7`), then at absolute byte 38 store:

```text
81 2C   Keyboard tap: GUI+Space
20 10   Pause: 16 * 16 = 256ms
10 00   Type Text: string-pool offset 0
01 28   Keyboard tap: Enter
00      End sequence
```

Bind a trigger to `0F 26` (one execution, absolute address `0x26` = 38).
The layer binding itself already occupies its normal two bytes; added data is
7 string bytes plus 9 macro bytes. Repeating once costs no extra data; two
executions change the binding to `1F 26`. UI automation timing is application-
dependent; the example's delay has host-test coverage, not an OS-level guarantee.

A standalone sequence of N steps normally costs `2*N + 1` bytes; an empty
definition costs one byte. Adjacent macros
share neither a directory nor unused fixed slots. The last sequence omits its
terminator if it completely fills the 128-byte configuration space. With one layer and no strings,
chords or timers, at most 48 steps fit on six-key hardware or 52 on three-key
hardware. More layers and other dynamic data share the same 128-byte budget.

## Storage and Verification

The image order is header → layers → sorted chords → timers in stored order →
shared string pool → macro sequences / zero padding. Section starts are:

| Section | Absolute byte offset |
| --- | --- |
| Layers | `9` |
| **Chords** | `9 + layerCount * layerSize` |
| **Timed actions** | `9 + layerCount * layerSize + chordCount * 3` |
| **String** pool | `9 + layerCount * layerSize + chordCount * 3 + timerCount * 6` |
| Macro tail | `stringPoolStart + poolBytes` |

The complete image must satisfy:

`9 + layerCount * layerSize + chordCount * 3 + timerCount * 6 + poolBytes + macroBytes <= 128`.

Chord count is encoded in six bits (0–63), but the capacity formula limits the
number that can actually fit. Pair indices must be valid for the hardware
variant: 0–14 for six keys, 0–2 for three keys. Pool length is encoded in seven
bits (0–127) and must fit the remaining image space. A nonempty pool must end in
NULL. **String** sharing includes keys, encoder actions, chords, expiry and next-input
bindings and macro steps. All 128 bytes remain available. Every trailing action
is validated as a macro step, single zero bytes act as terminators/padding, and all
trailing bytes remain CRC-covered.

## HID Configuration Protocol

The v11 configuration uses the following transport-v1 protocol. The shared
[HID transport reference](hid-v1.md) also contains historical format notes;
the v11 version and validation rules in this document apply to v11 firmware.

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

GET_INFO advertises configuration format 11, palette version 3, and
action mask `0xFFFF` (all low-nibble types, including **Execute macro**). The maximum layer count is 5 for six keys and 7 for three
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

| Data byte | Field | V11 value |
| --- | --- | --- |
| 0–3 | Application identity | ASCII `UMAC` |
| 4 | Transport version | `1` |
| 5 | Configuration format | `11` |
| 6 | Physical variant | `0` = six keys, `1` = three keys |
| 7 | Key count | `6` or `3` |
| 8 | LED count | `6` or `3` |
| 9 | Maximum layers | `5` or `7` |
| 10 | Image capacity | `128` |
| 11 | Palette version | `3` |
| 12–13 | Action mask | `0xFFFF`, little endian (`FF FF`) |

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

## Builds and Measurements

Recommended defaults, built with the actual 14,336-byte application limit:

| Hardware | Flash | Spare | Paged RAM | Ordinary XSEG | Absolute active image | Stack capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,284 | 52 | 95 | 369 | 128 | 79 |
| Three keys | 14,280 | 56 | 95 | 360 | 128 | 82 |

The absolute image occupies xRAM `0x300–0x37F`, leaving 128 bytes above it.
Linker XSEG size omits that allocation; count it separately. The build checks
its address and overlap with ordinary external/paged/USB memory. `protocolInit`
loads all 128 bytes from DataFlash before any image use; absolute storage does
not rely on the ordinary XSEG startup clear loop.

Stack figures are linker-reserved capacities, four bytes higher than the v10
baseline on each board. Firmware hardware testing has been completed on both
three-key and six-key macropads. Reproduce measurements and the complete host
regressions with `python3 tests/run_host_tests.py` and temporary native builds:

```sh
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v11-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v11-three 24000000 148 14336 1
```

These commands do not generate releases. See [macros-findings.md](macros-findings.md) for optimization details and
[macros-implementation.md](macros-implementation.md) for final validation.
