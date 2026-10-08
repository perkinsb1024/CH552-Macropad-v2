# V12 Mouse Actions and HID Plan

## Status and Agreed Scope

Implementation is complete from finalized v11 release commit `418894a`, including
all eight buttons, down/up actions, configurator support and both bonus features.
See [implementation and validation](v12-mouse-implementation.md) for measurements
and checks, and [config-v12.md](config-v12.md) for the standalone wire reference.
Hardware compatibility validation remains pending.

The rest of this document preserves the original plan and investigation record.
It scheduled production implementation after v11 finalization. All three
additions belong to config v12, in this priority order:

1. Support mouse buttons 4 and 5.
2. Add **Mouse down** and **Mouse up** alongside **Mouse toggle** in action type
   `0x5`. Repeated down is idempotent: down → down → up leaves the persistent
   state released.
3. Repack the HID mouse report to make room for buttons 6–8, subject to flash
   measurements and host compatibility validation.

These are implementation checkpoints within one proposed format, not separate
public formats with different meanings for version 12. No firmware, configurator
or current protocol behavior changes are made by this plan. The five-button
prototype is a build-only probe using v11 sources; it is not a complete v12 image.

## Existing V11 Behavior

The production baseline for this investigation is revision
`3b6ceeb4c2d428cd4f6046f80c0eac7625071cdb`. Global toggles are already implemented
there. All keys, encoder inputs, chords, timers and macros share one persistent
mouse-button mask. Each **Mouse toggle** XORs its selected bits into that mask.
Effective-layer changes, configuration application and action reset clear it;
ordinary macro completion and physical trigger release do not.

The reported mouse buttons combine the persistent mask, physical **Mouse hold**
outputs and temporary **Mouse click** output using bitwise OR. Clearing a
persistent bit cannot release a button still being physically held or clicked.

The previous implementation maintained separate per-input toggle latches and a
macro latch. Either owner could keep the same button down. That model could
protect overlapping activities, but a toggle on one input could not undo a
toggle on another. It was replaced with global state for clearer behavior.

## Configuration Masks and HID Reports

The configuration parameter is a bitmask, not a maximum button number. Current
v11 accepts nonzero masks `1–7`, meaning any combination of three buttons:

| HID Button | Label | Mask Bit / Value |
| --- | --- | --- |
| 1 | **Left** | Bit 0 / `0x01` |
| 2 | **Right** | Bit 1 / `0x02` |
| 3 | **Middle** | Bit 2 / `0x04` |
| 4 | **Button 4** | Bit 3 / `0x08` |
| 5 | **Button 5** | Bit 4 / `0x10` |
| 6 | **Button 6** | Bit 5 / `0x20` |
| 7 | **Button 7** | Bit 6 / `0x40` |
| 8 | **Button 8** | Bit 7 / `0x80` |

Five buttons use nonzero masks `1–31`; eight use `1–255`. A mask of `0x18`
selects buttons 4 and 5. All combinations retain the existing two-byte action
record size. Button 4/5 names should identify their numbers; browser back/forward
are common mappings, not guaranteed meanings.

The USB HID mouse report is separate from configuration transport. Its layout
is described to the host by `src/userUsbHidKeyboardMouse/USBconstant.c`:

| Report Byte | Current V11 Layout |
| --- | --- |
| 0 | Report ID 2 |
| 1 | Bits 0–2: buttons; bits 3–5: padding; bits 6–7: signed horizontal scroll |
| 2 | Signed 8-bit X movement |
| 3 | Signed 8-bit Y movement |
| 4 | Signed 8-bit vertical scroll |

Both scroll axes currently emit repeated unit events. A configured delta of 10
becomes ten reports with delta +1. The horizontal two-bit field only needs the
values -1, 0 and +1. Vertical scroll currently has an entire byte, despite
playback also emitting unit steps.

## Priority 1: Buttons 4 and 5

The preserved probe makes three firmware changes:

- Change the HID button usage maximum and report count from 3 to 5, and reduce
  button-byte padding from three bits to one bit.
- Change the saved mouse-state mask from `0x07` to `0x1F` in
  `USBHIDKeyboardMouse.c`.
- Expand mouse click/hold/toggle parameter validation from `1–7` to `1–31` in
  `src/config.c`.

Horizontal scroll stays in bits 6–7. The descriptor has the same byte length;
mouse reports remain five bytes. Existing state variables already have room
for the new button bits. Native builds showed no flash, RAM or stack increase.

The probe does not update the version, editor, tests or documentation for a
released feature. It has not been validated on hardware. Do not flash it as a
v12 release or apply it directly to the v11 release sources.

## Priority 2: Explicit Persistent Down and Up

Keep **Mouse click** and **Mouse hold** unchanged. Add two user-facing actions
without presenting confusing combinations such as **Mouse up** with **Hold**:

| Action | Full First Byte | Auxiliary Nibble | Parameter | Macro Step |
| --- | --- | --- | --- | --- |
| **Mouse hold** | `0x04` | 0, type `0x4` | Button mask | No |
| **Mouse toggle** | `0x05` | 0, type `0x5` | Button mask | Yes |
| **Mouse down** | `0x15` | 1, type `0x5` | Button mask | Yes |
| **Mouse up** | `0x25` | 2, type `0x5` | Button mask | Yes |

For type `0x5`, reserve and reject auxiliary values 3–15. Type `0x4` continues
to require auxiliary zero and a physical release-capable trigger. Do not use
its free auxiliary bits for this feature: down/up have a persistent lifetime,
whereas **Mouse hold** follows the physical input's lifetime.

Apply each operation to the same global persistent mask:

```text
Toggle: state ^= buttons
Down:   state |= buttons
Up:     state &= ~buttons
```

Each selected button bit operates independently. Repeating **Mouse down** does
not add owners or increment a counter. **Mouse up** clears selected persistent
bits, including bits enabled by another input, macro or toggle. It does not
override physical holds or temporary clicks. All existing layer/reset cleanup
continues to clear the persistent mask. Macro completion does not clear it.

Direct bindings act immediately; macro steps run in playback order. A changed
button report must be accepted and drained in the same ordered manner as other
macro output before dependent movement/release steps advance. An operation on
an already-matching state need not manufacture a fresh press/release edge.

Common configurations:

- Physical dragging: **Mouse hold**.
- Separate drag start/finish inputs: **Mouse down** and **Mouse up**.
- Automated drag: **Mouse down** → pointer movement → **Mouse up**.
- Timed press: **Mouse down** → **Pause** → **Mouse up**.
- Idempotent enable/disable controls: separate **Mouse down** / **Mouse up**.
- Alternating one-button control: **Mouse toggle**.

No additional persistent state is expected. Flash cost is unmeasured; no
down/up firmware or editor prototype was created during this investigation.

## Priority 3: Eight Buttons and Packed Scroll Axes

Proposed HID layout, keeping the five-byte report size:

| Report Byte | Proposed V12 Layout |
| --- | --- |
| 0 | Report ID 2 |
| 1 | Eight button bits |
| 2 | Signed 8-bit X movement |
| 3 | Signed 8-bit Y movement |
| 4 | Low nibble: signed vertical scroll; high nibble: signed horizontal scroll |

Declare two independent relative scroll fields in the HID descriptor, using
**Wheel** and **AC Pan** usages. Each field can use a logical range of -1 to +1
to match current unit-step playback, with a four-bit signed representation.
The unused axis is zero. For example, vertical -1 / +1 encode as `0x0F` /
`0x01`; horizontal -1 / +1 encode as `0xF0` / `0x10`. This is field packing,
not one shared delta whose axis the OS must infer.

The internal `USB_queueMouse` button argument currently uses `0x80` as a
horizontal-scroll marker. That collides with button 8. Remove that overload
and explicitly carry or prepack scroll-axis information outside the button
mask. Keep ordinary button bit 7 intact through playback, USB queuing, idle
reports and **GET_REPORT**. Define and test the revised internal API rather
than silently treating old signed-wheel arguments as packed scroll bytes.

Extend validation to all nonzero byte masks only after the whole path preserves
all eight bits. Preserve unit-step vertical/horizontal behavior, acceleration,
held-repeat cadence, queue ordering and backpressure handling. No report-buffer
or persistent-state growth is expected, but flash and descriptor sizes are
unmeasured. No eight-button or packed-scroll prototype has been created.

Eight is a natural one-byte encoding limit, not a guarantee of application
support. The USB HID Button Page defines numbered usages through 65535.
Windows' ordinary mouse-message interface documents five buttons. Buttons 6–8
therefore require OS/application testing and clear compatibility wording;
advertising the usages does not make all applications recognize them.

Sources reviewed:

- [USB HID Specification 1.11](https://www.usb.org/sites/default/files/hid1_11.pdf),
  report field sizes and packing.
- [USB HID Usage Tables 1.7, Button Page](https://usb.org/sites/default/files/hut1_7.pdf#page=111),
  numbered button usages.
- [Microsoft Mouse Input Overview](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-mouse-input),
  five-button ordinary mouse input and common side-button mappings.

## Versioning and Compatibility

Config version 12 identifies these modes and button masks. The action-type mask
remains `0xFFFF`; it cannot distinguish auxiliary modes. USB configuration
transport can remain version 1. Existing action codes and two-byte record sizes
remain unchanged. Produce a standalone, complete config-v12 reference during
implementation rather than treating this plan as that specification.

Keep a frozen v11 configurator for v11 devices using the existing version/archive
mechanism. Older firmware rejects the new auxiliary values and larger button
masks. Migrate v11 profiles without changing their existing actions, macro
semantics, strings, timers or storage requirements. Cover older JSON/drafts and
binary versions using their original action maps. The v12 **Mouse down** and
**Mouse up** JSON actions can use semantic names `mouseDown` and `mouseUp` with
the existing `buttons` property.

Version 12 is available for this production configuration format. The historical
fixed-pair macro experiment's temporary use of that number is disregarded;
it creates no compatibility or migration requirement for production v12.
Production v12 retains variable-length macros, not fixed pairs.

Remove `CONFIG_MACRO_STYLE` from production firmware and tests as part of this
feature. Keep the current variable-length macro validation and playback paths
unconditionally, remove the fixed-pair alternatives, and replace the conditional
`CONFIG_VERSION` expression with the production version. Preserve current
single-byte terminators, image-boundary termination, repeats and pauses.
Historical comparison scripts can continue reconstructing their pinned sources;
they do not require experimental branches in current production firmware.
Verify unchanged macro behavior and measure both hardware variants after cleanup.

## Measurements and Preserved Code

Measured with SDCC 4.2.2 build.13407_4, 24 MHz, 148 USB DMA bytes, and the real
14,336-byte application flash limit. These are native temporary builds, not
generated releases. Stack figures are linker-reserved capacities.

| Implementation | Flash, Six / Three | Spare Flash, Six / Three | Paged RAM | Stack, Six / Three |
| --- | ---: | ---: | ---: | ---: |
| Separate toggle ownership | 14,332 / 14,328 | 4 / 8 | 108 | 79 / 82 |
| Global toggles, current v11 | 14,284 / 14,280 | 52 / 56 | 95 | 79 / 82 |
| Global toggles plus five-button probe | 14,284 / 14,280 | 52 / 56 | 95 | 79 / 82 |

Global toggles save 48 flash bytes and 13 paged RAM bytes per board. The
five-button probe adds zero measured flash or RAM. Neither result measures
down/up or the eight-button report redesign. Global-toggle host suites and
added physical/macro/hold/reset checks passed; the five-button probe only has
native build/layout validation, not new feature regressions or hardware results.

Artifacts are preserved in [mouse-v12-experiments/measurements.json](mouse-v12-experiments/measurements.json):

- `global-toggle.patch`: original temporary global-toggle firmware and host
  regression changes against pinned `a2b9338`; the production implementation
  already includes this behavior and broader tests.
- `five-buttons.patch`: exact three-file firmware probe against pinned
  `3b6ceeb`, with no v12 version change.
- `original-*-results.json`: original map symbols and complete memory reports.
- `original-build-driver.py`: original temporary build driver. Its historical
  prototype directory was named `global` in both investigations.
- `reproduce.py`: reconstructs pinned sources, applies patches in temporary
  directories, verifies changed-source SHA-256 hashes, builds both variants and
  checks results against the recorded measurements. Requires the existing
  CH55xDuino toolchain and the baseline commits in local Git history.

From the repository root:

```sh
python3 protocol/mouse-v12-experiments/reproduce.py --case five-buttons
python3 protocol/mouse-v12-experiments/reproduce.py --case global-toggle
python3 protocol/mouse-v12-experiments/reproduce.py --case all --prepare-only
```

The reconstruction no longer depends on the original `/private/tmp` folders.
It emits ordinary temporary build outputs, without modifying the working
firmware, flashing a device or generating files in `releases/`.
On 2026-10-07, `--case all` successfully reconstructed both experiments and ran
all eight native builds; every recorded flash/RAM/stack measurement matched.

## Implementation and Validation Checklist

After v11 release finalization:

1. Establish production format 12 and preserve the v11 configurator/version
   routing. Remove `CONFIG_MACRO_STYLE` and fixed-pair branches from production
   firmware/tests, retaining the current variable-length implementation and
   pinned historical experiment reproduction.
2. Implement five-button firmware support from the preserved probe. Add editor
   controls, action summaries, profile validation, binary encoding/decoding,
   JSON/draft migration and mouse test-panel support. Keep button numbering
   separate from UI list order and browser event numbering.
3. Implement type-`0x5` auxiliary modes in direct dispatch and macro playback.
   Add semantic editor/JSON actions and allow down/up in macros, rotation and
   both timer slots while continuing to reject release-dependent held steps.
4. Measure both hardware variants before and after down/up. Preserve stack
   capacity, report any reduction explicitly, and stay within real flash/RAM
   limits. Prioritize five buttons and down/up over the eight-button extension
   if the combined implementation does not fit.
5. Implement packed scroll fields and remove the internal button-8 conflict.
   Extend masks/editor controls to eight buttons and remeasure both variants.
6. Add firmware regressions for each new bit and combinations, repeated down,
   repeated up, toggle/down/up interactions, independent physical holds,
   ordered macro drags, timer/chord/encoder triggers, cancellation and reset.
   Verify horizontal and vertical signs/step counts while high mouse buttons
   remain held, transport backpressure, idle reports and **GET_REPORT**.
7. Add web regressions for version gates, unsupported/reserved encodings,
   round trips, macro storage relocation, repeat semantics, legacy migration
   and side-button input monitoring. Document that browser/application support
   for extra buttons may limit what the test panel observes.
8. Run firmware host suites, native builds/layout checks for both geometries,
   relevant web tests, and `npm run build` from `webapp/` after app changes.
   Hardware-test buttons 4/5, down/up drags, scroll preservation and buttons
   6–8 on available host platforms. Record actual compatibility results.
9. Write the complete config-v12 specification and update user documentation
   and current measurements. Generate releases only when explicitly requested
   for that release task; implementation and measurements alone do not authorize it.

No blocking user clarification remains. Open technical questions are measured
flash cost for down/up and packed scrolling, HID parser acceptance of the new
layout, and useful host/application support for buttons 6–8.
