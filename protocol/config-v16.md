# Macropad Configuration Image, Version 16

| Image Property | Value |
| --- | --- |
| Size | 128 bytes |
| Unused trailing bytes | Writers write zero; macro-tail rules apply |
| Multibyte values | Little endian |
| Byte offsets and action codes | Allocation specified completely below |
| Header size | 9 bytes |
| Layer count | 1–5 for six keys; 1–7 for three keys |
| Action record size | 2 bytes |
| Chord record size | 3 bytes |
| Timed-action record size | 6 bytes, at most four timers |
| Additional layer palette | 3 bytes on six-key hardware; 2 on three-key hardware |
| Palette version | 4 |
| HID transport version | 1 |

This standalone reference specifies the version 16 firmware image and HID
transport. It includes independent per-key layer palettes, keypress and layer
**Rainbow**, per-layer **Auto-Sleep**, keyboard and consumer actions with modifiers,
absolute/relative persistent/one-shot/held layers, chords, macros, text, mouse
buttons, movement, scrolling, timers and runtime LED controls. All action records
remain two bytes. The frozen v16 configurator supports v16, including binary, JSON and draft migration.
The pre-built v16 release uses source revision `780fcc79`: [three-key](../releases/ch552-macropad-3-key-780fcc79.hex) and [six-key](../releases/ch552-macropad-6-key-780fcc79.hex). The [frozen v16 configurator](../webapp/public/versions/format-v16/) matches these files. Hardware validation is complete. The outgoing v15 configurator is frozen at `webapp/public/versions/format-v15/`.

## Version and Compatibility

Header byte 0 is ASCII `B` (`0x42`); byte 1 is `16`. **GET_INFO** advertises
configuration format 16, palette version 4 and transport version 1. Firmware
accepts only matching B-header v16 images for its physical hardware variant.
Older DataFlash remains readable and unchanged, but its physical action bindings
are inactive until a valid v16 image is explicitly uploaded. Firmware does not
migrate or erase profiles during an update.

A converter must validate the original source format and checksum, decode all
semantic values, then encode v16 and recompute its CRC. Simply relabeling a v15
image is invalid: zero in the layer-color field now selects another palette,
and the color indices have changed. The v15-to-v16 color mappings are:

| Source Value and Context | V16 Value |
| --- | --- |
| Solid color indices 0–6 | 1–7, preserving **Red** through **Leaf** |
| Index 7, **Teal** | Removed. Converted to **Cyan** in migration |
| Solid color indices 8–14 | Unchanged, preserving **Cyan** through **White** |
| Keypress index 15, **Off** | 0 |
| Uniform layer/effect index 15, **Rainbow** | 15 |

Color conversions apply at every color-bearing site, including temporary effects
in physical bindings, chords, both timer fields and macro steps. LED brightness,
preset and other non-color values must not be color-remapped. Source layers using
uniform colors remain uniform by default, with no added layer palette bytes.
Existing chords, timers, sleep settings and action semantics retain their decoded
meanings. Earlier formats must first be decoded with their own action allocations,
header layouts, sleep defaults and disabled-chord migration rules.

The browser editor accepts v16 binary images and exports JSON version 16 with
`format: "universal-macropad-profile"` and `headerMarker: "B"`. Existing named
action objects, profile settings and local metadata retain their meanings. Each
layer has `indicatorColor` (integer 0–15), `leds` (one keypress color per physical
key), and optional `idleLeds` (one idle color per physical key). `idleLeds` is
required when `indicatorColor` is zero and must have exactly three or six entries
for the hardware variant. Actual palette arrays export color names and accept
names, exact palette hex strings or integer indices 0–15 on import. **Rainbow**
is name/index 15; black hex `#000000` selects **Off**, index zero.

Inactive `idleLeds` arrays are validated and retained in JSON and browser drafts
but are omitted from binary storage. Uniform mode therefore incurs no additional
bytes. Selecting **Per-Key Colors** restores a retained palette or initializes
all keys from the current uniform color. **Apply to Layer** for a nonzero idle
color selects uniform mode; for **Off**, it fills the active palette with zeros.
An all-identical nonzero active palette produces an advisory storage warning;
it remains valid and may be saved without conversion. All-zero palettes remain
per-key palettes without that warning.

Drafts use `universal-macropad:format-v16:board:draft:six-key` or `three-key`.
Source JSON versions 1–15 and previous drafts are decoded using their source
semantics, including older timer and sleep defaults, before the palette mapping
above. Binary migration accepts legacy MP formats 2–15 and B/v15 after validating
the source CRC and section layout. Firmware itself accepts only B/v16. Archived
v15 drafts and published release files remain unchanged.

## Writer Canonicalization and Ignored Fields

Writers must emit zero for unused bits and values. The firmware safely ignores:

- Header byte 2 bit 7, byte 3 bit 0, and byte 6 bits 5–7.
- The unused high nibble of the final color byte on three-key hardware, in both
  the pressed-key colors and additional layer palettes.
- The second byte of a fixed two-byte **Nothing** action (`00 xx`).
- The value nibble of **Restore All Configured LED Settings** and clearing a
  temporary effect.
- Bit 7 of pointer actions; bit 6 is also ignored for single-axis pointer actions.
- Bit 7 of layer actions.

The CRC covers all these bytes and bits. Resealed images differing only in these
fields have the same executed meaning. This does not weaken counts, section
bounds, hardware/format matching, valid action/hold contexts, layer/string/macro
references, string encoding or required terminators. Reserved scroll-mode bits
remain rejected because runtime hold recognition does not ignore them. Unknown
commands and action types remain rejected.

The macro tail uses single-byte zero terminators/padding, not fixed two-byte
**Nothing** records: bytes after a zero are parsed as the next sequence or padding.
Its boundary and action validation rules below still apply in full.

## Header and Rainbow Settings

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0 | Marker | ASCII `B` (`0x42`) |
| 1 | Format version | `16`, full eight-bit version |
| 2 | Hardware and layers | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–3: layer count minus one<br>Bits 4–6: startup layer<br>Bit 7: writers write zero; firmware ignores |
| 3 | **String**-pool length | Bit 0: writers write zero; firmware ignores<br>Bits 1–7: used pool bytes, 0–127 |
| 4 | Number of **Timed Actions** and chord count | Bits 0–2: saved timed-action count, 0–4<br>Bits 3–7: chord count, 0–31 |
| 5 | **Chord Window** and LED settings | Bits 0–2: window selector<br>Bit 3: transparent black key LEDs (`0` = opaque, `1` = transparent)<br>Bits 4–5: rainbow phase spacing (`00` = **0°**, `01` = **30°**, `10` = **60°**, `11` = 150°)<br>Bits 6–7: rainbow speed (`00` = **Extra Fast**, `01` = **Fast**, `10` = **Slow**, `11` = **Extra Slow**) |
| 6 | **Auto-Sleep** settings | Bits 0–1: **Sleep Timeout**<br>Bit 2: **Consume Wake Input**<br>Bit 3: **Show Layer Indicator**<br>Bit 4: **Dim Instead of Off**<br>Bits 5–7: writers write zero; firmware ignores |
| 7–8 | CRC | CRC16-CCITT-FALSE, low byte first |

Decode physical variant as `byte2 & 1`, layer count as `((byte2 >> 1) & 7) + 1`,
startup layer as `(byte2 >> 4) & 7`, pool length as `byte3 >> 1`, timed-action
count as `byte4 & 7`, and chord count as `byte4 >> 3`. Layer limits are 1–5 on
six-key hardware and 1–7 on three-key hardware. The startup layer must exist.
Timer counts 5–7 are rejected. Unused header bits are ignored by firmware and remain CRC-covered. All 32 combinations
of byte 6 bits 0–4 are valid, even when sleep is disabled on every layer.
The saved timer count excludes the runtime-only **Auto-Sleep** timer; elapsed
runtime state does not update DataFlash. Existing per-layer sleep enablement,
selected timeout and wake behavior apply as specified below.

| Selector | **Chord Window** |
| --- | --- |
| `000` | 20ms |
| `001` | 30ms |
| `010` | 40ms |
| `011` | 50ms |
| `100` | 60ms |
| `101` | 70ms |
| `110` | 80ms |
| `111` | 90ms |

With saved chords, duration is `20 + 10 * (byte5 & 7)` milliseconds. No selector
means **Off**; a chord count of zero disables recognition and bypasses the window.
The second press must arrive strictly before expiry. At expiry the pending
single-key action resolves; early release still resolves its press and release,
and uint16 timestamp wrap preserves the same boundary. The default is 40ms.
Transparency is `(byte5 & 8) != 0`, rainbow phase is `(byte5 >> 4) & 3`, and
rainbow speed is `byte5 >> 6`. Phase and speed retain their existing meanings.

**Rainbow** phase settings use hue increments `0`, `21`, `42`, and `109` in a
256-step cycle. Three-key positions are `0, 1, 2`; six-key positions are
`0, 1, 2, 5, 4, 3`, preserving the physical perimeter order
`1 → 2 → 3 → 6 → 5 → 4`. Each LED's hue is the shared hue plus its position
times the selected increment, modulo 256. A **0°** setting makes all LEDs identical.
The 150° “Scattered Colors” preset starts at approximately 153° (109 hue steps)
and adds independent forward drift: LEDs 1–6 gain one extra hue step every
4, 32, 8, 64, 16, and 128 rainbow frames respectively. This alternates
fast/slow/fast on the top row and slow/fast/slow on the bottom row. Three-key
boards use intervals of 4, 16, and 8 frames (fast/slow/fast). Drift applies only to this preset; other spacing options
keep fixed relative phases. Drift follows the selected animation speed, advances
with rainbow frames, and resets with the base hue on configuration application or
USB reset. Color previews use the saved spacing preset, including its drift.
This is deterministic motion rather than random sampling.

The frame interval is independent of phase spacing:

| Speed Bits | Setting | Hue Step Interval | Full 256-Step Cycle |
| --- | --- | --- | --- |
| `00` | **Extra Fast** | 4ms | 1.024 s |
| `01` | **Fast** (default) | 6ms | 1.536 s |
| `10` | **Slow** | 10ms | 2.560 s |
| `11` | **Extra Slow** | 18ms | 4.608 s |

Spacing applies to every layer's rainbow indication, including timed and blinking
indications. Solid colors and pressed-key overrides retain their existing behavior.
Hardware color previews use the saved profile's phase spacing and speed; save an edited
setting before previewing it. Bits 0–2 control the window independently; bit 3 controls transparency.

## CRC

| CRC16-CCITT-FALSE Setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | None |
| Final XOR | `0x0000` |
| Covered bytes, in order | 0–6, then 9–127 (skip the stored CRC at 7–8) |

## Layers and LED Behavior

Layers begin at image byte 9. Layer `n` starts at byte `9 + n × layer size`,
with `n` starting at zero. Byte ranges below are relative to the start of a
layer. Each binding uses the two-byte action encoding below.

| Field | Six-Key Bytes (22-Byte Layer) | Three-Key Bytes (15-Byte Layer) | Encoding |
| --- | --- | --- | --- |
| Physical-key bindings | 0–11 | 0–5 | Two bytes per key, in physical-key order |
| Encoder button binding | 12–13 | 6–7 | Two-byte action |
| Clockwise rotation binding | 14–15 | 8–9 | Two-byte action |
| Counterclockwise rotation binding | 16–17 | 10–11 | Two-byte action |
| Key LED palette indices | 18–20 | 12–13 | One nibble per key: even-numbered key in bits 0–3, odd-numbered key in bits 4–7. On three-key pads, writers zero bits 4–7 of byte 13; firmware ignores them. |
| **Layer Options** | 21 | 14 | Bit fields below |

| Layer-Option Bits | Meaning | Encoding |
| --- | --- | --- |
| 0 | Layer-indicator brightness | `0` = dimmed, `1` = full brightness; applies in **On for 1.5 Seconds**, **Blink by Layer Number**, and **Always On** modes |
| 1 | **Auto-Sleep** | `0` = disabled (default), `1` = enabled on this layer |
| 2–3 | Layer-selection LED behavior | `0` = **Do Not Indicate**, `1` = **On for 1.5 Seconds**, `2` = **Blink by Layer Number**, `3` = **Always On** |
| 4–7 | Layer-indicator color source | `0` = additional per-key palette; `1`–`14` = uniform solid color; `15` = uniform **Rainbow** |

### Per-Key Layer Palettes

Additional palettes begin immediately after all fixed layer records. For each
layer whose color-source nibble is zero, append one packed palette in ascending
layer order. No mask or count is stored. Each palette uses one nibble per physical
key, even-numbered key in bits 0–3 and odd-numbered key in bits 4–7: three bytes
for six keys or two for three keys. Writers zero the unused high nibble on
three-key hardware; firmware ignores it. Zero in a stored palette means **Off**,
not another palette reference. Index 15 means **Rainbow**.

Let `paletteWidth = ceil(keyCount / 2)` and let `P` be the number of layers with
color source zero. The added section consumes `paletteBytes = P * paletteWidth`.
A layer's palette starts at `9 + layerCount * layerSize + precedingPaletteCount *
paletteWidth`, where `precedingPaletteCount` counts only earlier layers with
source zero. Uniform layers add no bytes. The full section must fit the image
alongside all subsequent content before any actions or references are accepted.

Every layer mode uses this color source. **Always On** displays its palette as a
steady background; **On for 1.5 Seconds** and **Blink by Layer Number** use it for
the entire indication. Dark blink phases stay black. When a timed/blinking
indication ends, released keys go dark; there is no additional steady background.
**Do Not Indicate** renders no layer background. A palette whose entries are all
**Off** still has the usual indication priority while its animation is active.

Layer brightness and runtime indicator policies apply to all entries together.
Pressed-key colors and brightness retain their separate controls. Keypress
feedback covers the steady background, but timed/blinking indications cover it.
Temporary effects replace the layer source using their explicit uniform color.
System displays and hardware preview retain their established priority.

Five six-key layers consume 119 bytes before palettes or other optional content;
three palettes use the remaining nine bytes. Seven three-key layers consume 114
bytes; all seven palettes exactly fill the remaining fourteen bytes. Other
optional content shares this capacity. Action records remain two bytes.

### Auto-Sleep

**Auto-Sleep** is an optional LED inactivity timer enabled separately on each
layer. It consumes no additional configuration bytes and does not occupy any
of the four user-defined **Timed Actions**. Header byte 6 supplies these
profile-wide settings, from low to high bits:

| Bits | Setting | Encoding |
| --- | --- | --- |
| 0–1 | **Sleep Timeout** | `0` = **15 Minutes**, `1` = **30 Minutes**, `2` = **1 Hour**, `3` = **2 Hours** |
| 2 | **Consume Wake Input** | `0` = wake and execute the binding, `1` = wake only and consume its release |
| 3 | **Show Layer Indicator** | `0` = no wake reminder, `1` = request the current layer's configured indication on wake |
| 4 | **Dim Instead of Off** | `0` = **Both Off**, `1` = **Layers and Keys Dim** on expiry |
| 5–7 | Unused | Writers write zero; firmware ignores |

New profiles default to byte `0x0D`: **30 Minutes**, **Consume Wake Input** and
**Show Layer Indicator** enabled, **Dim Instead of Off** disabled. Per-layer
sleep enablement defaults to disabled. Timeout selectors use the following
4.096-second tick counts:

| Selector | Ticks | Nominal Interval |
| --- | ---: | --- |
| `0` | 220 | 15 minutes 1.120 seconds |
| `1` | 440 | 30 minutes 2.240 seconds |
| `2` | 879 | 1 hour 0.384 seconds |
| `3` | 1,758 | 2 hours 0.768 seconds |

Each interval has less than 16ms early quantization, ordinary foreground delay
and oscillator error. Debounced key presses, encoder-button presses and completed
encoder detents in either direction restart it, including bindings set to
**Nothing**. Releases, held inputs, partial detents and USB traffic do not.
Transitions between enabled layers preserve elapsed sleep time and pending
wake state. Entering a layer with **Auto-Sleep** disabled clears elapsed sleep
time and pending wake state; if asleep, it restores the brightness policies
selected before sleep immediately without consuming the next physical input.
The disabled layer stays awake, and returning to an enabled layer starts a full timeout. This
also applies to layer changes made by **Timed Actions** or macros. Other timed
actions and macro output do not restart the sleep timer. Explicit LED commands
retain their normal behavior on disabled layers.

The first subsequent physical input restores the pre-sleep layer-indicator and
key-press brightness policies before its binding can execute. With
**Consume Wake Input** enabled, the press/detent and its release are consumed,
preserving an armed one-shot layer. With it disabled,
the same input executes normally, including physical holds, chords and one-shot
layer consumption. A consuming user timer can still consume this input.
User timers run first in their saved order; the built-in sleep resume follows,
then an unconsumed physical binding runs.

With **Show Layer Indicator** enabled, wake requests the current effective
layer's configured indication again: **On for 1.5 Seconds** starts a fresh
1500ms indication and **Blink by Layer Number** starts a fresh sequence of
layer-number blinks. **Always On** and **Do Not Indicate** retain their configured
behavior. Disabling the reminder skips only this wake request; explicit layer
selections still indicate normally. The request itself does not select a layer
or change the previous or one-shot layer. An executed wake binding can change
layers through its normal behavior. User-defined timer resume actions do not
automatically request an indication.

While idle, successive expiries repeat the selected sleep preset and coalesce
the pending wake. **Dim Instead of Off** uses the existing fixed dim brightness
for both indicator and pressed-key policies. It preserves configured indicator
behavior and does not force an inactive indicator on or illuminate an unpressed
key. Other LED commands, temporary effects and color preview retain their
existing interactions with these policies. The first expiry captures the exact
indicator/key policy pair, including mixed policies and **As Configured**.
Successive expiries preserve that snapshot. For example, **Layers and Keys Dim**
followed by an off sleep restores **Layers and Keys Dim** on wake. A saved
**As Configured** policy resolves against the layer current at wake. Timed or
macro LED commands can change lighting while asleep, but they do not end sleep,
restart the inactivity interval or replace the snapshot. User timer resumes run
before the built-in restore, and an unconsumed physical binding runs afterward.
Rainbow phase and speed retain their current values. USB reset/reconfiguration
or profile application clears the snapshot and pending wake, restores configured
brightness policies and starts new timer state. Scanning, USB service, held
output and animation clocks continue;
the processor does not enter a low-power mode.

At power-up with a valid profile, all LEDs remain dark while waiting for USB
configuration (`SET_CONFIGURATION` with value 1). The initial wait lasts up to 500ms
after USB initialization. Successful enumeration ends it immediately and starts
the configured startup-layer indication, including its full blink/timed sequence.
If the timeout expires first, only **Key 1** begins a yellow warning blink,
starting with 500ms off, then alternating 500ms on and 500ms off. The first yellow
flash therefore appears at 1000ms after USB initialization. Enumeration or a
debounced press of **Key 1** clears the warning, including during its initial dark phase.
Inputs and timed actions remain inactive during the wait and warning, except for
that dismissal input. A press during the initial 500ms wait does not dismiss it.
Dismissal consumes the press and its release; inputs held when normal operation
starts must be released before a new press can trigger their actions. Normal
operation can start without USB after manual dismissal, but HID output still
requires enumeration. Invalid configuration takes priority over the USB warning
and displays the red error indication described below. The USB wait and warning
apply only at power-up; later USB resets/reconfiguration do not restart either.
Later resets also preserve the running layer indication and rainbow animation.

Holding the encoder button while powering up requests bootloader entry, including
with an invalid profile. The firmware samples the button immediately after
startup initialization, then every 1ms across a 10ms qualification window. Entry
requires all eleven samples to show pressed. Any released sample ends the check;
later presses do not restart it. A release between samples can go undetected.
This recovery gesture is not configurable. Runtime encoder holds do not enter
the bootloader, even with an invalid profile or layer-option bit 1 set. The
**Enter Bootloader** button in the firmware installer uses the HID command below.
In **Always On** mode, idle keys use the
indicator color at the brightness selected by bit 0. Pressed keys normally use
their per-key color at full brightness. With header byte 5 bit 3 set, a pressed
key whose color is index 0 (**Off**) instead displays its idle background,
including dimming and animated **Rainbow**. Without an always-on background it is dark.

**On for 1.5 Seconds** displays the indicator continuously after a layer change.
**Blink by Layer Number** displays one blink per one-based layer number, with
250ms lit and 250ms dark phases. Both indications override all pressed-key
colors throughout the animation; dark blink phases are fully dark. Each new
layer change replaces the previous animation. Timing uses 2ms ticks, so the
first phase can be up to 1ms shorter than its nominal duration.

Color index 15 means animated **Rainbow** in both actual per-key palettes and
uniform layer/effect colors. All sources share the configured/runtime phase,
speed, hue and physical drift. Pressing a rainbow-colored key does not restart
its hue or establish an independent animation clock. Transparent keypress **Off**
reveals the selected layer color, including a dim or rainbow palette entry.
Without an always-on background it reveals darkness.

## Chords and Shared String Pool

After the layers come the configured chords, each three bytes. Byte ranges
below are relative to the start of a chord.

| Byte | Field | Encoding |
| --- | --- | --- |
| 0 | Chord identifier | Bits 0–3: physical-key pair index<br>Bits 4–6: layer index<br>Bit 7: `0` = layer-specific, `1` = global |
| 1–2 | Button action | Two-byte action encoding below |

Pair indices enumerate `(0,1)`, `(0,2)`, and so on in lexicographic order.
The layer index must identify an existing layer. A global chord applies on
every layer; its encoded layer index remains subject to the same validation.
When a layer-specific chord and a global chord have the same key pair,
the layer-specific chord takes precedence on that layer. Chord identifiers are
strictly ascending. Multiple actions may share one string.

| **String**-Pool Property | Encoding |
| --- | --- |
| Location | Immediately after the last timed action (or last chord when no timers exist) |
| Used length | Header byte 3 bits 1–7 |
| **String** encoding | Zero-terminated printable US ASCII (`0x20`–`0x7E`), tab (`0x09`), or LF (`0x0A`) |
| Action offset | Zero-based byte offset from the start of the pool; must point to a string start |

## Action Records

| Action Byte | Field | Encoding |
| --- | --- | --- |
| 0, bits 0–3 | Type | Action code in the table below |
| 0, bits 4–7 | Auxiliary data | Meaning depends on action type |
| 1 | Parameter | Meaning depends on action type |

The action types are:

| Type | Action | Auxiliary Data | Parameter |
| --- | --- | --- | --- |
| 0 | **Nothing** | `0` | Writers write `0`; firmware ignores |
| 0 | **Pause** (full first byte `0x10`) | `1` | Unsigned delay in 16ms units, 0–255 |
| 0 | **Type Text** (full first byte `0x20`) | `2` | **String**-pool offset |
| 1 | **Keyboard Tap** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage |
| 2 | **Keyboard Hold** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Raw key usage; button release ends the hold |
| 3 | **Mouse Click** | **Click Count** minus one (`0`–`15` = 1–16 clicks) | Button mask 1–255 |
| 4 | **Mouse Toggle** / **Mouse Down** / **Mouse Up** / **Mouse Hold** | `0` = toggle, `1` = down, `2` = up, `3` = physical hold; 4–15 reject | Button mask 1–255 |
| 5 | **Scroll Tap** / **Scroll Hold** | Bit 2 (`4`) selects hold; bit 3 (`8`) selects horizontal; values `0`, `4`, `8`, `12` | Signed 8-bit wheel delta from -127 to +127; firmware sends one-count reports in the requested direction |
| 6 | **Single-Axis Mouse Movement** | Bit 0 selects hold; bit 1 selects Y instead of X; bits 2–3 ignored by firmware; writers zero | Signed 8-bit delta from -127 to +127 |
| 7 | **Combined Mouse Movement** | Bit 0 selects hold; bit 1 negates X; bit 2 negates Y; bit 3 ignored by firmware; writers zero | Low nibble: X magnitude; high nibble: Y magnitude; each incremented by 1, then multiplied by 4 |
| 8 | **Consumer Tap** | High four bits of the usage | Low eight bits of the usage |
| 9 | **Consumer Hold** | High four bits of the usage | Low eight bits of the usage; physical release ends the hold |
| A | **Media / System with Modifiers** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Nonzero eight-bit Consumer Page usage `0x01`–`0xFF` |
| B | **Media / System with Modifiers** set to **Hold** | `Ctrl`/`Shift`/`Alt`/`GUI` modifier mask | Nonzero eight-bit Consumer Page usage `0x01`–`0xFF`; physical release ends the hold |
| C | **Set Layer** / **Momentary Layer** / **Relative Layer** | Bits 0–1: `00` persistent, `01` one-shot, `10` hold, `11` reserved; bit 2 selects relative; bit 3 ignored by firmware; writers zero | Absolute layer index (persistent/one-shot also allow `0xFF` for previous persistent layer), or signed relative offset -6 to +6 |
| D | **LED Control** | Value or signed step (see below) | Full command byte (see below) |
| E | **Execute Macro** | Repeat count minus one, 0–15 | Absolute byte address of a macro step in the image |
| F | Reserved | All values reject | All values reject |

Keyboard modifier bits are `1` = **Ctrl**, `2` = **Shift**, `4` = **Alt**, and `8` = **GUI**;
combine them with bitwise OR. Mouse button bits are `1` = **Left**, `2` = **Right**,
and `4` = **Middle**. Bits 3–7 select **Button 4** through **Button 8** (`08`,
`10`, `20`, `40`, `80` respectively). Any nonzero byte mask 1–255 is valid;
each selected bit operates independently. Zero is invalid for every mouse-button
action. All type A and B auxiliary values are valid; type 4 auxiliary values 4–15 reject.
Type 4 auxiliary value 3 is physical **Mouse Hold**, prohibited in macros,
encoder rotation and both timer action slots. Type A is a tap in every context.
Type B is a physical hold, prohibited in macros, encoder rotation and both timer
action slots. Types 8 and 9 accept nonzero 12-bit HID Consumer Page usages
`0x001`–`0xFFF`. **Type Text** must
point to the start of a complete NULL-terminated pool string, including for
empty text. Type 0 auxiliary values other than 0, 1 and 2 reject.

**Type Text** uses the US keyboard layout. Each character is pressed for at least
8ms, then released. After the release report drains, playback waits 32ms before
continuing, including after tabs, newlines and the final character. USB and
main-loop delays can lengthen these times. Inputs, timers and LEDs continue to
be serviced; later queued actions wait for text playback to finish. Applications
may still require an explicit **Pause** before Enter in a macro.

Type C combines all layer modes. Auxiliary bit 2 selects absolute (`0`) or
relative (`1`) selection. Bits 0–1 select persistent (`00`), one-shot (`01`) or
hold (`10`); mode `11` rejects. Writers zero auxiliary bit 3; firmware ignores it.

| Mode | Absolute First Byte | Relative First Byte |
| --- | --- | --- |
| Persistent | `0C` | `4C` |
| One-Shot | `1C` | `5C` |
| Hold | `2C` | `6C` |

Persistent selection changes the selected base layer. One-shot selection makes
that base layer active for the next resolved physical input action, then returns
to the underlying base. Hold selection overlays a layer until physical release;
it does not change base-layer history. Both hold modes reject on encoder rotation,
in either timer action field and anywhere in a macro tail.

Relative parameters are signed two's-complement offsets from -6 to +6
(`FA`–`FF` or `00`–`06`); all other values reject. Resolve the offset with wraparound
over the configured layer count. Physical actions use the selected base layer
before consuming a pending one-shot, rather than an overlaid momentary layer.
Timer actions and macro steps use the then-effective layer. Relative offset zero
selects the same target; persistent zero leaves the base unchanged, while a hold
still establishes an overlay at that target.

A relative hold resolves its target once at press time and stores that absolute
target in the existing held-input state. Later base changes do not reapply the
offset. The newest held layer selection has priority; releasing it restores any
older held selection, otherwise the current base layer. Releasing either chord
member ends a chord's layer hold. For example, a global **Relative Layer** hold
with offset +1 selects an alternate layer for the current base and retains that
target until release, even if the base changes while held.

**Set Layer** parameter `0xFF` (255) selects the previous persistent base layer.
Both absolute persistent and one-shot forms support this target; absolute
**Momentary Layer** rejects it. All other absolute targets must be actual
configured layer indices. In a relative action, `0xFF` encodes offset -1.
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

For **Scroll** and **Single-Axis Mouse Movement** (type `0x6`), interpret the
parameter as a signed 8-bit two's-complement value. `0x01`–`0x7F` mean +1 to
+127; `0x81`–`0xFF` mean -127 to -1; `0x00` means zero movement. Reject `0x80`
(-128), so every accepted delta can be safely negated.

For type `0x6`, auxiliary bit 1 (record byte 0, bit 5) selects the axis:
clear means X, set means Y. Auxiliary bits 2–3 (record bits 6–7) must be zero.
The configurator exposes this action as **Move Pointer X** and **Move Pointer Y**.

For **Combined Mouse Movement** (type `0x7`), the parameter's low nibble is the
X magnitude and its high nibble is the Y magnitude. Decode each as an unsigned
integer 0–15, add 1, then multiply by 4. Auxiliary bit 1 (record bit 5) negates X;
auxiliary bit 2 (record bit 6) negates Y. Auxiliary bit 3 (record bit 7) must be
zero. Each axis therefore supports magnitudes 4–64 in increments of 4,
with either sign. All 256 parameter bytes are valid, including `0x80`
(X=4, Y=36). Both axes are sent in one mouse report. The configurator calls this action
**Move Pointer X/Y**. Positive X moves right; positive Y moves down.

Both pointer actions use auxiliary bit 0 (record bit 4) for **Hold** mode.
Clear sends one step per press or encoder detent; set sends an initial step
and repeats while held, at an 8ms interval when USB is ready and queued actions
have finished. Releasing a key, the encoder button, or either chord key stops
new repeats. Held inputs retain their original bindings across layer changes.
Repeat reports are skipped when USB is busy; they do not accumulate for later
playback. Both axes of a combined hold repeat together. Type `0x6` accepts
auxiliary values 0–3; type `0x7` accepts 0–7, subject to trigger restrictions.

Pointer deltas are relative HID mouse counts. Screen distance depends on host
pointer speed and acceleration, and is not guaranteed to equal pixels.

Rotation bindings cannot use **Keyboard Hold**, **Mouse Hold**, **Consumer Hold**,
**Scroll Hold**, **Momentary Layer**, **Relative Layer** in hold mode,
**Media / System with Modifiers** set to **Hold**, or pointer movement in hold mode. Timed expiry and
next-input actions have the same restrictions.
For keyboard actions, the parameter byte is an HID key usage: `0` means no
non-modifier key, while `0x04`–`0x65` and `0x68`–`0x73` select supported keys.
With usage `0`, the modifier mask can produce a modifier-only action (particularly useful for **Keyboard Hold** actions).

## LED Control Action D

Record byte 0 is `(value << 4) | 0xD`; byte 1 is the full command ID.
For commands `00`–`0D`, the `0xF` absolute sentinel means **As Configured** (the earlier proposed `0xFF`
value occupies only four bits here). Relative values use four-bit two's complement:
`1..7` represent +1..+7 and `9..F` represent -7..-1. Zero and -8 are invalid.

| Command Byte | Command | Valid Auxiliary Values |
| --- | --- | --- |
| `00` | **Set Rainbow Phase Spacing** | 0=**0°**, 1=**30°**, 2=**60°**, 3=150°, F=configured |
| `01` | **Relative Rainbow Phase Spacing** | Signed nonzero step -7..+7 |
| `02` | **Set Rainbow Speed** | 0=**Extra Fast**, 1=**Fast**, 2=**Slow**, 3=**Extra Slow**, F=configured |
| `03` | **Relative Rainbow Speed** | Signed nonzero step; positive is faster |
| `04` | **Set Layer-Indicator Brightness** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `05` | **Relative Layer-Indicator Brightness** | Signed nonzero step |
| `06` | **Set Key-Press Brightness** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `07` | **Relative Key-Press Brightness** | Signed nonzero step |
| `08` | **Set Both Brightness Policies** | 0=**Off**, 1=**Dim**, 2=**Bright**, F=configured |
| `09` | **Relative Both Brightness Policies** | Signed nonzero step; step from the brighter resolved policy and set both to the result |
| `0A` | **Restore All Configured LED Settings** | Writers use 0; firmware ignores |
| `0B` | **Set Common Brightness Preset** | Preset index 0..4 |
| `0C` | **Relative Common Brightness Preset** | Signed nonzero step |
| `0D` | Toggle common brightness preset / configured | Preset index 1..4 |
| `80` | Clear temporary effect / as configured | Writers use 0; firmware ignores |
| `81` | **Bright** temporary effect: always on | Palette index, including rainbow |
| `82`–`89` | **Bright** temporary effect: blink 1–8 times | Palette index, including rainbow |
| `90` | (Reserved) | (Reserved) |
| `91` | **Dim** temporary effect: always on | Palette index, including rainbow |
| `92`–`99` | **Dim** temporary effect: blink 1–8 times | Palette index, including rainbow |

All other command IDs and payload values are rejected during image validation.
There are 435 accepted firmware payloads, including ignored restore values; canonical writers use zero for both restore commands. LED commands are legal for every binding, including
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

| Preset | Indicator Policy | Key Policy |
| --- | --- | --- |
| 0 | **As Configured** | **As Configured** |
| 1 | **Dim** | **As Configured** |
| 2 | **Dim** | **Dim** |
| 3 | **Off** | **Dim** |
| 4 | **Off** | **Off** |

Positive common steps advance through this order, wrapping 4 → 0; negative steps
reverse it. The current position is derived from actual policies, so individual
or both-brightness commands can establish a preset. For an unmatched pair, +1 enters
preset 0 and -1 enters preset 4. Larger steps use `(delta - 1) mod 5` for positive
steps and `delta mod 5` for negative steps, with nonnegative modulo.

Toggle compares the current indicator/key policy pair with the selected preset.
If it matches, both policies become **As Configured**; otherwise the preset is applied.
It compares policies, not rendered brightness, and preserves phase and speed.
There is no remembered toggle state. Other LED commands can establish or replace
the matching pair. Preset 0 is invalid for toggle because both endpoints would be
configured.

Command `0D` is part of v16. It was introduced as a v6 extension; earlier v6
firmware rejects images containing it during validation.

Indicator overrides retain the saved color and visibility mode. **Off** removes
indicator animation priority, allowing key feedback. Key **Off** removes the key overlay,
allowing an always-on idle background. Both **Off** blacks out normal lighting.
**Blink** dark phases remain black; dimming retains `(component >> 4) | (component != 0)`.
Hardware preview, invalid-config feedback, and bootloader feedback bypass overrides;
preview uses saved phase/speed. Common presets restore brightness only; Restore all
also restores phase and speed.

## Palette

Palette version 4 offers the same **Off**, fourteen solid colors and **Rainbow**
in pressed-key and per-key layer palettes. Uniform layers use zero as their source
selector rather than a uniform **Off** entry; disable their visibility or brightness
for darkness. **Teal** has no entry. Only four-bit indices are stored.
Representative hex values approximate the hardware appearance, rather than exact
conversions of the firmware RGB values. Existing swatch assets are reused by color.

| Index | Firmware RGB | Representative Hex | Display Name | Swatch |
| --- | --- | --- | --- | --- |
| 0 | `(0, 0, 0)` | `#000000` | **Off** | ![Off](swatches/15.svg) |
| 1 | `(255, 0, 0)` | `#FF0000` | **Red** | ![Red](swatches/00.svg) |
| 2 | `(255, 22, 7)` | `#FF6B5E` | **Coral** | ![Coral](swatches/01.svg) |
| 3 | `(255, 16, 0)` | `#FF4B00` | **Orange** | ![Orange](swatches/02.svg) |
| 4 | `(255, 66, 0)` | `#FFB400` | **Amber** | ![Amber](swatches/03.svg) |
| 5 | `(255, 124, 0)` | `#FFFF00` | **Yellow** | ![Yellow](swatches/04.svg) |
| 6 | `(60, 255, 0)` | `#00FF00` | **Green** | ![Green](swatches/05.svg) |
| 7 | `(100, 200, 20)` | `#40C820` | **Leaf** | ![Leaf](swatches/06.svg) |
| 8 | `(0, 255, 200)` | `#00FFFF` | **Cyan** | ![Cyan](swatches/08.svg) |
| 9 | `(0, 91, 255)` | `#0040FF` | **Azure** | ![Azure](swatches/09.svg) |
| 10 | `(0, 0, 255)` | `#0000FF` | **Blue** | ![Blue](swatches/10.svg) |
| 11 | `(115, 0, 180)` | `#8000FF` | **Violet** | ![Violet](swatches/11.svg) |
| 12 | `(255, 0, 194)` | `#FF00FF` | **Magenta** | ![Magenta](swatches/12.svg) |
| 13 | `(255, 0, 72)` | `#FF0064` | **Rose** | ![Rose](swatches/13.svg) |
| 14 | `(255, 255, 255)` | `#FFFFFF` | **White** | ![White](swatches/14.svg) |
| 15 | Procedural hue wheel | Animated | **Rainbow** | — |

## Mouse Clicks

**Mouse Click** uses type `0x3` for every click count. The first byte is
`((clicks - 1) << 4) | 0x03`; the second byte is the mouse button mask.
For example, `[0x03, 0x01]` is one left click, `[0x13, 0x01]` is two left clicks,
and `[0xF3, 0x01]` is sixteen left clicks. Counts 1–16 require no additional
configuration bytes. Type `0xE` is **Execute Macro**, defined below.

The nominal duration is `(8 * clicks + 200 * (clicks - 1)) / 1000` seconds,
before additional transport/playback latency.
**Mouse Click** is available on keys, encoder press/rotation, chords and both timer
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

## Persistent Mouse State

All **Mouse Toggle**, **Mouse Down** and **Mouse Up** actions share one global
eight-bit persistent mask, initially zero, across keys, encoder press/rotation,
chords, timer expiry/follow-up and macro steps.

| Action | Full First Byte | Operation |
| --- | --- | --- |
| **Mouse Toggle** | `05` | `state ^= buttons` |
| **Mouse Down** | `15` | `state |= buttons` |
| **Mouse Up** | `25` | `state &= ~buttons` |

Each selected bit operates independently. Repeated down/up is idempotent and
creates no ownership count. Up can clear bits set by any input, macro or toggle.
The reported mask is the bitwise OR of persistent state, physical **Mouse Hold**
outputs and temporary click output. Up cannot release a physical hold or click.
An already-matching state need not generate an additional edge.

Releasing a trigger and ordinary macro completion leave persistent state intact.
Effective-layer changes, configuration application and action reset clear it.
Direct actions execute immediately; macro steps execute in playback order.
Changed button reports must be accepted and drained before dependent macro
movement/release steps advance, including under transport backpressure.

Use **Mouse Hold** for a physical drag; **Mouse Down** → pointer movement →
**Mouse Up** for a macro drag; or **Mouse Down** → **Pause** → **Mouse Up** for a
timed press. Down/up are allowed on rotation and both timer slots and as macro
steps, without adding configuration bytes beyond ordinary two-byte records.

## Consumer Taps and Holds with Modifiers

**Media / System with Modifiers** uses type `0xA` for a tap.
**Media / System with Modifiers** set to **Hold** uses type `0xB` for a physical hold.
Both use the auxiliary nibble as a modifier mask and the parameter byte as a
Consumer Page usage. All sixteen modifier masks are valid, including zero; a
zero usage rejects. Modifier bits are `1` = **Ctrl**, `2` = **Shift**, `4` = **Alt**,
and `8` = **GUI**, reported as left keyboard modifiers. Usages above `0xFF`
require the twelve-bit **Consumer Tap** or **Consumer Hold** actions, which have
no action-specific modifiers. There is no firmware usage lookup table.

Taps are allowed on keys, encoder press/rotation, chords, both timer action fields
and macro steps. Holds are allowed on keys, encoder press and chords; rotation,
both timer action fields and macro steps reject them. Each action occupies two
bytes with no macro required. For example:

```text
6A 6F    Shift + Alt with Brightness Up, tap
6A 70    Shift + Alt with Brightness Down, tap
6B 6F    Shift + Alt with Brightness Up, hold
6B 70    Shift + Alt with Brightness Down, hold
```

The temporary modifier mask combines with physical **Keyboard Hold** modifiers
and temporary **Keyboard Tap** modifiers using bitwise OR. The shared USB FIFO
orders any changed keyboard report before the consumer press, and the consumer
release before removing the temporary modifiers. Queue rejection retries the
unfinished stage. Removing the consumer mask preserves modifiers and ordinary
keys contributed by physical holds and keyboard taps. A tap uses up to four
reports; an unchanged keyboard state needs no additional keyboard report.
Macro playback waits for these reports to drain before dependent steps or the
next repetition start. Trigger release has no effect on the tap lifecycle.
A hold retains its contribution until physical release or supersession. Even a
brief hold must assert its press before its release under USB backpressure.

Modified and unmodified actions share the latest-wins consumer lane. A new action
replaces an unsent press. When replacing output with temporary modifiers, the
old consumer release is queued before changing the modifier mask and sending
the new press. Previous held consumer usages and their modifier contributions
are not restored. Releasing an older superseded hold does not release the newer
owner. An ordinary tap's pending release is retained when a modified hold follows,
so that release occurs before the new mask and press.

An effective-layer change cancels pending consumer taps and schedules their
release before modifier cleanup. Physical consumer holds retain their press-time
binding and modifiers across layer changes. Configuration application and action
reset clear temporary ownership and retry release reports under backpressure;
USB reset/reconfiguration follows that configuration-application lifecycle.
A report-generation change alone follows the current output state and reasserts
the winning hold. Normal tap completion or hold release removes its modifier
contribution. Simultaneous output may inherit modifiers while they are active
because the host sees one combined keyboard state. Host interpretation of
modified consumer usages depends on the host and requires hardware verification.

## Action Encoding Examples

| Action | First Byte | Second Byte |
| --- | --- | --- |
| **Mouse Click** | `0x03 \| ((clicks - 1) << 4)` | Mouse button mask 1–255 |
| **Mouse Hold** | `0x34` | Mouse button mask 1–255 |
| **Media / System with Modifiers** | `0x0A \| (modifiers << 4)` | Consumer Page usage `0x01`–`0xFF` |
| **Media / System with Modifiers** set to **Hold** | `0x0B \| (modifiers << 4)` | Consumer Page usage `0x01`–`0xFF` |
| **Mouse Down** | `0x14` | Mouse button mask 1–255 |
| **Mouse Up** | `0x24` | Mouse button mask 1–255 |
| **Nothing** | `0x00` | `0x00` |
| **Type Text** | `0x20` | Offset of a complete NULL-terminated string in the shared pool |
| **Pause** | `0x10` | Duration in 16ms units, 0–255 |
| **Execute Macro** | `0x0E \| ((repeats - 1) << 4)` | Absolute address of a macro step |
| **Consumer Tap** | `0x08 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Consumer Hold** | `0x09 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| **Set Layer**, persistent | `0x0C` | Layer index or `0xFF` |
| **Set Layer**, one-shot | `0x1C` | Layer index or `0xFF` |
| **Momentary Layer** | `0x2C` | Layer index |
| **Relative Layer**, persistent | `0x4C` | Signed offset -6–+6 |
| **Relative Layer**, one-shot | `0x5C` | Signed offset -6–+6 |
| **Relative Layer**, hold | `0x6C` | Signed offset -6–+6 |
| **Move Pointer X**, **Tap** | `0x06` | Signed delta, -127–127; reject `0x80` |
| **Move Pointer Y**, **Hold** | `0x36` | Signed delta, -127–127; reject `0x80` |
| **Move Pointer X/Y**, X=-8, Y=+64, **Tap** | `0x27` | `0xF1` |
| **Move Pointer X/Y**, X=+64, Y=-8, **Hold** | `0x57` | `0x1F` |
| **Scroll Tap** | `0x05` | Signed wheel step, -127–127 |
| **Scroll Hold** | `0x45` | Signed vertical wheel step, -127–127 |
| **Scroll Tap**, **Horizontal** | `0x85` | Signed horizontal step, -127–127 |
| **Scroll Hold**, **Horizontal** | `0xC5` | Signed horizontal step, -127–127 |

**Type Text** shares low-nibble type 0 with **Nothing**: auxiliary 0 is **Nothing** and must
have a parameter ignored by firmware (writers use 0); auxiliary 1 is **Pause**, and auxiliary 2 is **Type Text**. Other auxiliary values reject. Empty
text still requires a valid pool offset pointing at a NULL byte.
These are two-byte binding records; the macro tail instead uses a single `00`
terminator with no parameter, as specified under Macros and pauses.

**Consumer Hold** occupies low-nibble type 9; **Consumer Tap** uses type 8.
Both retain nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. **Hold** is
allowed on keys, encoder press and chords, but rejects on wheel rotation and on
both timer action slots. It adds no configuration bytes.

**Scroll Hold** uses auxiliary bit 2 (`0x40` in the first byte). Auxiliary bit 3 (`0x80` in the first byte) selects
horizontal scrolling. Only auxiliary values 0, 4, 8 and 12 are accepted. Acceleration bits remain reserved
and reject. **Hold** rejects on rotation and both timer action slots. -128 rejects;
zero is a firmware no-op.

Type `0x3` encodes **Mouse Click** and type `0xE` encodes **Execute Macro**. A full first byte
of `0x20` for **Type Text** uses low-nibble type 0 with auxiliary value 2.

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

The **Scroll Axis** control offers **Vertical** and **Horizontal**. A clear
auxiliary bit 3 selects vertical; a set bit selects horizontal. **Scroll Direction**
offers **Up**/**Down** for vertical or **Left**/**Right** for horizontal. The signed
parameter keeps its magnitude (1–127); horizontal negative is left
and positive is right. Horizontal HID AC Pan retains the configured sign.
Host settings and applications can change the visible
scrolling direction or ignore horizontal input. Both axes support **Tap** on any
binding, including encoder rotation and timed actions, and **Hold** on keys,
encoder press and chords. Changing axes does not change step size or hold mode.

The direction hint explains that some computers invert these settings.
**Click Here** opens **Scroll & Click Test**, with a scrollable area on both axes
and separate counters for **Left**, **Middle**, **Right** and **Button 4** through **Button 8**. It warns about
unsaved edits before testing; the device continues to use its saved profile.

Mouse report ID 2 remains five USB bytes including its ID:

| Report Byte | Field |
| --- | --- |
| 0 | Report ID `2` |
| 1 | Eight independent button bits, buttons 1–8 in bits 0–7 |
| 2 | Signed 8-bit pointer X, -127–127 |
| 3 | Signed 8-bit pointer Y, -127–127 |
| 4, bits 0–3 | Signed four-bit vertical Wheel, logical range -1–+1 |
| 4, bits 4–7 | Signed four-bit horizontal Consumer AC Pan, logical range -1–+1 |

Both scroll fields are independent relative HID inputs. Vertical -1/+1 encode
as `0F`/`01`; horizontal -1/+1 as `F0`/`10`. The unused axis is zero. Playback
emits repeated signed unit reports for each configured wheel count, preserving
signs, magnitudes and held-repeat timing. Idle reports and **GET_REPORT** include
all eight held bits with zero X/Y and scroll, so polling cannot replay motion.
The internal `USB_queueMousePacked(buttons, x, y, scroll)` API takes this explicit
packed byte; no button bit is overloaded as an axis flag.

Buttons 4/5 commonly map to browser Back/Forward, but numbered usages do not
guarantee application meanings. Buttons 6–8 require host/application support;
ordinary mouse APIs and browsers may expose fewer buttons. **Scroll & Click Test**
shows eight counters and button states for observed browser events. A missing
browser event does not prove that another application cannot use that button.

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
but remains disabled in v16. Reserved acceleration bits reject during validation.

## Timed Actions

After the layers and sorted three-byte chords come up to four timed actions in
stored order, followed by the shared string pool. Each timer occupies six bytes:

| Offset | Meaning |
| --- | --- |
| 0 | Low eight bits of interval minus one |
| 1–2 | Expiry action, ordinary two-byte encoding |
| 3–4 | Next-input action, ordinary two-byte encoding; **Nothing** is allowed |
| 5 bits 0–2 | Scope: 0 means **All Layers**; 1–7 means zero-based layer index plus one |
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
Consumed encoder presses do not enter the bootloader during use.

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

Temporary-effect command IDs select **As Configured**, **Always On**, or **Blink**
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
reset other LED overrides; use the separate **Restore All Configured LED Settings** command for those. Ordinary LED-control commands may
change the underlying policies while an effect persists. USB color preview and
effects share state and replace each other; physical input cancels USB preview,
but an effect persists unless its configured next-input action clears it.

Example break reminder: expiry `{type: "ledControl", command: "effectOn", value: 15}`,
next input `{type: "ledControl", command: "effectRestore", value: 0}`, consume enabled.
No extra layer is needed, and dismissal does not trigger a binding.
To turn all normal lighting off after inactivity, use **Both Off** and restore
brightness on next input. An **Off** temporary effect has a black background but
still permits keypress overlays when steady; blinking effects cover keypress
feedback throughout their animation.

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

**Execute Macro** is `((repeats - 1) << 4) | 0x0E`, followed by its absolute start
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

Allowed steps are **Keyboard Tap**, **Type Text**, **Mouse Click**, **Mouse Toggle**, **Mouse Down**, **Mouse Up**,
**Media / System with Modifiers**,
**Scroll Tap**, **Consumer Tap**, persistent/one-shot **Set Layer** and **Relative
layer**, pointer movement in **Tap** mode, **LED control**, and **Pause**.
**Nothing** is represented by the single-byte terminator rather than a step.
All normal parameter rules still apply. Reject **Execute Macro**, **Keyboard Hold**,
**Mouse Hold**, **Consumer Hold**, **Media / System with Modifiers** set to **Hold**,
**Scroll Hold**, **Momentary Layer**, **Relative Layer** in hold mode, and held
pointer movement anywhere in the tail, including unreferenced actions. Strings used
by steps share the existing string pool and its start/bounds checks.

A macro invocation occupies one entry in the normal eight-event queue, regardless
of sequence length or repeat count. One active macro streams one step at a time,
using constant runtime state. It does not recursively call itself or expand all
steps into the event queue. Accepted key/mouse reports, releases and consumer-tap
releases complete before the next step starts. Each repetition reloads the
original actions; string indices and mouse click counts reset. The image is
never modified by playback. Later queued actions wait behind the sequence.
Immediate physical/timer LED, consumer, persistent mouse and layer actions retain their
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
and queued macros and clears persistent mouse state and temporary consumer
modifiers after consumer release. A macro's own layer step
therefore ends its remaining steps if the effective layer changes. Selecting the
same effective layer continues. A macro consumes an armed one-shot selection
once at invocation. Steps do not consume another one-shot selection as physical
input would. Relative steps resolve against the then-effective layer.

Macro **Mouse Toggle**, **Mouse Down** and **Mouse Up** steps update global
persistent mouse state as direct actions. There is no per-trigger or per-macro
ownership. Macro consumers use the existing
latest-wins consumer lane;
a new physical consumer action can interrupt it. No held-action lifecycle or
nested macro stack is provided.

**Pause** is `10 nn`, with duration `nn * 16ms`, from 0 to 4,080ms. It is valid
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
10 10   Pause: 16 * 16 = 256ms
20 00   Type Text: string-pool offset 0
01 28   Keyboard tap: Enter
00      End sequence
```

Bind a trigger to `0E 26` (one execution, absolute address `0x26` = 38).
The layer binding itself already occupies its normal two bytes; added data is
7 string bytes plus 9 macro bytes. Repeating once costs no extra data; two
executions change the binding to `1E 26`. UI automation timing is application-
dependent; the example's delay has host-test coverage, not an OS-level guarantee.

A standalone sequence of N steps normally costs `2*N + 1` bytes; an empty
definition costs one byte. Adjacent macros
share neither a directory nor unused fixed slots. The last sequence omits its
terminator if it completely fills the 128-byte configuration space. With one uniform-color layer and no added palette, strings,
chords or timers, at most 48 steps fit on six-key hardware or 52 on three-key
hardware. More layers and other dynamic data share the same 128-byte budget.

## Storage and Verification

The image order is header → fixed layers → additional layer palettes → sorted
chords → timers in stored order → shared string pool → macro sequences / zero padding. Section starts are:

| Section | Absolute Byte Offset |
| --- | --- |
| Layers | `9` |
| Additional Layer Palettes | `9 + layerCount * layerSize` |
| **Chords** | `9 + layerCount * layerSize + paletteBytes` |
| **Timed Actions** | `9 + layerCount * layerSize + paletteBytes + chordCount * 3` |
| **String** pool | `9 + layerCount * layerSize + paletteBytes + chordCount * 3 + timerCount * 6` |
| Macro tail | `stringPoolStart + poolBytes` |

The complete image must satisfy:

`9 + layerCount * layerSize + paletteBytes + chordCount * 3 + timerCount * 6 + poolBytes + macroBytes <= 128`.

Chord count is encoded in five bits (0–31), but capacity and unique valid
identifiers limit the number that can actually fit. With no additional palettes, one six-key layer permits
30 identifiers including global chords. With two or more layers, space permits
at most 25 six-key or 29 three-key chords, even before identifier limits.
One three-key layer permits six identifiers. Thus all valid profiles fit the
five-bit count; 31 does not bypass structural validation. Pair indices must be valid for the hardware
variant: 0–14 for six keys, 0–2 for three keys. Pool length is encoded in seven
bits (0–127) and must fit the remaining image space. A nonempty pool must end in
NULL. **String** sharing includes keys, encoder actions, chords, expiry and next-input
bindings and macro steps. All 128 bytes remain available. Every trailing action
is validated as a macro step, single zero bytes act as terminators/padding, and all
trailing bytes remain CRC-covered.

## HID Configuration Protocol

The v16 configuration uses the following transport-v1 protocol. The shared
[HID transport reference](hid-v1.md) also contains historical format notes;
the v16 version and validation rules in this document apply to v16 firmware.

The USB device retains VID `0x1209` and PID `0xC55D`. Its product string is
`3-Key Macropad` or `6-Key Macropad`, matching the hardware variant. Keyboard and mouse reports use IDs 1 and 2; consumer
controls use ID 5.
A separate vendor-defined Application collection uses usage page `0xFF00`,
usage `0x0001`. Report ID 3 carries 31-byte Output requests and report ID 4
carries 31-byte Input replies. The USB interrupt endpoint packet size is 32
bytes, including the report ID. WebHID passes the report ID separately.

Each request and reply payload has this layout:

| Payload Byte | Meaning |
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

GET_INFO advertises configuration format 16, palette version 4, and
action mask `0x7FFF` (all low-nibble types except reserved type F). The maximum layer count is 5 for six keys and 7 for three
keys; image capacity is 128 bytes. The format version identifies the action map:
the mask alone cannot distinguish submodes of a shared action type or determine
modifier/hold support. Transport version remains 1.

| Opcode | Request | Reply Data |
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
| 10 (`0x0A`) | `ENTER_BOOTLOADER`, offset and length zero | Empty success reply, followed by bootloader entry. |

ENTER_BOOTLOADER works with a valid, invalid or missing profile and does not
write DataFlash. The entire request must pass normal packet validation. Firmware
queues the empty success reply before the main loop releases held outputs,
drains pending USB reports for up to 100ms, sets all LEDs red and enters the
factory bootloader. A USB reset while the reply is waiting to be queued cancels
the request. Unsaved upload staging is lost when the application restarts.
The host should verify normal GET_INFO identity before sending the command,
wait for the acknowledgement, then connect to the separate WebUSB bootloader.
Earlier firmware returns BAD_OPCODE. Do not automatically retry this command
after a missing acknowledgement; use encoder-held-at-power-up recovery if needed.

GET_INFO returns 14 data bytes (offsets below are relative to reply data):

| Data Byte | Field | V16 Value |
| --- | --- | --- |
| 0–3 | Application identity | ASCII `UMAC` |
| 4 | Transport version | `1` |
| 5 | Configuration format | `16` |
| 6 | Physical variant | `0` = six keys, `1` = three keys |
| 7 | Key count | `6` or `3` |
| 8 | LED count | `6` or `3` |
| 9 | Maximum layers | `5` or `7` |
| 10 | Image capacity | `128` |
| 11 | Palette version | `4` |
| 12–13 | Action mask | `0x7FFF`, little endian (`FF 7F`) |

GET_STATUS returns six data bytes: flash-valid flag (0 or 1), current layer,
startup layer, upload state, dropped button-action count, and dropped
rotation-action count. Layer indices are zero-based and reported as zero when
there is no valid active profile. Drop counts saturate at 255.

PREVIEW_COLOR uses the offset byte as compact LED options: bits 4–7 are the
palette index, bit 0 selects full brightness, bit 2 enables preview, and bit 3
allows **Rainbow** at index 15. Bit 1 must be zero. Any nonzero options byte must
have bit 2 set. Index 0 is **Off**. For compatibility with the explicit preview selector, index
15 is solid black when bit 3 is clear and **Rainbow** when bit 3 is set; normal
keypress and per-key layer palettes always interpret index 15 as **Rainbow**. Dimming and rainbow timing
match the always-on layer indicator. Preview works even without a valid saved
profile and changes neither the active image nor flash. It remains active until
explicit cancellation or any debounced button edge / encoder state transition,
including unmapped inputs and partial encoder turns. Inputs retain their normal
actions. Configuration saves preserve preview. Preview commands do not refresh
the upload timeout. Older firmware and
builds with `ENABLE_COLOR_PREVIEW=0` reject opcode 9 as unsupported. A host can
send one cancel command (offset zero) on connection: success confirms preview
support, BAD_OPCODE rejects it, and any other error leaves support unknown.
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

For a changed image, firmware clears and verifies marker byte 0, writes and
individually verifies changed bytes 1–127 (including version and CRC), restores
`B` last, and compares all 128 stored bytes with the intended image. Identical
images require no writes. Configuration erasure clears and verifies only byte 0,
invalidating both B and legacy MP images while leaving byte 1 intact.
Interrupted saves after verified invalidation normally leave an invalid marker;
this does not provide rollback or protection against arbitrary hardware faults.
The final full-image comparison and CRC validation remain required.
If a write fails, the previous active RAM configuration remains in use so the
host can retry. An interrupted save may leave invalid flash; at startup, the
device leaves keys and encoder actions inactive and blinks one red LED at 1 Hz
until a valid profile is uploaded. USB configuration access, HID bootloader
entry and encoder-held-at-power-up recovery remain available. The red error
indication starts on immediately, then alternates 500ms off and 500ms on. It
shares the 500ms blink timer code with the yellow USB warning, but does not use
the USB warning's initial dark phase. USB enumeration and **Key 1** dismissal do
not clear the invalid-configuration error.
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

The released firmware and frozen v16 configurator support the complete binary encoding above.
The user has completed v16 firmware hardware validation. Both supplied release HEX files match fresh temporary native builds.

Release source at revision `780fcc79`, including pre-sleep brightness restoration
and bounded protocol-buffer indexing, produces the following native allocations
with preview enabled and the real 14,336-byte application limit. Restoring the
previous policies changes firmware behavior without changing the binary encoding;
existing format 16 profiles need only the updated firmware.

| Hardware | Flash Used | Flash Free | Paged RAM | Ordinary XSEG | Absolute Image and Runtime Timer | Stack Capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six Keys | 14,286 | 50 | 107 | 372 | 134 | 91 |
| Three Keys | 14,282 | 54 | 107 | 363 | 134 | 94 |

Complete host suites pass with preview enabled and disabled, including both
hardware geometries. Both native builds pass paged/external/absolute layout,
startup clearing and interrupt-parameter checks. Restoration tests cover all
sixteen brightness-policy pairs, all 32 sleep settings, physical wake kinds,
repeated timeouts, reset cancellation and user-timer ordering. Protocol tests
exhaust all byte-sized offset/length pairs for reads and chunk retransmission,
including invalid ranges and mismatches in the last payload byte. Independent
per-key rendering and ignored-field execution tests also pass. Earlier validator
AddressSanitizer checks on revision `4a05616` used exact 128-byte image buffers
for 511,520 sealed-image cases, including malformed images and metadata/pool
boundaries. The validator and original CRC-16 remain unchanged. The user has completed hardware validation for v16.

Build temporary outputs without generating releases:

```sh
python3 tests/run_host_tests.py
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v16-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v16-three 24000000 148 14336 1
```

The absolute active/runtime buffer occupies xRAM `0x300–0x385`. Its first 128 bytes
are the saved profile; its final six bytes synthesize the built-in sleep timer.
Those six bytes are excluded from DataFlash, CRC, protocol reads/writes and
advertised image capacity. Timer state includes five runtime slots, with the last
active slot reserved for **Auto-Sleep**. Pending next-input state occupies bit 0
of each timer's high-age byte; bits 3–5 hold its interval age.
One internal byte stores the packed pre-sleep indicator/key policies, and one
native bit marks a captured snapshot. The synthesized timer uses runtime-only
LED commands `0E` and `0F`; saved-image validation rejects both command IDs.

USB DMA reserves 148 bytes. Total external allocation, including USB DMA, PSEG,
ordinary XSEG and the absolute buffer, is 761 bytes on six keys and 752 on three
keys, leaving 263/272 unallocated bytes including gaps. PSEG occupies `0x094–0x0FE`,
with one byte left in page zero. Ordinary XSEG occupies `0x113–0x286` on six keys
and `0x113–0x27D` on three keys. Seven raw input levels occupy ordinary external
RAM; the last-layer and per-frame layer-palette offsets occupy paged external RAM.

Stack starts at `0xA5` on six keys and `0xA2` on three keys, reserving 91/94 bytes.
The saved brightness byte costs one internal byte compared with the preceding
format 16 source. The resulting reserves remain one byte larger per board than
the published v15 firmware's 90/93-byte reserves (six/three keys).
These are linker capacity figures, not hardware high-water measurements. The
builder checks separation of USB, paged, ordinary and absolute allocations, plus
the USB interrupt's external-RAM parameter storage and startup clearing.
