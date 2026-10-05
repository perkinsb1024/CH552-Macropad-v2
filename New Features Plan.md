# New Features Plan

## Consumer Hold

Status: implemented on `experiment/v8-consumer-hold` and combined into
`experiment/v8-merged`, including v8 configurator/migration. The selected compact
policy is newest-wins with no restoration; keyboard and consumer holds both
survive layer changes until release. Standalone net flash cost: 44 / 46 bytes,
three persistent RAM bytes. See [final format](protocol/config-v8.md) and
[measurements](protocol/v8-experiment-results.md). The original investigation
follows; the implementation documents record the selected behavior.

### Goal

Add a hold action for media/consumer keys without increasing the two-byte action
record. Pressing a bound button asserts its consumer usage; releasing it releases
that usage. Keep Consumer Hold immediately after Consumer Tap in the action type
allocation.

### Existing format and constraints

- Each action has a four-bit type and four auxiliary bits in its first byte, plus
  an eight-bit parameter in its second byte. All 16 type values are allocated.
- Consumer Tap currently uses type `0x8`. Its auxiliary nibble contains the high
  four bits of the usage and its parameter contains the low eight bits, supporting
  the full nonzero range `0x001`–`0xFFF`. These auxiliary bits cannot become a hold
  flag without reducing the supported usage range.
- Type Text currently uses type `0x9`, auxiliary nibble `0x0`, and an eight-bit
  string-pool offset. The offset must point to a valid string start.
- None currently requires both bytes to be zero. Nonzero None payloads are
  rejected by firmware and configurator validation.

### Agreed encoding

Share type `0x0` between None and Type Text, distinguished by the auxiliary nibble.
Reassign the freed type `0x9` to Consumer Hold.

| Action | Type nibble | Auxiliary nibble | Second byte |
| --- | --- | --- | --- |
| None | `0x0` | `0x0` | `0x00` only |
| Type Text | `0x0` | `0x1` | Eight-bit string-pool offset |
| Consumer Tap | `0x8` | Usage bits 11–8 | Usage bits 7–0 |
| Consumer Hold | `0x9` | Usage bits 11–8 | Usage bits 7–0 |

Reserve type `0x0` with auxiliary values `0x2`–`0xF` as invalid. Consumer usages
must remain nonzero. Other action encodings remain unchanged.

Examples (first byte, second byte):

- None: `00 00`.
- Type Text at string-pool offset zero: `10 00` (previously `09 00`).
- Volume Up tap, usage `0x0E9`: `08 E9`.
- Volume Up hold, usage `0x0E9`: `09 E9`.

This preserves the two-byte record, the full eight-bit text offset, and the full
12-bit consumer usage. Type Text's first byte is nonzero (`0x10`), which also fits
the playback engine's existing use of `currentFirst == 0` as its idle sentinel.
Dispatch must distinguish None and Type Text using both type and auxiliary bits.

The original alternative was to put Consumer Hold in otherwise-invalid nonzero
None payloads. That would preserve all existing valid action encodings, but was
rejected because None and Consumer Hold are too unrelated. It would also need
care around the idle sentinel for usages whose high nibble is zero. The agreed
proposal groups None with Type Text instead and gives Consumer Hold its own type.

### Version bump and migration

A format version bump and migration are required and explicitly agreed. The
current configuration version is 7; this proposal changes the meaning of an
existing valid type, rather than merely accepting previously invalid records.

- Decode legacy actions according to their source version before applying the
  new meaning of type `0x9`.
- Migrate every legacy Type Text action from type `0x9`, auxiliary `0x0`, to type
  `0x0`, auxiliary `0x1`, preserving its string-pool offset and text contents.
- Cover every action-bearing location, including button actions, wheel actions,
  chords, and timed actions where supported by the source format.
- None and Consumer Tap retain their encodings; unrelated actions retain theirs.
- Update firmware validation/dispatch and configurator encoding, decoding,
  migration, action selection, and hold eligibility together. Review profile
  import/export and existing compatibility paths as part of that work.
- Ensure older firmware/configurators reject the new format via its version,
  rather than interpreting Consumer Hold as legacy Type Text. Verify the actual
  version checks during implementation.

### Firmware runtime findings

The existing USB consumer report can represent a held usage without a descriptor
change: Report ID 5 carries one 16-bit consumer usage, with logical/usage maximum
4095. Sending a nonzero usage asserts it; sending zero releases it. The existing
`USB_queueConsumer()` API and stored consumer state support these reports, and
idle reports repeat the stored state.

Consumer Tap already queues a nonzero report followed by zero through the action
playback state machine. Consumer Hold needs persistent button-owned state and
release handling, rather than being routed through that tap sequence.

Implementation must address:

- Button press/release and the existing short-press handling that ensures a hold
  press reaches the host before its release.
- Chord activation/release, stored bindings, and layer transitions so a usage
  cannot become stuck. Existing layer transitions cancel queued tap playback and
  schedule a consumer release when needed; integrate holds with that lifecycle.
- Reset/reconfiguration and other output-clearing paths.
- Report queue pressure and failed enqueue retries for both assertion and release.
- Arbitration between multiple held consumer actions and queued Consumer Taps.
  The descriptor supports one consumer usage at a time. Apply the agreed
  most-recent-wins policy below and prevent older releases/queued playback from
  incorrectly clearing a newer winner.
- Reject Consumer Hold on wheel rotation and timed actions, which have no matching
  physical release event. Physical keys and the wheel press can have releases.

### Agreed behavior

- The most recently triggered consumer action wins, for both overlapping
  Consumer Holds and a Consumer Tap interrupting a hold.
- Prefer restoring a still-held previous usage after the winning action ends.
  Omitting restoration is explicitly acceptable if needed to fit flash, but use
  the same restoration policy for hold-over-hold and tap-over-hold. An older
  button's release must not release the current winner.
- Prefer keeping the original binding held across layer changes until physical
  release, matching existing keyboard holds. Releasing on layer change is an
  authorized size-saving fallback only if keyboard and consumer holds both use
  that behavior consistently. Avoid changing keyboard semantics unless needed.
- A Consumer Hold chord releases when either chord key is released.
- Even a very short press must send an assertion followed by release; retries
  must preserve that lifecycle under report queue pressure.
- Send a sustained HID usage; repetition is determined by the host/application,
  rather than firmware-generated repeated taps.
- Configuration reload/reset releases all held usages.
- Consumer Hold is unavailable for wheel rotation and timed actions.

The user has authorized these memory-dependent fallbacks; measure builds and
record which policy fits rather than treating restoration as mandatory. No further
consumer behavior choices are currently pending.

### Host behavior and verification

This feature sends a true held consumer usage. Host/application behavior is
usage-dependent; holding a key is not equivalent to repeatedly sending taps.
Volume Increment (`0xE9`) and Volume Decrement (`0xEA`) are Re-Trigger Controls in
the USB HID Usage Tables, making volume adjustment a useful first hardware test.
Other media usages, such as Play/Pause, need their own host checks.

Sources consulted: [USB HID Usage Tables 1.21, sections 3.4.1.5 and 15.9](https://www.usb.org/sites/default/files/hut1_21_0.pdf)
and [USB HID documentation](https://www.usb.org/hid). Actual macOS behavior has not
yet been tested for this feature.

Planned verification:

- Encoding/decoding and validation tests for None, text offsets, reserved auxiliary
  values, and the full consumer usage range.
- Migration tests proving legacy Type Text remains text in every supported action
  location, plus version rejection checks.
- Runtime/hardware checks for sustained holds, very short presses, releases,
  chords, layer changes, overlapping holds/taps, and queue pressure.
- Build both hardware variants and measure flash/RAM impact. Feasibility within
  remaining memory has not yet been measured.
- Run the web app build after configurator changes. Use ordinary temporary build
  outputs for firmware checks; release generation is outside this planning task.

Relevant code: `src/config.h`, `src/config.c`, `src/actions.c`,
`src/userUsbHidKeyboardMouse/USBconstant.c`,
`src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c`,
`webapp/src/codec/encode.ts`, and `webapp/src/codec/decode.ts`.

## Scroll Acceleration

Status: held scrolling is implemented and retained in `experiment/v8-merged`.
Acceleration is implemented and independently testable on
`experiment/v8-scroll-acceleration`, with Off/Slow/Fast configurator controls.
That isolated build disables color preview and rainbow animation, retains error
and layer blinking, and fits with 101 / 105 flash bytes free. Acceleration does
not fit in the merged build with all existing lighting preserved and is disabled
there. Slow is +1 every two subsequent inputs, Fast +1 every input; timeout 200 ms,
maximum 127. See [test build and policies](protocol/v8-scroll-experiment.md).
The original investigation follows, including alternatives not selected.

### Goal and requested behavior

Use Scroll Step's auxiliary data to enable acceleration without enlarging its
two-byte action record. Start at the configured signed step, then increase its
magnitude for each subsequent scroll input in the same direction. Opposite
scrolling, another input trigger, or a pause resets the sequence; the next scroll
starts at its configured step. Prefer Off/Slow/Fast if memory permits; Off/On is
an acceptable fallback. Queue emptiness was suggested as a possible timer-free
pause detector.

Priority correction: **held key scrolling is more important than scroll
acceleration**. If flash constraints require cutting a feature, remove acceleration
before removing held scrolling. This supersedes the earlier fallback that kept
key acceleration while dropping key hold. It does not establish a priority
between scrolling and Consumer Hold or Timed Action Precision.

### Encoding findings and updated proposal

Scroll is type `0x7`. Its auxiliary nibble is currently required to be zero in
both firmware and configurator validation; its second byte is a signed delta
from -127 to 127. Zero is valid and does nothing; -128 is rejected. All four
auxiliary bits are available for this feature.

Proposed allocation incorporating scroll hold (higher priority than acceleration):

| Mode (without hold) | Auxiliary nibble | First byte |
| --- | --- | --- |
| Off | `0x0` | `0x07` |
| Slow | `0x1` | `0x17` |
| Fast | `0x2` | `0x27` |

Use the low two auxiliary bits for Off/Slow/Fast and auxiliary bit 2 (`0x4`,
first-byte bit `0x40`) for hold-to-scroll on release-capable physical inputs.
Thus hold with Off/Slow/Fast would use first bytes `0x47`, `0x57`, and `0x67`.
Reserve mode value three and auxiliary bit 3 as invalid. Keep the second byte's
signed step unchanged. Reject the hold flag on wheel rotation and timed actions.
An Off/On fallback remains possible if needed for flash fit.

The user clarified that acceleration increments X and spacing Y are hardcoded
firmware constants selected by Slow or Fast, not independently stored per action.
There is therefore no need to fit X/Y into the auxiliary nibble. Modes plus hold
need only three auxiliary bits, with no action-size increase.

There is no action-storage penalty for three modes versus two. Slow/Fast can
share one counter and one algorithm with different increments; the extra mode
needs a little additional code, not necessarily additional persistent state.
Whether either implementation fits, especially together with Consumer Hold,
requires compiled flash/RAM measurements. No measurements have been made.

Include this feature in the format bump planned for Consumer Hold if implemented
together. Legacy scroll actions migrate to Off with their original delta intact.
Older validators reject accelerated scroll encodings because their auxiliary
data is nonzero. Review profile JSON defaults/imports as well as binary migration.

### Why queue emptiness is not a reliable pause detector

The firmware has several distinct stages: physical inputs, an eight-entry action
queue, active action playback, and the USB report queue. `eventUsed` measures only
waiting actions. Popping the last action makes it zero even while that action is
still playing. Moreover, rotation admission reserves seven action slots for
buttons, so at most one rotation action can be waiting when no other actions are
queued; queue fullness also causes rotation inputs to be dropped.

Even checking all playback and USB stages for emptiness would reset acceleration
whenever output completes before the next wheel detent. This can happen during
continuous turning. Conversely, a long scroll action or a busy USB transport can
keep output pending after physical input has stopped. Thus queue-based reset
would measure output backlog rather than a consistent pause between inputs.

A timer-free version is possible, but its semantics would be acceleration during
overlapping playback bursts. Its behavior would depend on the configured base
step and USB draining speed. Treat that as a fallback with a usability tradeoff,
rather than an equivalent way to detect inactivity.

Agreed starting input inactivity timeout: 200 ms. This is a firmware constant,
not user configurable; changing it requires a firmware build. The firmware
already obtains `millis()`, and `actionsPoll()` and
button presses already receive a 16-bit `now`; there is no need for a new timer
peripheral. Wheel dispatch would need access to that time too. A 16-bit last-input
timestamp costs two bytes; direction/gain tracking likely needs another one or
two bytes, depending on packing. These are estimates, not measured allocations.
Expire/reset the sequence during polling as well as checking elapsed time at the
next input, so long inactivity cannot alias a complete clock wrap.

Clock clarification: `millis()` supplies milliseconds. Timed actions deliberately
use `clock >> 17`, discarding the lower 17 bits to obtain one coarse tick every
131,072 ms (131.072 seconds). That is a timed-action representation choice, not
the underlying clock's resolution or a hardware clock reset. The main loop also
passes the unshifted low 16 bits as `now` to input/action handling; pointer holds
already use that clock for an 8 ms repeat interval. Scroll inactivity can likewise
use millisecond elapsed-time subtraction. A 16-bit millisecond timestamp wraps
every 65.536 seconds; unsigned subtraction handles a wrap for the short timeout,
with polling clearing expired state before a full wrap can alias inactivity.

### Acceleration algorithm proposal

Use a bounded increase rather than multiplication or an unbounded rate. The
user's preferred starting presets are Slow = +1 every two subsequent qualifying
inputs and Fast = +1 every subsequent qualifying input. With base magnitude two,
that gives Slow 2, 2, 3, 3, 4, … and Fast 2, 3, 4, 5, …. Final values depend on
hardware feel; they are firmware constants selected by the action's mode.

Growth implementation priorities:

1. Ideal: support firmware-defined +X every Y inputs, with X and Y around 1–8.
   Keep a small event-spacing counter so increments occur after Y subsequent
   inputs; the initial event still uses the configured base.
2. Acceptable: support firmware-defined +X every input, with X around 1–8, if
   eliminating the spacing counter/logic is necessary for fit.

These are preset implementation capabilities, not user-configurable X/Y fields.

- The first event after a reset uses exactly the configured base magnitude.
- Each qualifying subsequent input advances the preset's spacing counter and
  adds X gain when Y inputs have elapsed. Preserve the configured sign, saturate
  safely, and never generate -128 or wrap either counter.
- Agreed maximum effective scroll magnitude: 127, matching the configuration
  limit. Cap the resulting step, rather than adding up to 127 on top of the base:
  effective magnitude = min(127, base magnitude + gain). Increments still need
  tuning, and playback backlog at this cap needs hardware testing.
- Off always uses the original configured delta and ends an accelerated sequence.
  A zero step should remain a no-op and reset the sequence.
- Reset on reversal, another input trigger, timeout, layer change, configuration
  application, and output clearing. A reset affects future inputs; it must not
  rewrite scroll actions already accepted into the playback queue.
- Prefer reset when the scroll binding/base step/mode changes too, so gain cannot
  leak into a different action. Layer changes already cancel queued playback.

Track input events, not HID reports: one detent is one opportunity to increase
gain, regardless of how many reports are needed to deliver that detent's step.
Compute the effective step once before enqueueing and store it in the existing
second byte. Do not increase gain again when polling or retrying a rejected USB
report. Proposed queue-drop policy: advance gain only for accepted scroll actions;
a dropped rotation may still break the sequence if its direction reverses.

### Input ordering and scope

Reset handling cannot live only in playback dispatch. None, holds, LED changes,
and layer actions may never enter the action queue. Chord resolution can defer
dispatch, and timed resume actions can consume physical inputs before
`actionsPress()`/`actionsRotate()` are called. A physical trigger should therefore
be observed at the input boundary, even if its eventual action is a no-op,
consumed, pending, or dropped. Keep already-resolved queued deltas intact.

Updated physical-key scope and flash priorities:

1. Ideal: support hold-to-scroll via the auxiliary flag, with acceleration on
   generated scroll repeats and repeated non-held scroll presses according to
   the selected mode, plus wheel acceleration.
2. If needed, simplify acceleration using the authorized growth/mode fallbacks
   while retaining held scrolling.
3. If features must be cut, remove scroll acceleration (including wheel and key
   acceleration) before removing held scrolling. Retain held scrolling at the
   configured base step without acceleration.

The earlier acceleration-without-key-hold fallback is superseded. Do not drop
held scrolling merely to preserve acceleration.

Scroll hold requires firmware-generated repeats, unlike a sustained keyboard or
consumer usage. Existing pointer holds provide reusable timing/output-idle logic,
but support and memory cost still need investigation. A short press should still
produce its initial step; releasing a held key/chord must stop future repeats.
Already accepted scroll output may still be pending, so bound backlog and check
release responsiveness. Chord hold release should follow the existing either-key
release rule. Consider multiple held scroll bindings and opposing directions;
prefer most-recent-held arbitration if reuse of existing button ordering permits.

Remaining implementation defaults/details to evaluate:

- Autonomous timed scrolls should use isolated, unaccelerated playback and should
  neither build nor reset physical-scroll gain, as previously proposed.
- Treat a debounced button press or completed wheel detent as a physical trigger.
  Ordinary button releases should not reset tap acceleration, as previously
  proposed; releasing a scroll hold stops that hold's repeats.
- Each generated hold repeat is one qualifying scroll event, not each HID report.
  Choose a firmware repeat cadence and account for continuous held input when
  applying inactivity reset, so transport delays alone do not defeat hold
  acceleration. Other input triggers still reset the gain; a continuing hold
  then starts again at base on its next eligible repeat.
- Compare scroll delta signs for output direction, but also reset on physical
  wheel reversal even if an unusual profile maps both wheel directions to the
  same signed delta.
- Tune preset X/Y values and hold repeat cadence after hardware testing. Initial
  inactivity timeout is fixed at 200 ms and maximum effective magnitude at 127.
  Off/On remains a flash fallback; queue-only inactivity detection has the
  previously documented behavior tradeoff and is not the selected approach.

### Playback and backlog considerations

Current Scroll Step playback sends one wheel report of +1 or -1 at a time until
its configured delta is exhausted, waiting for pending USB reports between steps.
Increasing the delta therefore increases both scroll distance and playback
duration. It can delay later actions and increase dropped rotation inputs. This
is a separate limitation from acceleration encoding.

The existing mouse descriptor and `USB_queueMouse()` already support signed wheel
deltas from -127 to 127, so sending a larger delta in one report is technically
possible without changing the descriptor. However, it may feel different from
multiple unit reports because the host/application interprets them differently.
Preserve Off behavior initially; evaluate bounded acceleration with current
playback before deciding whether accelerated actions need larger report chunks.
Do not claim a host behavior equivalence without hardware/application testing.

### Implementation surfaces and verification

Update firmware Scroll validation separately from its current fall-through to
pointer validation: pointer auxiliary values have their own hold meaning and
rotation restrictions. Update configurator action types, normalization/import,
encoder/decoder, editor controls, summaries, and read-only live preview together.

Planned checks:

- Off preserves legacy scroll output; migration defaults acceleration to Off.
- Valid modes round-trip, reserved auxiliary values reject, and signed deltas
  retain their current bounds and zero behavior.
- First/subsequent steps, Slow/Fast growth, saturation, reversal, binding changes,
  timeout boundaries, and clock wrap.
- Resets from no-op/hold/LED/layer inputs, pending chords, consumed physical
  events, and the chosen timed-action/release policies.
- Scroll-hold flag eligibility, initial short-press output, generated repeats,
  acceleration across repeats, release/chord release, multiple/opposing holds,
  spacing-counter resets, and repeat cadence under transport pressure.
- Queue drops, USB retries, and many reports per action never count as extra
  acceleration inputs. Accepted queued steps retain their computed values.
- Hardware feel at slow/fast wheel speeds, pauses, reversals, different base
  steps, host/application behavior, and residual playback after stopping.
- Build both hardware variants and compare memory for Off/On versus
  Off/Slow/Fast, X/Y spacing versus Y=1, and scroll hold/key acceleration fallback
  levels, together with Consumer Hold and Timed Action Precision. Include a
  held-scrolling-without-acceleration build if needed; cut acceleration before
  held scrolling. Run the web build after any configurator implementation changes.

Relevant code: `CH552_Universal_Macropad.ino` (`scanButton`, `scanEncoder`, loop),
`src/actions.c` (`queueAction`, `runAction`, `actionsRotate`, `actionsPoll`),
`src/config.c`, `src/userUsbHidKeyboardMouse/USBconstant.c`,
`src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c`, and configurator model/codec
and action editor components.

## Timed Action Precision

Status: implemented on `experiment/v8-timed-action-accuracy` and retained in
`experiment/v8-merged`. Independent 512 ms fractional phases add four persistent
RAM bytes and 60 standalone flash bytes, preserving five-byte records and the
same >2-hour maximum. Both hardware variants and host precision/lifecycle tests
pass. Configurator timing descriptions and hover ranges reflect the new precision.
See [final format](protocol/config-v8.md) and [measurements](protocol/v8-experiment-results.md).

### Goal and findings

Keep each timed action's configuration record at five bytes and preserve the
existing maximum interval above two hours, while reducing the phase-dependent
trigger error of up to one 131.072-second tick.

The existing interval field represents 1–64 coarse ticks (stored as 0–63). One
coarse tick is 131.072 seconds, so the maximum remains 8,388.608 seconds, or
2 hours 19 minutes 48.608 seconds. Each action currently has one RAM age byte;
its high bit also tracks fired/resume state. Resetting the age does not reset
the shared coarse clock's phase. The first coarse boundary after a reset can
arrive almost immediately, making the action fire up to nearly one coarse tick
earlier than its nominal duration.

### Proposed fractional counter

The user's proposed extra byte per timed action is viable in principle:

- Poll a shared fine clock derived from `millis() >> 9`, which advances every
  512 ms, exactly 256 times as often as the existing coarse clock.
- Add one eight-bit fractional age counter per timed action. Initialize/reset it
  to zero along with that action's coarse age whenever its interval restarts.
- Increment the fractional counter at each fine tick. On overflow from 255 to
  zero, advance that action's existing coarse-age logic once.
- Each action therefore has its own coarse phase measured from its last reset,
  rather than advancing all actions together at the shared coarse boundary.
- Keep interval encoding and five-byte records unchanged. The maximum duration
  and nominal interval choices remain unchanged too.

The carry must occur after **256 increments**, on overflow, not when an initially
zero counter first reaches 255: carrying at 255 would shorten each coarse tick
to 130.560 seconds and accumulate error over long intervals.

With resets occurring between shared 512 ms boundaries, nominal dispatch error
from clock quantization becomes less than 512 ms early, plus polling/dispatch
latency, rather than less than 131.072 seconds early. For example, a nominal
131.072-second interval would become due roughly 130.560–131.072 seconds after
reset under normal polling. Actual host-visible action timing can be later due
to queued playback/USB traffic; this change does not eliminate that latency or
clock oscillator drift.

This improves reset-to-trigger precision, not configurable duration resolution:
the profile still selects multiples of 131.072 seconds. A finer duration selection
would require a separate encoding proposal.

### RAM, lifecycle, and polling considerations

- The default maximum is four timed actions, so the proposed fractional counters
  add four bytes of persistent RAM. The existing shared `timedClock` byte can
  track the low eight bits of the fine clock instead of the coarse clock.
  Flash, scratch storage, and page-zero layout impact still need build measurement.
- Zero fractional counters on configuration/init reset and on each action's
  configured reset-on-input path (or all-reset build option). Inputs that do not
  restart an action must retain its fractional age. Preserve existing fired/
  resume/consume behavior; clearing a fired flag alone must not accidentally
  restart an otherwise continuing interval.
- Only call that action's coarse advancement when its own fractional counter
  carries. Merely calling the existing all-action `timedEvent(1)` every 256 shared
  fine ticks would keep the old shared-phase error.
- The current `actionsTimedPoll()` only notices that its tick changed and advances
  once. For the finer clock, account for the elapsed fine-tick difference rather
  than silently losing ticks if polling skips a boundary. Unsigned eight-bit
  differences can cover gaps below 131.072 seconds; longer blocked gaps need an
  explicit policy or wider shared clock if they are possible in normal operation.
- A carry can be calculated with addition and overflow handling; executing the
  whole action traversal 256 times per coarse interval is not a requirement.
  Normal fine-counter updates happen about twice per second, while the main loop
  already checks the clock on every iteration.
- Keep due-timer processing before physical input, as currently implemented, so
  existing resume/input ordering remains consistent. Define behavior for delayed
  polls crossing multiple expirations, including avoiding accidental action bursts.

### Compatibility and verification

This precision change needs no new action encoding or configuration bytes. It
can accompany the planned firmware update; old stored intervals retain their
nominal meanings, though actual triggers become closer to those durations.
Review configurator wording about approximate timing if the feature is adopted.

Planned checks:

- Reset immediately before/after fine and coarse boundaries; all phases should
  have less than one fine tick of quantization error under normal polling.
- Independent resets of multiple timers, exact 256-tick carries, and maximum
  64-coarse-tick intervals with unchanged five-byte configuration records.
- Reset-on-input enabled/disabled, resume and consume actions, repeated firing,
  initialization, and all-reset/no-resume build variants.
- Fine-clock wrap, skipped polls, due-timer/input ordering, and dispatch queue
  pressure separately from clock precision.
- Build both hardware variants and measure combined RAM/flash impact with
  Consumer Hold and Scroll Acceleration; no implementation fit has been measured.

Relevant code: `CH552_Universal_Macropad.ino` (`firmwareApplyConfig`, loop),
`src/actions.c` (`timedAge`, `timedClock`, `actionsTimedReset`, `timedEvent`,
`actionsTimedPoll`), `src/config.h`, and `webapp/src/model/constants.ts`.
