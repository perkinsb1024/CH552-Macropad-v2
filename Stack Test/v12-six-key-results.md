# V12 Six-Key Investigation Results

## Test Context

Initial hardware observations reported on October 8, 2026, during testing of
the [v12 stack diagnostic](v12-stack-sanity-check.md). The prepared six-key
diagnostic has 77 bytes of stack capacity and disables only live color preview.
The exact uploaded HEX checksum, reader capture, polling mode, test durations,
and whether the stages shared one uninterrupted firmware session were not
provided with these results. Margins below assume that prepared stack layout.

The primary profile is preserved in
[the investigation plan](../INVESTIGATION_PLAN.md#primary-v12-reproduction-profile).
The user clarified that **Key 1** invokes **Macro 1**, containing **Mouse toggle**,
and **Key 2** performs direct **Mouse toggle**, matching the preserved JSON.
**Key 3** invokes **Macro 2**
six times, each repetition containing **Volume down** and **Pause** of 512ms.

## Hardware Observations

| Stage | Reported Observation | Observed Stack Use | Untouched Margin |
| --- | --- | ---: | ---: |
| Baseline | Initial baseline reading. | 32 bytes | 45 bytes |
| Rapid Toggle Inputs | Very rapidly pressing **Key 1** and **Key 2**, exercising direct and macro-based **Mouse toggle**, increased usage. | 35 bytes | 42 bytes |
| Rapid Three-Key Inputs | Very rapidly pressing **Key 1**, **Key 2**, and **Key 3** kept the macOS volume HUD displayed until the queue drained, after which it disappeared. **Macro 1** on **Key 1** did not produce an observable toggle during the full queue; direct **Mouse toggle** on **Key 2** continued to work. | Not reported for this stage | Not established |
| Extended Coverage | The user subsequently reported exercising all use cases extensively, never exceeding 35 bytes. A sample profile is preserved below. **Capture flash and active bytes** returned `identical=true`. | Maximum reported: 35 bytes | 42 bytes |

The first two readings show comfortable observed margin for those workloads.
They do not establish stack usage during the third stage or rule out stack
exhaustion, other corruption, or a timing fault. The user confirmed that the HUD
cleared after queue drain. No measured drain duration, LED change, or USB event
was reported for the third stage.

## Extended Coverage and Image Capture

The user supplied [this sample coverage profile](v12-six-key-coverage-profile.json)
after extensive testing that never exceeded 35 bytes. It supplements the
original incident profile; it does not replace it. The sample includes:

- Two layers, **Relative layer** on keys and the encoder button, vertical and
  horizontal scrolling, and held scrolling.
- Direct and macro-based **Mouse toggle**, plus a six-repeat macro containing
  **Relative both brightnesses**, **Relative layer-indicator brightness**, and
  a double **Mouse click**.
- A **Type text** chord producing `hello, world` with a 75ms chord window, and
  a keyboard tap with usage 80 and modifier mask 15.
- A global timed action with a 4,096ms interval, reset on input without
  consuming the input. Expiry blinks rainbow eight times; its next-input action
  switches the LED effect to always-on Coral.

The current configurator importer and encoder produce a 128-byte image with
CRC `0xD92C` and SHA-256
`21b7926cd47c2f56ab87b1439c059f6490e68abaa740eb8a1a767ef10906e3d4`.
The actual firmware validator accepts this encoding for six keys and rejects
it for three keys. This independently validates the supplied sample profile;
the reconstructed image was not compared against a device readback.

The reported `identical=true` means the reader's captured 128 saved-flash bytes
matched its captured 128 active-RAM bytes. No raw capture was supplied with this
report. Equality is not an independent CRC/validity check, comparison against
the intended profile, or evidence that runtime flags and other state were
uncorrupted. It establishes no image difference at capture time, not what
happened during either earlier incident. The two images are read sequentially,
not as an atomic snapshot.

This broader result leaves 42 bytes of observed stack margin and reduces the
likelihood of ordinary stack exhaustion in the exercised paths. The earlier
assembly-based workload suggestions identified candidates for coverage, not
predicted peaks; testing those paths did not increase the observed maximum.
Exact interrupt timing and rare reset/reconfiguration paths remain outside
what this report alone can establish. The report of exercising all use cases
does not provide a per-path trace or timed run log.

## Queue Capacity and Drain Time

Source review of [actions.c](../src/actions.c) establishes:

- `EVENT_COUNT` is eight: up to eight waiting actions share one FIFO. An active
  macro is outside that FIFO, allowing one active invocation plus eight waiting
  invocations. Macro-based toggles compete for those same eight slots.
- A six-repeat macro occupies one queued entry, not six. The streaming macro
  cursor completes all six repetitions before taking the next queued action.
- Once the queue is full, additional button actions that need a slot are
  dropped and increment the saturating dropped-button counter. Releasing a
  macro trigger does not cancel already accepted playback.
- A pause is scheduled against the clock; it does not block the main loop or
  input scanning. Direct **Mouse toggle** updates persistent mouse state without
  entering the action FIFO, and output flushing continues during a macro pause.
- **Volume down** here is a consumer tap. Its release is queued separately
  before the pause proceeds; the intended behavior is not a consumer hold for
  512ms.

For **Macro 2**, the intentional pause budget is:

| Accepted Work | Repetitions / Volume Taps | Pause Budget |
| --- | ---: | ---: |
| One invocation | 6 | `6 × 512ms = 3,072ms` |
| Eight waiting invocations | 48 | `8 × 3,072ms = 24,576ms` |
| One active plus eight waiting invocations | Up to 54 | `9 × 3,072ms = 27,648ms` |

Thus, after all pressing stops, a full backlog consisting only of this macro
can keep playback busy for approximately 27.6 seconds plus processing and USB
time. An already partly completed active macro reduces the remaining pause
budget; queued toggle macros also reduce the number of volume invocations.
The 27,648ms figure includes each invocation's final pause. Continued presses
can refill freed slots and sustain playback indefinitely. USB backpressure can
extend the drain time, so this is not an unconditional wall-clock upper bound.

As a separate software check, a temporary host harness exercised the current
six-key action engine with the same two-step volume macro and repeat count.
It confirmed eight waiting entries plus one active macro, rejection of a ninth
waiting invocation and a subsequent macro-based toggle, and delivery of a
direct toggle during the active pause with a full FIFO. All nine accepted
volume invocations produced 54 presses and 54 releases and finished at
27,828ms under simulated, unblocked USB with polling every 1ms. This verifies
the queue interpretation; it is not a hardware or macOS measurement.

## Interpretation and Next Capture

The clarified behavior is consistent with expected queue handling: volume
playback sustained the HUD until the backlog drained, the queued macro-based
toggle was delayed or dropped, and the direct toggle continued to work because
it bypasses the FIFO. No evidence supplied so far distinguishes a delayed
accepted **Macro 1** invocation from one dropped when the queue was full.
This workload does not currently establish a new firmware fault or reproduce
the earlier unexpected bootloader/invalid-config indications. Those earlier
incidents remain under investigation with a shared cause as the working
hypothesis.

The extended testing and matching images make further queue saturation a lower
priority than the original idle failure. Continue with the original incident
profile during long untouched runs, both without a browser connection and in
separate runs with read-only monitoring. Investigate shared USB/reset, startup,
and runtime-state paths alongside other memory corruption; retain a shared
cause for the two original incidents as the working hypothesis.

If unexpected LEDs or another fault recurs, record stack use, status, saved and
active bytes, LEDs, and USB connectivity before a save or restart where possible.
Preserve reader JSON when available. For optional queue-behavior measurements,
record the time pressing stops, elapsed drain time after releasing all controls,
and dropped-button counts before and after an isolated **Macro 1** trigger with
the FIFO full. Record whether an accepted toggle takes effect later.
The raw six-byte status includes dropped-button and dropped-rotation counts
at zero-based indices 4 and 5; these do not expose current queue occupancy.
The original three-key volume workload has no separately supplied stack sample;
the later overall maximum of 35 bytes is recorded independently above.
