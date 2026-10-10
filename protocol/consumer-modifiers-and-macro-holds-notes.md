# Consumer Modifiers and Macro Hold Support Notes

These notes capture the discussion of self-contained modified consumer actions
and keyboard holds inside macros. The broader alternatives remain design
context. The persistent modifier path now has a firmware-only v13 implementation;
see [implementation and measurements](v13-modifier-implementation.md) and the
standalone [v13 binary reference](config-v13.md).

The current exploratory path is persistent modifier down/up/toggle actions,
using an action type freed by consolidating mouse hold with mouse
down/up/toggle. This would let macros bracket existing consumer taps and other
actions with modifiers. Both hardware variants now fit without feature cuts,
with net flash increases of 4/6 bytes and stack reserves increased to 79/82
bytes. The details below retain the exploratory design rationale; configurator
and migration work and host hardware verification remain outstanding.

## Motivation and Current Behavior

The motivating use case is macOS fine brightness adjustment: Option+Shift plus
a brightness key adjusts brightness in smaller steps. The user observed roughly
6–7% steps normally and approximately 1% steps with those modifiers. These are
observations, not precision guarantees made by the firmware.

Existing **Media / system** actions send a Consumer Page usage without an
action-specific keyboard modifier mask. **Key tap** and **Key hold** have a
four-bit modifier mask, but cannot encode a consumer usage.

Macros reject **Key hold** and other actions that require a physical
press/release lifecycle. A macro completes a keyboard tap, including its release,
before starting the next step. A modifier-only **Key tap** followed by a consumer
tap therefore does not keep those modifiers held during the consumer action.

An existing two-input workaround is to assign **Key hold** with
**No key (modifiers only)** and Alt+Shift to one button, then operate brightness
buttons or encoder rotation while holding it. The firmware combines physical
keyboard holds with consumer output. This does not provide a self-contained
modified brightness action on a single input.

## Consumer Action Encoding

Version 12 actions occupy two bytes:

| Field | Bits | Current Consumer Meaning |
| --- | --- | --- |
| First byte, low nibble | 4 | Action type: 7 for tap, 8 for hold |
| First byte, high nibble | 4 | High four bits of consumer usage |
| Second byte | 8 | Low eight bits of consumer usage |

The existing consumer actions accept nonzero usages from `0x001` through `0xFFF`.
Supporting that full range leaves no room for modifiers in the current encoding.

A possible alternative encoding uses four bits for the action type, four bits
for Ctrl/Shift/Alt/GUI, and eight bits for a consumer usage. This would support
any nonzero usage from `0x01` through `0xFF` directly. It needs no predefined
usage lookup table in firmware flash. The configurator may still offer names
and grouped choices without imposing a firmware whitelist.

The controls discussed fit within eight bits:

| Control | Consumer Page Usage |
| --- | --- |
| Display brightness up/down | `0x6F` / `0x70` |
| Keyboard brightness up/down | `0x79` / `0x7A` |
| Volume up/down | `0xE9` / `0xEA` |
| Mute | `0xE2` |
| Play/pause | `0xCD` |
| Next/previous track | `0xB5` / `0xB6` |

Usage values are defined in the [USB HID Usage Tables](https://usb.org/sites/default/files/hut1_5.pdf).
Keyboard brightness controls are not currently listed in the v12 configurator's
named consumer choices; they would need to be entered as custom usages.

Launch and browser usages often exceed eight bits: Calculator is `0x192`,
Email is `0x18A`, and Browser Back is `0x224`. Retaining the existing 12-bit
actions alongside the proposed encoding would preserve these controls.

All sixteen low-nibble action types are already allocated in version 12.
The proposed encoding consequently needs an extension or reallocation in a new
configuration format; it cannot simply take an unused type. No particular
encoding or migration strategy has been finalized. The current exploratory path
below instead reuses that type space for persistent modifier actions, retaining
the existing 12-bit consumer actions unchanged.

## Host Use Cases and Limits

macOS modified volume and brightness controls are the clearest built-in use case.
Apple also documents Option plus volume/brightness to open settings, Control
plus brightness to adjust a supported external display, and Command plus
Brightness Down to toggle display mirroring. See
[Apple's keyboard shortcut reference](https://support.apple.com/en-us/102650).
Those shortcuts are documented for Mac keyboards. Their behavior with this
device's generic HID consumer reports still requires hardware verification.

Custom application bindings provide another use case. For example, mpv supports
multimedia keys and modifier combinations in configurable bindings; a user could
assign Ctrl plus Next Track to another playback command. See the
[mpv manual](https://mpv.io/manual/stable/). This is a configurable application
behavior, not a universal OS meaning for the combination. Ordinary keyboard
shortcuts already cover many such custom binding needs.

## Report Ordering and Ownership

A modified consumer action would send modifiers in a keyboard report and the
usage in a separate consumer report. Adding bits to the configuration encoding
does not itself establish the required output lifecycle.

Implementation must ensure the modifier press precedes the consumer press and
the modifiers remain active through the consumer release. It must preserve
modifiers held by other physical inputs when removing the action's temporary
modifiers. USB queue backpressure, interruption by another consumer action,
layer changes, configuration application, and USB reset need defined behavior.

Consumer actions currently share a latest-wins lane. A newer tap or hold can
interrupt the prior consumer output, and previous held usages are not restored.
Any temporary modifier ownership must be reconciled with that behavior. A tap
implementation could cover encoder and macro use without also implementing a
modified consumer hold; that scope decision remains open.

### Preliminary Modified Consumer Tap Resource Estimate

Assuming a dedicated action type is available, a self-contained modified
consumer tap is estimated to require 250–500 bytes of additional firmware flash,
with approximately 350 bytes as a planning figure, and 2–4 bytes of additional
runtime state. These are rough estimates from the current code structure, not
measured builds or resource guarantees. SDCC code generation and the final
interruption policy could materially change the costs.

This estimate assumes the four-bit modifier mask plus eight-bit usage encoding
described above, support for physical inputs, encoder rotation and macro steps,
and retention of the existing unmodified 12-bit consumer actions. It includes
firmware validation/dispatch, merging temporary modifiers with physical holds,
ordering modifier press before consumer press and modifier release after
consumer release, USB backpressure handling, reconciliation with latest-wins
consumer interruption, and cancellation/reset cleanup. The runtime state would
track temporary modifier ownership and lifecycle progress; placement should
preserve the stack reserve.

The action still occupies two configuration bytes, so there is no increase in
per-action configuration storage. It reuses the existing keyboard and consumer
HID reports and USB report queue; no usage lookup table, new report descriptor,
or additional report buffer is needed. The complete action can require up to
four reports: modifier press, consumer press, consumer release, and modifier
release. Unchanged modifier states may avoid the corresponding keyboard reports.

The estimate excludes modified consumer holds, general macro holds, solving
action-type allocation, and configuration-format migration. Configurator changes
are also outside this firmware resource estimate. Modifier ownership still adds
real lifecycle work even with an action type available, but ordinary-key storage
and six-key slot handling are unnecessary. Measure both hardware variants before
using these figures to make a final resource decision.

## Macro Hold Alternatives

Supporting a modified consumer tap directly would solve the motivating use case
without introducing general keyboard holds in macros.

General macro hold support is a separate, broader design question. Simply
allowing the existing **Key hold** step would be insufficient because macro
steps have no physical release event. Possible designs include explicit keyboard
down/up steps or a scoped modifier state that is automatically cleared when
playback ends. Neither design has been selected or implemented.

Such a design must specify ownership, overlap with physical keyboard holds,
release between repetitions, and cleanup on normal completion, cancellation,
layer change, configuration application, and USB reset. It also needs a policy
for unmatched presses/releases and interactions with keyboard taps and text.
Existing persistent mouse down/up behavior is useful context but does not
automatically define suitable keyboard ownership semantics.

### Per-Run Release Proposal

A further proposal is to allow **Key hold** steps whose release event is the end
of one macro run. Each repetition would release its holds before the next run
starts; holds would not span the entire invocation's repeat count. This is
technically workable, but has not been implemented or measured.

The proposed semantics are accumulating holds: each step adds its modifiers and
optional ordinary key to macro-owned state until the run ends. Reports combine
that state with physical holds and temporary taps. Cleanup removes only the
macro's contribution, preserving keys and modifiers still held by physical
inputs. The release reports must drain before the next repetition begins, and
cancellation must clear macro ownership too.

For example, **Key hold** with Option+Shift and **No key (modifiers only)**,
followed by **Media / system** brightness up, would press the modifiers, press
and release the consumer usage, then release the modifiers. This provides the
required HID ordering; host behavior still needs hardware verification.

Other possible benefits include continuous modifier sequences such as holding
Command across multiple Tab taps, modified mouse clicks/scrolls/drags, timed
ordinary-key presses using **Pause**, and overlapping ordinary keys. Individual
**Key tap** actions already support modifiers; the added capability is keeping
state active across multiple steps and report types.

The main limitations and implementation complications are:

- End-only release cannot return to unmodified output midway through a run.
  Later taps and **Type text** inherit held modifiers, potentially activating
  shortcuts instead of entering text.
- Tapping a key already held by the macro produces no fresh press unless that
  key is first released. Long ordinary-key holds may trigger host key repeat.
- The six ordinary-key report slots require an overflow policy that cannot
  leave playback waiting indefinitely for a slot occupied by its own holds.
- Immediate physical consumer actions can interleave with playback and receive
  the macro's held modifiers. Ownership cannot isolate modifiers to one action
  because the host sees a combined keyboard state.
- Supporting other hold types adds separate problems: consumer ownership must
  reconcile with the latest-wins lane; pointer/scroll repeats currently wait
  for playback to become idle; momentary layers conflict with cancellation on
  effective-layer changes. Keyboard-only support would be a narrower first scope.

### Preliminary Resource Estimates

These are rough estimates from the current code structure, not measured builds
or resource guarantees. SDCC code generation could materially change the costs.

| Scope | Estimated Additional Firmware Flash |
| --- | --- |
| Modifier-only macro holds | 200–400 bytes |
| Keyboard holds including ordinary keys | 400–800 bytes; approximately 600 bytes for planning |
| Keyboard, mouse, consumer, pointer and scroll holds | 1–2KB, potentially more |

Keyboard-only support would likely need approximately 8–12 bytes of additional
runtime state, preferably placed where it does not reduce the stack reserve.
Its flash estimate includes report merging, hold-step handling, release between
repetitions, and cancellation cleanup. Modifier-only support is cheaper because
its accumulated state is a bitmask; ordinary keys also require storage, merging,
and report-slot handling.

### Current Decision

Defer general macro hold support. The expected flash cost and implementation
complexity outweigh the benefits for this device; finding that space may require
cutting other features. The per-run release proposal remains investigation
context, not an implementation plan.

Investigate persistent modifier down/up/toggle actions as the current exploratory
path forward. This narrower design follows the existing persistent mouse state
model and allows explicit release midway through a macro. Self-contained
modified consumer taps remain a separate alternative, with their encoding and
lifecycle still undecided.

## Current Exploratory Path: Persistent Modifier Actions

### Proposed Encoding

Consolidate **Mouse hold** into type `0x5` with auxiliary value `3`, alongside
the existing toggle/down/up modes. Reassign type `0x4` to modifier
toggle/down/up. All actions remain two bytes:

| Type | Auxiliary Nibble | Parameter Byte |
| --- | --- | --- |
| `0x5` | `0` = **Mouse toggle**, `1` = **Mouse down**, `2` = **Mouse up**, `3` = **Mouse hold** | Mouse button mask `1–255` |
| `0x4` | `0` = **Modifier toggle**, `1` = **Modifier down**, `2` = **Modifier up** | Modifier mask `1–15` |

Modifier bits retain the existing meaning: `1` = **Ctrl**, `2` = **Shift**,
`4` = **Alt**, and `8` = **GUI**. The mode occupies two auxiliary bits; unused
auxiliary bits must be zero. Modifier auxiliary value `3`, mouse auxiliary
values `4–15`, a zero mask, and nonzero upper parameter bits for modifier
actions would be rejected.

The relocated **Mouse hold** retains its physical press/release lifecycle and
remains prohibited in macros and encoder rotation bindings. Modifier
toggle/down/up would be available wherever persistent mouse toggle/down/up
actions are available, including macro steps, encoder rotation and both timer
action fields.

### Persistent State and Report Ordering

Use one global persistent modifier mask, initially zero, shared by direct
actions and macro steps:

| Action | Full First Byte | Operation |
| --- | --- | --- |
| **Modifier toggle** | `04` | `state ^= modifiers` |
| **Modifier down** | `14` | `state |= modifiers` |
| **Modifier up** | `24` | `state &= ~modifiers` |

Each selected bit operates independently. Down/up is idempotent, without an
ownership count. Up can clear persistent bits set by any input or macro.
Keyboard reports combine persistent modifiers with physical **Key hold**
modifiers and temporary **Key tap** modifiers using bitwise OR. Up therefore
cannot release a modifier still contributed by a physical hold or temporary
tap. An already-matching state need not generate another report or edge.

Releasing a trigger, normal macro completion, and the boundary between macro
repetitions leave persistent modifiers intact. Effective-layer changes,
configuration application, and action reset would clear them alongside
persistent mouse state. USB reset/reconfiguration cleanup must follow the
existing action-reset lifecycle and be verified explicitly.

Direct modifier actions would execute immediately; macro modifier steps would
execute in playback order. Changed keyboard reports must be accepted and
drained before dependent steps advance. A consumer tap must complete its
release before a following **Modifier up** takes effect, including under USB
queue backpressure. Existing output flushing and playback report-drain checks
provide a foundation, but the new type needs explicit dispatch handling and
ordering verification.

For example, a fine-brightness macro could use:

```text
14 06    Modifier down: Shift + Alt
07 6F    Consumer tap: Brightness Up
24 06    Modifier up: Shift + Alt
```

This would press the modifiers, press and release the existing 12-bit consumer
usage, then release persistent modifiers. It does not require a modified
consumer encoding or change the consumer lane's latest-wins policy. Host
behavior still requires hardware verification.

### Benefits and Limits

Explicit modifier state can span consumer taps, keyboard taps, mouse clicks,
pointer movement, scrolling and pauses. A macro can release modifiers midway
through playback before later unmodified actions or **Type text**. This avoids
ordinary-key hold storage, six-key slot overflow handling and per-run ownership
bookkeeping.

The persistent semantics also carry the existing mouse model's tradeoffs:

- A missing **Modifier up** leaves modifiers active after macro completion and
  across repetitions until another action or reset clears them.
- There is no per-trigger or per-macro ownership. One input can clear state set
  by another; toggles operate on the shared persistent mask, not on the combined
  keyboard report state.
- Physical actions and **Type text** occurring while modifiers are active
  inherit them. Immediate actions may interleave with macro playback; modifiers
  cannot be isolated to one consumer or mouse action at the host.
- A layer-changing macro step cancels playback and clears persistent state
  under the existing effective-layer-change policy. Selecting the same
  effective layer would retain it.

This proposal supports persistent modifiers only, not ordinary-key holds or
automatic release at the end of a macro run.

### Format Transition and Validation

Reassigning type `0x4` changes the meaning of existing bytes and requires a new
configuration version. Migration would translate v12 **Mouse hold** records
from `04 mask` to `35 mask`, preserve existing mouse toggle/down/up and consumer
actions, and repack references as required by the target format. Firmware and
configurator validation, serialization, action models and inspector controls
must agree on the new modes and their binding restrictions.

Before changing the active configurator, freeze and test the finalized v12
production configurator under `webapp/public/versions/format-v12/`, following
`webapp/archives/README.md`, including provenance, checksums, archive indexing
and editor routing. Preserve existing archives unchanged.

The persistent modifier mask needs one byte of state. The measured firmware
implementation adds 4/6 flash bytes after optimization, adds one total allocated
RAM byte, and increases stack reserve by one byte on both variants. The earlier
resource estimates describe other proposals, not this measured implementation.
Host suites cover mouse hold relocation, mode validation,
modifier overlap with physical holds and temporary taps, report ordering under
backpressure, repeated macros, interleaved direct actions, and cleanup on layer
changes and action reset. The USB reset path uses configuration application and
action reset. Hardware verification remains necessary before a production
decision; see the implementation findings for detailed scope and measurements.

## Implementation Constraints

Relevant code is in `src/actions.c`, `src/config.c`, `src/config.h`,
`src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c`, and the configurator's action
model, validation, serialization, and inspector. The standalone firmware format
reference is now `protocol/config-v13.md`; `protocol/config-v12.md` describes the
outgoing format and unchanged active configurator.

Preserve or increase stack capacity where possible; the starting reserves were
78 bytes on the six-key pad and 81 bytes on the three-key pad, and the v13
implementation reserves 79/82 bytes. Both variants have measured flash and RAM
costs recorded in the implementation findings. An active configurator transition
must also follow the project's frozen configurator archive requirements before
changing the active editor.
