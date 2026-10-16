# Per-Key Layer Color Investigation

Source reviewed: `8c150a0`, configuration format v15. This is a source-based
design investigation, not an implemented feature. Storage costs are calculated;
no candidate firmware was compiled, so added program-flash, RAM and stack costs
remain unmeasured.

## Palette-Sentinel Proposal

The latest proposal removes **Teal**, reserves palette index `0` for **Off** in
keypress and per-key layer palettes, and retains index `15` for **Rainbow**.
In the existing uniform layer-color field, `0` instead announces a separate
per-key palette. This works because a uniform layer color does not need an
**Off** entry: indicator visibility/brightness already controls disabling it.
All layer indications would use the selected palette, as confirmed by the user.

This is logically consistent and eliminates the separate layer mask without
using another header bit. A new format version identifies the interpretation.
Fourteen solid colors plus **Off** plus **Rainbow** fit exactly in four bits.
An example mapping preserves existing indices 8–14:

| New Index | Meaning |
| --- | --- |
| `0` | **Off** in actual color palettes; per-key source flag in the layer-color field |
| `1`–`7` | **Red**, **Coral**, **Orange**, **Amber**, **Yellow**, **Green**, **Leaf** |
| `8`–`14` | Existing **Cyan** through **White**, unchanged |
| `15` | **Rainbow** |

Keep fixed layer records and store the extra palettes after them, in layer order.
Every layer whose existing color field is zero contributes three extra bytes on
six-key hardware or two on three-key hardware. Other layers contribute none.
The flags determine both which palettes exist and the total section length, so
neither a mask nor a count byte is needed. A zero inside a stored palette means
black; it is never recursively interpreted as another palette flag.

| Enabled Layers | Extra Six-Key Bytes | Extra Three-Key Bytes |
| --- | ---: | ---: |
| None | 0 | 0 |
| One | 3 | 2 |
| Two | 6 | 4 |
| Three | 9 | 6 |
| Every Layer at Maximum Layer Count | 15 | 14 |

Five six-key layers leave nine bytes, enough for three additional palettes with
no other optional data. All five palettes still cannot fit. Seven three-key
layers leave exactly fourteen bytes, so all seven palettes fit with no other
optional data. All actions stay two bytes.

The firmware must scan the layer-color flags to locate the palette section's end,
and count preceding flagged layers to locate a particular palette. Validators,
chord/timer/string offsets and absolute macro offsets must include the palettes.
This uses existing fields instead of a mask, but does not automatically mean
smaller program code: the addressing and validation paths still need measurement.

Rainbow rendering already exists, including shared hue, physical phase spacing,
drift and dimming. Keypress **Rainbow** can reuse it without adding independent
per-key animation state. However, the current renderer explicitly disables
rainbow for keypress colors, and the animation scheduler only recognizes uniform
layer/effect rainbow sources. Both must change. In particular, a pressed rainbow
key must animate even with a solid or disabled layer indicator, and a rainbow
inside a per-key layer palette must animate despite the uniform color field
containing the zero sentinel. Preview's explicit solid/rainbow behavior also
needs the new palette semantics.

**Off** would move from 15 to 0 in the transparent-black test. Selecting saved
keypress **Off** with the existing **Black** option still blanks the background;
runtime keypress brightness **Off** still reveals it. Layer-palette **Off** is
black during layer indications. Index 15 can now mean rainbow consistently in
both actual palettes, while the layer source field retains its special zero.

Old profiles need semantic migration: old solid colors 0–6 move to 1–7, old
**Teal** needs a documented replacement such as **Cyan**, old keypress **Off**
moves to 0, and old layer **Rainbow** stays 15. Temporary-effect colors in direct
bindings, chords, timers and macros need color remapping too; brightness-command
values must not be remapped. A new palette version and the normal format/editor
archive transition are required. No migration or implementation has been made.

The simpler keypress-derived palette remains a useful separate fallback candidate.
It can also gain keypress rainbow under the new palette, but it cannot supply
independent released/pressed colors. Combining both sources in one format is a
separate encoding choice; the zero sentinel alone selects only one extra source.

The user explicitly requested analysis before selecting prototype options.
No prototype, native build, feature optimization, or release generation was run.
The remaining sections retain the earlier mask-based alternative for comparison;
their mask costs and solid-only palette recommendation do not describe this
new sentinel proposal.

## Revised Direction

Treat the new colors as a layer palette containing one color per physical key.
Each color is independently selected, but all belong to the existing layer
brightness policy. The user confirmed that all layer indications should use
these colors, including timed and blinking indications.

Keep the existing pressed-key colors and their global brightness policy. This
avoids per-key brightness modes, a third runtime policy, changes to presets,
and a new meaning for configured key brightness.

The firmware already stores key colors separately from action records. A layer
palette belongs in another optional color table; actions remain two bytes.
Encoder actions, chords, timers and macros need no extra color fields.

## Resulting Behavior

| Setting | Released Keys | Pressed Keys |
| --- | --- | --- |
| **Always On**, dim layer brightness | Per-key layer colors, dim | Existing keypress colors, bright by default |
| **Always On**, full layer brightness | Per-key layer colors, bright | Existing keypress colors, bright by default |
| **On for 1.5 Seconds** | Per-key layer colors during the indication, then dark | Indication overrides keypress colors until finished |
| **Blink by Layer Number** | Per-key layer colors during lit phases; black during dark phases | Indication overrides keypress colors throughout the animation |
| **Do Not Indicate** | No layer lighting | Existing keypress colors |

The existing indication priority and visibility modes can remain unchanged;
only the source of each LED's layer color changes. In particular, the timed and
blinking settings would still finish with no idle layer background. Combining
an initial timed/blinking announcement with an ongoing per-key background would
be an additional behavior, beyond replacing the layer color source. The original
priority requirement is preserved: keypress colors do not cover those animations.

Examples under **Always On**:

- Matching idle and keypress colors, with dim layer brightness, gives
  **Dim Then Bright**.
- Idle **Green** at full layer brightness and keypress **Off** gives
  bright green when released and black when pressed, with opaque key colors.
- Different idle and keypress colors give a color change at the existing
  brightness settings.

There would be no saved per-key **Bright Then Dim** mode. A runtime combination
of bright layer lighting and dim keypress lighting remains possible with the
existing brightness commands, but applies to all keys rather than selected keys.

## Off Already Works With the Existing Opaque Option

The renderer distinguishes a saved keypress color of **Off** from a runtime
keypress brightness override of **Off**:

- Saved keypress **Off**, with **Opaque** selected, draws black over the background.
- Saved keypress **Off**, with **Transparent** selected, reveals the background.
- Runtime **Set Key-Press Brightness** set to **Force Off** removes the keypress
  overlay, revealing the layer background regardless of the saved color.

The profile defaults to opaque behavior. Therefore the proposed press-to-blackout
example needs no new blackout semantics: use a saved keypress color of **Off**
and the existing **Opaque** option. **Transparent** should continue to mean that
pressing an off-colored key leaves its layer color visible.

That option applies across the profile. Mixing opaque-black and transparent
keypress **Off** on different keys would require another feature or encoding.
The controls should explain that changing keypress brightness to **Force Off**
does not mean the same thing as choosing the saved keypress color **Off**.

## Existing Controls Fit This Model

The two existing runtime policies remain sufficient:

- **Set Layer-Indicator Brightness** affects the layer palette, during both idle
  lighting and timed/blinking indications.
- **Set Key-Press Brightness** affects pressed-key overlays.

Both policies are global across layers; neither selects an individual physical
key. All idle colors on one layer share that layer's configured **Full Brightness**
or **Dim** setting. Per-key colors are independent; per-key brightness is not.

The existing presets retain their exact policy meanings:

| Preset | Layer Palette | Keypress Overlay |
| --- | --- | --- |
| **Both as Configured** | Current layer's configured brightness | Bright |
| **Layers Dim, Keys Bright** | Dim | Bright |
| **Layers and Keys Dim** | Dim | Dim |
| **Layers Off, Keys Dim** | Off | Dim |
| **Both Off** | Off | Off |

A saved color of **Off** still renders black at any brightness. The table describes
brightness policies, not a promise that every LED is lit.

Absolute and relative controls, synchronized **Relative Both Brightnesses**,
preset cycling, preset toggle and configured restores can retain their current
implementation. There is still one configured layer brightness and one configured
keypress brightness, so the original proposal's ambiguity about stepping from
mixed per-key dim/bright/off states disappears.

**Auto-Sleep** currently uses preset 2 for dimmed sleep or preset 4 for dark sleep,
then restores preset 0 on wake. Those operations naturally cover the new layer
palette without another sleep policy. Dimmed sleep may show no visible change
if the layer was already dim, just as it can today.

Temporary **Set All LEDs** effects remain separate, explicit color overrides.
Steady effects replace the layer background while allowing ordinary keypress
overlays. Blinking effects cover keypress feedback and include fully dark phases.
System displays, invalid-configuration feedback, bootloader feedback and USB
swatch preview retain their existing handling.

## Storage

The image is limited to 128 bytes. It currently contains a nine-byte header,
22-byte six-key layers or 15-byte three-key layers, then optional chords, timers,
strings and macros. Each layer already has packed keypress palette indices:
three bytes for six keys or two bytes for three keys. Colors require four bits,
not three RGB bytes.

All eight layer-option bits are assigned. Five header bits are reserved: byte 2
bit 7, byte 3 bit 0, and byte 6 bits 5–7. Using reserved bits still requires a new
published format version; current v15 firmware rejects them when nonzero.

### Optional Packed Layer Palettes

A straightforward design uses a reserved header bit to announce an optional
palette section immediately after the fixed layers:

- With the flag clear, no extra bytes are present and all legacy behavior remains.
- With the flag set, a one-byte layer mask identifies layers using a per-key palette.
  Seven bits cover the maximum seven layers; reject bits for nonexistent layers.
- Store packed palettes for enabled layers in layer order: three bytes per
  six-key layer or two per three-key layer.
- Unselected layers retain their existing uniform color or rainbow.

For `P` enabled layers, extra capacity consumed is:

| Use | Six-Key Hardware | Three-Key Hardware |
| --- | ---: | ---: |
| Feature unused | 0 bytes | 0 bytes |
| One enabled layer | 4 bytes | 3 bytes |
| Two enabled layers | 7 bytes | 5 bytes |
| Three enabled layers | 10 bytes | 7 bytes |
| Every layer at maximum layer count | 16 bytes | 15 bytes |

The one-byte mask is shared across the entire profile. It does not cost one byte
per layer. This representation gives each key an independently selected idle
color with no changes to any action record.

Finding a palette involves the fixed end of the layer section plus the number
of enabled preceding layers times the packed palette size. An implementation can
compute the current palette offset once per LED frame rather than search or
copy a table for every LED. No persistent duplicate palette is inherently needed;
the saved image is already available in RAM. Generated code and stack effects
still need measurement.

### Cheaper Alternatives and Their Limits

A profile-wide option to use the existing keypress color table as the layer
palette needs only one reserved header bit and no additional profile bytes.
With dim layer brightness, it gives the original simple **Dim Then Bright** idea.
Every layer indication would also use those colors. However, choosing keypress
**Off** would make that key's layer color off too, so this option cannot provide
the independent green-to-black example.

A profile-wide independent palette mode can imply that every layer has a table,
removing the one-byte layer mask. Its cost is three bytes per six-key layer or
two per three-key layer. It saves one byte when every layer needs a palette but
cannot leave selected layers on the old uniform color source. A two-bit header
source selector could distinguish uniform, keypress-derived, independent-all,
and independent-selected modes. This is a possible compact extension, not a
requirement: supporting multiple representations also adds firmware branches and
validation code.

Sparse per-key records are possible if only one or two keys need exceptions.
A straightforward record needs two bytes for layer/key identity plus a four-bit
color, with an optional count byte for the section. One overridden key costs
three bytes total, but two cost five; the complete six-key palette costs only
four including its shared mask. Sparse records quickly lose their advantage
when several keys on the same layer need independent colors and add lookup work.
The packed per-layer representation is the better initial fit for this proposal.

Do not increase all actions to three bytes. That would charge encoder bindings,
chords, timer actions and macro steps for a physical-key lighting setting they
do not use. It also does not address the firmware's program-flash limit.

### Maximum-Layer Profiles Are Tight

Five six-key layers already occupy `9 + 5 * 22 = 119` bytes, leaving nine bytes
for every optional feature combined. The selected-layer design can cover two of
those layers for seven bytes, but three palettes would exceed capacity even with
no chords, timers, strings or macros. All five independent palettes need 15 bytes
even if the mask is omitted, so they cannot fit at five layers in the current
128-byte image.

Seven three-key layers occupy `9 + 7 * 15 = 114` bytes, leaving 14. Seven packed
palettes need exactly 14 bytes. They fit only if the all-layers mode omits the
mask, and leave no space for other optional content. With a mask, six selected
palettes fit for 13 extra bytes; all seven do not.

These are capacity tradeoffs when the feature is used. Profiles that do not
use it retain their present capacity with an optional-section design.

### The Section Needs a Defined Boundary

The existing macro tail is not free-form padding: every nonzero trailing byte
is validated as a macro action or parameter. Arbitrary palette data cannot just
be appended to unused zeros without format changes.

Placing the new section after the fixed layers preserves existing binding,
keypress-color and layer-option addresses, but shifts the starts of chords,
timers, strings and macros. Update all readers, validation, capacity accounting,
encoder/decoder logic and absolute macro offsets together. Keep CRC coverage over
all 128 bytes and the existing marker-last DataFlash save procedure. The HID
transport and advertised image capacity need not change.

## Other Decisions and Complexities

### Off Versus Rainbow in the New Palette

Uniform layer color index 15 currently means **Rainbow**. Keypress color index 15
means **Off**. For the new per-key layer palette, using index 15 for **Off** is
useful and avoids new rainbow scheduling rules, but it means this source supports
15 solid colors plus black rather than per-key rainbow.

Alternatively, index 15 could retain the layer meaning of **Rainbow**, allowing
individual rainbow keys mixed with solids. Then there is no black entry without
another bit or encoding. Per-key rainbow also requires checking the new palette
in the animation-service condition, which currently decides whether to animate
from uniform layer/effect options. This is a real design choice; treating the
colors as layer colors for brightness does not itself decide palette encoding.

Recommended first version: solid colors plus **Off** in custom palettes; retain
uniform **Rainbow** for layers that use the existing color source. A derived
keypress palette should likewise treat its index 15 as **Off**.

### Indications and Layer Identity

Timed/blinking indications would display the per-key layer palette, as requested.
Different colors between layers still identify layers; numbered blinking still
communicates the layer number. Keys assigned layer **Off** stay dark during lit
phases, so they do not participate in the announcement. An entirely black palette
would make the indication invisible, even though its priority still temporarily
covers keypress feedback. That deserves a configurator hint.

Layer-indicator brightness **Off** currently removes animation priority and
allows keypress feedback. Preserve that existing exception. Dark blink phases
remain fully black, including keys whose normal layer color is black.

### Physical State and Effective Layers

The renderer uses debounced physical state and the current effective layer.
Chords show their constituent keys, a key assigned **None** can still light,
and keys can change colors when a layer changes while held. One-shot layers
may be consumed before the triggering key is released. Preserving these rules
needs no press-origin color latch or application-state tracking.

These lights would not track a toggled mouse button, application mute state,
macro completion, or other persistent action state. That would be another feature.
The encoder has no separate configured LED in the current hardware model.

### Brightness and Configurator Work

The existing dim transform is `(component >> 4) | (component != 0)`. It is a fixed
low brightness, not a configurable percentage. All palette keys share the layer's
brightness. Hardware checks should confirm useful contrast and readable colors.

The editor should place palette controls with layer lighting, while allowing
selection of each key's layer color. Keep the keypress color control separately
identified. Copy/paste, swap, reorder, layer duplication, variant conversion,
JSON, drafts and change review must carry the complete color data consistently.
The storage meter needs to show only the additional palettes actually encoded.

The device drawing currently presents saved keypress colors rather than fully
simulating the firmware renderer. A layer-color view or released/pressed preview
would help distinguish the two palettes. The current hardware swatch preview
lights every LED uniformly; previewing the whole palette would require additional
preview behavior, or applying the profile to test it. A uniform swatch preview
can still test individual chosen colors without protocol changes.

## Firmware Feasibility and Next Step

Published v15 measurements report 14,222 program-flash bytes on six-key hardware
and 14,218 on three-key hardware, against a 14,336-byte limit: 114/118 bytes free.
The current stack capacities are 90/93 bytes. These are recorded release results,
not fresh measurements from this investigation.

The revised model removes the original proposal's mode decoder, mixed configured
brightness handling, and potential third brightness policy. The main firmware
additions are palette-section validation/addressing and selecting a layer color
per LED before the existing indication/keypress decisions. It is a materially
simpler candidate, but whether the complete implementation fits is unmeasured.
Even when a profile disables the feature, its support code still consumes flash.

A useful next step is an isolated temporary-source feasibility build of the
selected encoding, including validation and moved section offsets, for both
hardware variants. A renderer-only probe understates the final cost. Preserve
stack capacity where possible and report any reduction. No feature cuts should
be adopted just to make this fit without the user's approval.

Validation should cover all layer modes, palette **Off**, opaque/transparent
keypress **Off**, all brightness presets/relative commands, temporary effects,
sleep/wake, layer transitions while held, malformed/truncated palettes, maximum
capacity, and moved string/macro offsets. Use existing host suites with/without
preview and native layout checks for both variants; add relevant codec, capacity,
import and key-movement checks for configurator work.

A published encoding change needs a new format version, migration that defaults
old profiles to their existing uniform layer colors, and a frozen outgoing v15
configurator before changing the active editor. This investigation changed only
this note; no firmware, configurator, releases or archives were changed.

## Source References

- `CH552_Universal_Macropad.ino`: `indicatorBrightness`, `updateLeds`,
  `firmwareLedAction`, `scanButton`, and rainbow servicing in `loop`.
- `src/config.h` and `src/config.c`: header fields, fixed layer layout, color
  accessors, section offsets and image validation.
- `src/timed_actions.inc`: built-in sleep's existing brightness-preset actions.
- `webapp/src/model/ledControl.ts`: policies and common-preset definitions.
- `webapp/src/ui/components/ProfilePanel.tsx`: opaque/transparent color behavior.
- `webapp/src/codec/encode.ts`, `decode.ts`, and `model/capacity.ts`: image layout.
- [Current Format Specification](config-v15.md): saved format and published
  firmware memory measurements.
