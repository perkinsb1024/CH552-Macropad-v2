# Transient Firmware Fault Investigation Plan

## Objective and Scope

Determine why the macropad unexpectedly displayed bootloader feedback and later
displayed the invalid-configuration LED pattern. Work on the assumption that
the incidents are related until evidence shows otherwise: both involved an
unexpected state without user input that should have caused it. Prioritize
feasible mechanisms across logic/state errors, interrupt interactions, memory
writes, startup validation, power/reset behavior, and LED output as well as
stack exhaustion. Rank them using evidence rather than the user's initial
suggestions. Shared background, USB, or reset paths are candidates where a
concrete mechanism connects them to the symptoms. This is a working hypothesis,
not a confirmed diagnosis. Preserve the observations for each incident so that
evidence can still distinguish their causes if necessary.

This document plans the investigation; it does not establish a diagnosis or
authorize release generation. Follow [AGENTS.md](AGENTS.md) for implementation,
build, documentation, and commit requirements. Use temporary build outputs and
preserve checked-in release files.

See [Transient Fault Hypotheses and Source Audit](INVESTIGATION_HYPOTHESES.md)
for the broadened differential, constraints on onset/recovery, and a confirmed
foreground/USB-interrupt parameter overlap independent of stack exhaustion.
That defect has not been connected to either original LED incident. Neither
symptom requires a corrupted program address: incorrect state or a restart can
reach unexpected paths through ordinary execution.

## Reported Incidents

| Incident | Observations | Uncertainties |
| --- | --- | --- |
| Suspected v11 | Shortly after turning the encoder mapped to vertical scroll ±2, all LEDs turned red, without user input that should have caused bootloader entry. The device subsequently appeared to reset itself. | Exact firmware revision, elapsed time, USB identity during the event, and whether controls remained functional are unknown. Bootloader entry is suspected rather than confirmed. |
| Current v12 | PlatformIO build from `experiment/v12-mouse-up-down`. While sitting untouched, with no macropad use and no Chrome tabs open or connected, the device displayed one blinking red LED on key 1, exactly matching the invalid-config indication. It recovered around the time a monitor was unplugged. The full six-key profile is preserved below. | Control responsiveness, time since the last earlier input, USB topology, whether the device restarted, and whether monitor removal caused recovery are not recorded here. The LED pattern and supplied profile are established observations. |

The v12 indication is established: one blinking red LED on key 1, matching the
invalid-config state. The uncertainty is what caused that indication, not what
the user saw. In a recurrence, capture control responsiveness, configuration
flags, and saved/active bytes to distinguish image corruption from corrupted
runtime state. Record whether recovery required a profile save and whether the
monitor shares a hub or dock with the pad if that information becomes available.

A false encoder-button reading could explain the first incident alone, so it
is a secondary hypothesis unless evidence connects it to both events or shows
that they have different causes.

Retain that candidate rather than dismissing it because it explains one symptom
directly. For example, a shared electrical/reset disturbance could have
different secondary effects on input sampling and startup validation. Such a
combined explanation needs evidence for those links; a shared cause is the
working assumption, not a filter that excludes relevant individual mechanisms.

The user explicitly confirmed that the v12 failure occurred while the macropad
was untouched. Prioritize reproduction during idle operation; do not describe
that incident as triggered by scrolling, a button press, or macro invocation.
Record earlier activity and elapsed idle time separately to check for delayed
effects without assuming that playback or an output was still active.

## Confirmed Connection Topology

The user subsequently supplied the setup for the v12 incident:

- Work M-series MacBook Pro, with two USB-C monitors connected directly to its
  two left USB-C ports.
- Macropad connected to the right USB-C port through a direct USB-C-to-USB-A
  dongle (no dongle cable), followed by a USB-A-to-USB-C data/power cable.
- Both monitors and the macropad were connected when the invalid-config blink
  occurred. No Chrome WebHID or WebUSB session was connected to the pad.
- After waiting briefly, the user unplugged one monitor to connect it to a
  personal MacBook for debugging. The macropad recovered around that time.
  The macropad itself was not unplugged during either reported failure.

The pad was not downstream of a monitor hub or a shared external dock. Different
physical ports do not establish independent internal controllers or power
domains; neither has been identified for this MacBook. Monitor charging/USB
Power Delivery roles, laptop power source and exact monitor-disconnect timing
relative to recovery remain unrecorded. Treat host-wide USB/power changes as
candidates, without assuming that a monitor disconnect reset the pad's port.

No intentional unplug or power cycle is established. An unobserved processor
restart remains possible and must be distinguished from a USB bus reset and
from uninterrupted execution. Prioritize evidence that separates those cases
and controlled monitor-connected/disconnected comparisons using this topology.

### Inline Power-Meter Observation

The user inserted a USB-C-to-USB-C power monitor immediately before the pad:
MacBook → USB-C-to-USB-A adapter → USB-A-to-USB-C cable → power monitor →
macropad. Power and data continued to work as expected. Displayed line voltage
was 5.17–5.21V. Current ranged from 0.04A with all LEDs off to 0.15A with all
LEDs bright white.

These readings provide no evidence of sustained low VBUS in the measured
setup, including at maximum reported LED brightness. They lower the priority
of a sustained cable/adapter voltage-drop explanation. They do not measure
chip VCC/V33 directly or exclude brief transients. The user subsequently
confirmed that the meter records maximum voltage/current but not minimum,
and its graph updates approximately once per second. Its internal sampling
and graph aggregation behavior remain unknown; maximum capture cannot
establish the lowest voltage reached.

Unplugging a monitor produced no observed voltage fluctuation, LED change or
behavior change. This test did not reproduce the recovery-associated behavior
or demonstrate a supply disturbance. It lowers the priority of a reliably
repeatable monitor-disconnect effect under the tested conditions, without
excluding intermittent effects or short voltage dips. Run duration and the
remaining monitor/charging state were not supplied. No original fault
recurrence was reported during this measurement. The inserted meter changes
the connection relative to the original incident.

## Current Evidence and Limits

- The application displays all LEDs red immediately before its software jump to
  the bootloader. Normal entry uses the encoder button at startup or an allowed
  three-second hold during operation. Rotation alone should not trigger entry.
- `protocolInit()` loads the saved image and sets configuration-valid flags at
  startup. A successful configuration commit activates a new image. Ordinary
  scrolling has no intentional path that marks the active image invalid.
- USB reset/reconfiguration requests reapply runtime state through
  `firmwareApplyConfig()`; this does not reload or revalidate the saved image.
  A USB bus reset and a microcontroller restart must be distinguished.
- There is no existing persistent event history or recorded reset reason.
  Existing status reports expose saved-profile validity, layers, upload state,
  and dropped-action counts. `READ_FLASH` and `READ_ACTIVE` expose saved and
  active image bytes. The status validity flag is cached, not a fresh CRC check.
- The active 128-byte image resides in external RAM at `0x300–0x37F`. The
  hardware stack resides in internal RAM. Stack exhaustion could corrupt
  execution/internal state without directly overwriting the profile image.
- Documented v12 stack capacities are 77 bytes for six keys and 80 bytes for
  three keys, versus 79/82 for finalized v11. These are linker capacities, not
  measured unused stack. Reconfirm against the exact binaries under test.
- The v10 six-key hardware test observed 39 bytes used out of 75 available.
  That observation does not establish a maximum for later builds or untested
  interrupt timing. Desktop host tests do not reproduce target stack limits.
- Macros use a streaming cursor, and repeats execute sequentially. Six repeats
  do not inherently create six nested calls, but playback paths still require
  stack and interrupt analysis.
- Untouched does not mean that firmware or USB processing has stopped. Review
  background polling, timekeeping, USB interrupts, and reset/reconfiguration
  paths alongside input-driven paths. Stack exhaustion or other corruption
  remains a hypothesis during idle operation, not an established explanation.

References: [V12 implementation measurements](protocol/v12-mouse-implementation.md),
[previous hardware stack test](protocol/v10-hardware-validation.md),
[protocol implementation](src/protocol_firmware.c), and
[input, LED, and bootloader paths](CH552_Universal_Macropad.ino).

## Phase 1: Preserve Evidence and Establish Baselines

1. Record source revision, local changes, board variant, compiler version, build
   flags, firmware HEX checksum, and saved-profile binary/JSON for each run.
   The installed v12 firmware is identified as the PlatformIO build from
   `experiment/v12-mouse-up-down`; capture its exact revision and existing build
   artifacts where available. The full supplied profile is already preserved
   below and does not need to be requested again. Retain the original report of
   v11 as uncertain unless its binary can be identified.
2. Preserve the profile below as the primary reproduction fixture. Validate its
   encoded v12 image independently and retain its CRC and all 128 bytes. Use a
   format-compatible equivalent for v11 comparisons; do not load v12 bytes
   directly into v11 firmware.
3. Build both variants into temporary directories with the normal 14,336-byte
   application limit. Preserve `.map`, `.mem`, assembly/listing files, HEX files,
   checksums, and logs. Record internal-RAM layout, stack start/capacity, and
   external-RAM/USB buffer allocations. Run existing host/layout suites.
4. Before resetting or saving during a recurrence, record LED pattern, control
   responsiveness, time, recent actions, and USB connection/disconnection
   events. Capture a video if practical. If the device remains accessible,
   collect status, actual flash bytes, and active RAM bytes before repair.
5. Record the initial observations before connecting the configurator: connection
   and USB reconfiguration can themselves clear runtime state. If decoding fails,
   use **Export raw flash bytes**. A JSON export alone cannot preserve corruption
   or prove that the active RAM image matches saved flash.

## Phase 2: Audit Stack and Memory-Sensitive Paths

Trace encoder scanning, action queuing/dispatch, repeated scroll output, macro
playback, LED updates, USB reset/reconfiguration, and bootloader entry. Inspect
generated target assembly as well as C source.

- Calculate the deepest relevant call chains, including compiler helper calls,
  register saves, and hardware return addresses. Verify actual interrupt
  priorities and permitted nesting; include the worst permitted interrupt
  preemption rather than assuming all interrupts can nest arbitrarily.
- Check compiler overlays, non-reentrant functions/shared scratch variables,
  register-bank use, and routines reachable from both main and interrupt context.
- Audit array indices, queue bounds, macro cursors, page-zero addressing and P2
  assumptions, DMA lengths/addresses, and internal bit-state writes. Review
  multi-byte values shared across execution contexts for atomicity.
- Inspect the three-second bootloader test and encoder debounce timestamps,
  including 16-bit time wrap, startup sampling, held inputs during reapply, and
  state changes caused by USB events. Confirm that reset/reapply cannot combine
  a stale loop timestamp with a newer hold timestamp to falsely satisfy a hold.
- Identify every legitimate write to configuration-valid flags and active image
  bytes. Review DataFlash register access and interrupt interactions during
  startup reads and saves. Ordinary input activity should not write DataFlash.

## Phase 3: Target Stack High-Water Testing

The first v12 sanity builds are prepared; see
[V12 Stack Sanity Check](Stack%20Test/v12-stack-sanity-check.md) for artifacts,
measurements, upload and reader instructions. The user requested feature cuts
before optimization for this initial test and confirmation before each cut.
Only live color preview was approved and disabled. Both variants fit the real
application limit with unchanged 77/80-byte stack capacities. Linked diagnostic
checks and host suites pass. Initial six-key hardware readings are 32 bytes at
baseline and 35 bytes after very rapid direct and macro-based mouse toggles,
leaving 45 and 42 bytes of observed margin respectively. A subsequent rapid
three-key workload kept the volume HUD displayed until the queue drained.
The user clarified that only the macro-based toggle on **Key 1** appeared
unresponsive; direct **Mouse toggle** on **Key 2** still worked with the queue
full. A stack reading for that workload was not reported. See
[V12 Six-Key Investigation Results](Stack%20Test/v12-six-key-results.md) for the
observations, queue analysis, and remaining evidence to capture. A full volume
macro backlog has 27,648ms of pauses plus processing/USB time; that can explain
delayed or dropped queued actions. The clarified behavior is consistent with
expected queue handling and does not currently reproduce the earlier incidents.

The user subsequently exercised all use cases extensively without exceeding
35 bytes (42 bytes of observed margin) and reported `identical=true` for the
reader's saved-flash/active-RAM comparison. A sample profile covering LED
controls, timed actions, chords/text, layer changes, keyboard modifiers,
scrolling, toggles, and repeated double-click macros is preserved in the
[six-key results](Stack%20Test/v12-six-key-results.md#extended-coverage-and-image-capture).
This reduces the likelihood of ordinary stack exhaustion in the exercised
paths and shows no image divergence at capture time. It does not establish the
cause of the earlier transient indications or verify all runtime state. Shift
emphasis toward long idle reproduction and shared USB/reset/runtime-state
paths; retain corruption as a hypothesis and capture evidence during recurrence.

Reuse the previous stack-test design referenced in
[v10 hardware validation](protocol/v10-hardware-validation.md) after reviewing
its initialization and reader against the current linker layout.

1. Add optional instrumentation that fills unused stack RAM with a known pattern
   and reports the deepest overwritten position. Derive boundaries from the
   actual linked build. Initialize before ordinary operation, protect the fill
   from interrupts, and exclude live stack frames. Inspect generated assembly
   to ensure the fill routine cannot overwrite its own return address or locals.
2. Keep diagnostic counters/buffers in external RAM where practical. Record all
   instrumentation changes to stack capacity, call depth, interrupt latency,
   and memory layout. Preserve or increase production stack capacity; explicitly
   report any reduction. Measure the reader's own stack contribution.
3. Retain peak observations across ordinary USB resets/reconfiguration. Separate
   startup, ordinary operation, diagnostic reads, and bootloader-entry workloads
   where possible. Do not clear the watermark automatically while investigating.
4. Add a near-limit sentinel or threshold indication and latch its first failure.
   A watermark is evidence of observed usage, not an overflow trap or a proof of
   worst-case safety: saved bytes can match the pattern, and an overflow may
   destroy evidence before the reader runs. Supplement it with assembly analysis
   and, where feasible, stack-pointer sampling at selected deep paths/ISR entry.
5. Test the six-key board first with the supplied profile, then the three-key
   variant with a documented adapted profile. Prioritize long-running untouched
   sessions with no browser or diagnostic polling: first after a fresh startup
   without input, then after documented normal use followed by release of all
   controls. Record pending playback and persistent output state where observable.
   Cover both layers and repeated 16-bit millisecond-clock wraps (65,536ms).
   Then exercise sustained fast rotation in both directions, held scrolling,
   mouse toggles, and repeated consumer macros individually and in combination,
   including transitions from those workloads back to idle.
6. Repeat with normal HID traffic and no browser, then with read-only diagnostic
   polling, USB backpressure, and controlled USB reset/reconfiguration. Broaden
   to chords, timers, text, and LED effects to cover deeper paths absent from the
   supplied profile. Record workload, duration, peak use, capacity, and remaining
   observed margin for every run.

## Phase 4: Optional Debug Build and Reader

### Approved Feature-Cut Order

The user approved the following additional feature cuts for investigation
builds, only as needed for flash capacity, in this order:

1. E: **Type text** / stored text playback. Retain keyboard taps, holds and
   other macro steps.
2. B: LED-control actions that change brightness, presets or effects during
   operation. Retain saved profile lighting.
3. C: Timed actions, including expiry and next-input actions.
4. D: Chords. Retain ordinary individual bindings.
5. A: Animated rainbow lighting. Retain static palette colors, key feedback,
   layer indications and error LEDs.

Live color preview was already approved and disabled for the initial stack
diagnostic. These additional cuts are authorized for investigation builds;
they are not requested production feature removals. Measure cumulative flash
costs and stop cutting once sufficient space is available. The user initially
asked to defer builds, then explicitly approved implementation, temporary
builds, host tools under `tools/`, checkpoint commits and additional
`investigation/` branches. Pushing and flashing firmware are not authorized.

### Diagnostic Design

The first uptime/validity diagnostic comparison is implemented. See
[V12 Fault Investigation Tools](tools/investigation/README.md) for the complete
diagnostic layout, host commands, selected artifacts and limitations, and
[prepared variant measurements](INVESTIGATION_HYPOTHESES.md#prepared-diagnostic-variants)
for results. This replaces stack instrumentation in the new builds; the older
stack artifacts remain preserved. The current diagnostic adds no flash
logging, persistent event history, reset-source capture or USB-event counters.

If reproduction or stack testing does not identify the fault, prepare a separate
debug build with a small read-only host reader. Prefer compile-time diagnostic
options and bounded records over serial logging in time-sensitive paths.

Potential diagnostic fields, prioritized to fit available resources:

- Build identity, uptime, stack capacity/high-water result, and latched faults.
- USB bus-reset, configuration-change, and suspend/resume counters, recorded
  separately from full microcontroller startup. Capture hardware reset-cause
  information as early as required only if supported and verified for CH552;
  explicitly report unavailable or ambiguous causes.
- Encoder raw/debounced button state, captured bootloader permission, hold start,
  and the reason/time/state immediately before intentional bootloader entry.
- Both configuration-valid flags, startup validation failure category, active
  image CRC versus its baseline, and saved/active byte comparison on demand.
- A bounded recent-event buffer for relevant state transitions, plus queue
  indices/counts, dropped actions, and USB generation. Capture the first fault
  before recovery/reapply clears state; avoid logging every polling iteration.

Diagnostic state should survive USB bus resets within a running application.
Ordinary RAM records cannot be assumed to survive power loss, a full restart, or
the bootloader taking over. Stream snapshots to a timestamped host file during
controlled tests, and account for loss of the final bootloader event on USB
disconnect. Any retained-RAM design requires explicit startup/bootloader analysis.
Avoid automatic DataFlash logging: the profile occupies its existing storage,
and extra writes would introduce wear and another corruption variable.

The documented v12 builds have only 4/8 application flash bytes spare. First
measure diagnostic cost. For the initial stack sanity test, the user's explicit
preference is approved feature reductions before optimization; omitting live
color preview is sufficient. For additional debug instrumentation, propose any
further feature reductions for confirmation and retain comparable control runs.
Reconfirm stack layout after every build change. Do not exceed the application
limit or borrow bootloader space to obtain a flashable debug image.

Keep diagnostic commands distinct from normal transport replies. The reader
should identify the debug build, serialize requests, preserve raw replies, and
avoid saves or automatic repair. If configurator changes become useful, run
`npm run build` from `webapp/` after those changes as required by AGENTS.md.

## Phase 5: Controlled Comparisons and Interpretation

Run one-variable comparisons: original USB topology versus a direct host port,
alternate cable, monitor/dock changes, long-press bootloader enabled versus
disabled, encoder-only bindings versus the complete profile, and matched v11/v12
builds. Record disconnects and uptime alongside LED behavior. Treat monitor
removal as a hypothesis to test, not a confirmed cause or remedy.

Compare untouched idle operation with active workloads as separate test cases.
During idle runs, distinguish no host diagnostic connection from continuous
read-only capture, and distinguish ordinary host operation from controlled
sleep/wake or monitor/dock changes. Diagnostic polling can change interrupt
timing and obscure a failure that occurs only during unobserved idle operation.

| Finding | Interpretation and Next Check |
| --- | --- |
| Stack sentinel hit or observed use reaches capacity | Strong evidence of inadequate margin; identify the responsible call/preemption path and reduce usage or increase capacity. |
| Valid flash, changed active RAM image | Investigate RAM writes, DMA/pointer bounds, and memory corruption. |
| Valid saved/active images, changed validity flag | Investigate internal-state corruption or unintended execution; image CRC alone cannot detect this. |
| Recorded encoder hold preceding bootloader entry | Check physical/button electrical behavior and debounce/hold logic against timestamps. |
| Startup validation fails but subsequent flash reads are valid | Investigate startup reads, initialization, and power/reset timing. |
| Recovery coincides with USB reset but uptime continues | Inspect USB reapply/runtime cleanup; do not classify it as a full device restart. |
| Fresh startup follows the event | Determine reset/power cause where supported; RAM-only logs may have been lost. |
| No reproduction and comfortable observed stack margin | Report workloads and limits; neither a clean run nor a watermark rules out other timing or corruption bugs. |

## Deliverables and Completion Criteria

Retain the exact profile/images, baseline and debug build measurements, stack
results, host/device captures, reproduction steps, and a conclusion distinguishing
confirmed findings from hypotheses. If a defect is found, add a focused regression
where meaningful, run firmware host suites and both native variant builds, then
repeat the relevant hardware workload. Report flash use, stack capacity, observed
peak/margin, and any diagnostic feature differences.

The investigation can end with a confirmed cause and validated fix, or a bounded
report of inconclusive testing with a practical capture procedure for recurrence.
Do not claim the issue resolved solely because testing did not reproduce it.

## Primary V12 Reproduction Profile

This is the user-supplied six-key profile. The v11 incident may have used a
different profile and should not be assumed to match it exactly.

```json
{
  "format": "universal-macropad-profile",
  "version": 12,
  "variant": "six-key",
  "startupLayer": 0,
  "transparentBlack": false,
  "chordWindowMs": 40,
  "rainbowPhaseDegrees": 60,
  "rainbowSpeed": "fast",
  "layers": [
    {
      "keys": [
        { "type": "macro", "macro": 0, "repeats": 1 },
        { "type": "mouseToggle", "buttons": 1 },
        { "type": "macro", "macro": 1, "repeats": 6 },
        { "type": "none" },
        { "type": "scroll", "delta": 1, "hold": true },
        { "type": "none" }
      ],
      "encoderButton": { "type": "relativeLayer", "offset": 1 },
      "clockwise": { "type": "scroll", "delta": -2 },
      "counterclockwise": { "type": "scroll", "delta": 2 },
      "leds": ["Coral", "White", "Coral", "Off", "White", "Off"],
      "bootloaderFromRun": true,
      "indicatorBehavior": 3,
      "indicatorColor": 14,
      "indicatorFullBrightness": false
    },
    {
      "keys": [
        { "type": "macro", "macro": 0, "repeats": 1 },
        { "type": "mouseToggle", "buttons": 1 },
        { "type": "macro", "macro": 1, "repeats": 6 },
        { "type": "none" },
        { "type": "scroll", "delta": 1, "hold": true },
        { "type": "none" }
      ],
      "encoderButton": { "type": "relativeLayer", "offset": 1 },
      "clockwise": { "type": "scroll", "delta": 2, "horizontal": true },
      "counterclockwise": { "type": "scroll", "delta": -2, "horizontal": true },
      "leds": ["Coral", "White", "Coral", "Off", "White", "Off"],
      "bootloaderFromRun": true,
      "indicatorBehavior": 3,
      "indicatorColor": 14,
      "indicatorFullBrightness": false
    }
  ],
  "chords": [],
  "macros": [
    { "actions": [{ "type": "mouseToggle", "buttons": 1 }] },
    { "actions": [{ "type": "consumer", "usage": 234 }, { "type": "pause", "ticks": 32 }] }
  ]
}
```
