# Consumer Modifiers and Macro Hold Support Notes

These notes capture the discussion of self-contained modified consumer actions
and keyboard holds inside macros. They describe possible changes, not implemented
features or a finalized configuration format.

## Motivation and Current Behavior

The motivating use case is macOS fine brightness adjustment: Option+Shift plus
a brightness key adjusts brightness in smaller steps. The user observed roughly
6–7% steps normally and approximately 1% steps with those modifiers. These are
observations, not precision guarantees made by the firmware.

Current **Media / system** actions send a Consumer Page usage without an
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
Keyboard brightness controls are not currently listed in the configurator's
named consumer choices; they would need to be entered as custom usages.

Launch and browser usages often exceed eight bits: Calculator is `0x192`,
Email is `0x18A`, and Browser Back is `0x224`. Retaining the existing 12-bit
actions alongside the proposed encoding would preserve these controls.

All sixteen low-nibble action types are already allocated in version 12.
The proposed encoding consequently needs an extension or reallocation in a new
configuration format; it cannot simply take an unused type. No particular
encoding or migration strategy has been selected.

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

## Implementation Constraints

Relevant code is in `src/actions.c`, `src/config.c`, `src/config.h`,
`src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c`, and the configurator's action
model, validation, serialization, and inspector. The current standalone format
reference is `protocol/config-v12.md`.

Preserve or increase stack capacity where possible; current reserves are 78 bytes
on the six-key pad and 81 bytes on the three-key pad. Measure flash and RAM costs
for both variants before selecting a design. A configuration format transition
must also follow the project's frozen configurator archive requirements before
changing the active editor.
