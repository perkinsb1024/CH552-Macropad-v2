# LED and Startup Glitch Findings

Recorded October 9, 2026. The user accepts the LED blink glitch as fixed after
approximately 30 attempts without recurrence using the isolated latch-interval
test build. The two startup issues remain unresolved. The validated LED change
has been integrated into the project's firmware source. Trial patches and raw
evidence remain in Git history. This document records that investigation
checkpoint; later fixes and optimizations changed the measurements. See
[the current format reference](config-v12.md#builds-and-measurements) for current
firmware sizes and memory allocation.

## Top Priority: Debounce Startup Encoder Bootloader Entry

The user designated adding debounce to the startup encoder bootloader check as
the top priority. Require a sustained pressed state before entering the
bootloader, rather than relying on the previous single input sample. Preserve
intentional entry by holding the encoder button while powering on, including
when the saved profile is invalid.

The 10ms startup check is now implemented, with samples every 1ms and immediate
rejection on any observed release. A subsequent
[debounce exploration and optimization](encoder-startup-debounce-findings.md)
records the implementation and measurements. Simplifying the recent layer
indicator update saves 18 flash bytes, paying for the 16-byte debounce addition.
Both variants fit, with 10 flash bytes free for three keys and 6 for six keys.
RAM allocation and stack capacity are unchanged. Valid/invalid-profile recovery,
released inputs, transient low samples, and later runtime holds pass on both
variants, with color preview enabled and disabled. Hardware validation remains
pending; debounce is not a confirmed explanation for the unexpected red event.

## Device and Profile Context

- The user reports a device running the build from
  `experiment/usb-enumeration-warning-indicator`, without diagnostic features.
- Source reviewed: `37904985d503d6ea640f3a9498af5b2d1ebe50f7`
  (commit message: "Added no-USB-enumeration warning"). The installed binary's checksum was
  not captured, so this is source provenance, not independently verified binary
  provenance.
- The observations refer to three LEDs, identified as keys 1, 2, and 3.
- The profile has two layers: **Layer 1** uses a 1.5-second rainbow indicator;
  **Layer 2** uses **Blink N Times**, giving two solid bright salmon blinks.
- The profile starts on **Layer 2**. Encoder press selects **Relative layer**
  with an offset of +1.
- The user subsequently supplied the complete profile JSON. It identifies the three-key
  variant, uses a 40ms chord window, 60-degree rainbow spacing and fast rainbow
  speed, and has no chords, timed actions, macros, or LED-control bindings.
  Startup layer index 1 means **Layer 2**. Its indicator palette index is 1,
  which the current firmware renders as RGB `(255, 22, 7)`.
- The user has used the same power brick throughout these observations.

## Issue 1: Intermittent Blink Timing and LED Synchronization

### Observations

- On entering **Layer 2**, the indicator sometimes looks correct, sometimes
  its first blink appears slightly too short, and sometimes the LEDs appear
  out of sync.
- One example: the key 1 LED briefly appears black while keys 2 and 3 correctly
  show salmon.
- The user estimates a 20–40% occurrence rate, without a reliable reproduction
  sequence.
- In a subsequent captured occurrence, the user switched to **Layer 1**, waited
  for its 1.5-second rainbow to finish, waited approximately one more second,
  then pressed the encoder. Keys 2 and 3 lit salmon while key 1 stayed off.
  Immediately before the first blink ended, key 1 lit salmon; all three then
  went dark and performed the second blink together.
- The user confirmed that encoder release coincided with key 1 lighting.
  They also confirmed that the apparently short first blink depends on release:
  holding the encoder can skip the entire first visible blink, leaving only
  the second blink visible.

### Code Findings

- In [the sketch](../CH552_Universal_Macropad.ino), all LEDs use one shared
  `layerIndicatorPhasesLeft` and `layerIndicatorDeadline`. `updateLeds()` takes
  a snapshot of the phase count and renders the complete LED buffer before
  transmitting it. There are no independent per-LED blink timers.
- Blink phases nominally last 250ms. The deadline uses 2ms ticks, allowing
  up to 1ms of initial rounding; this alone does not explain visibly different
  states between LEDs.
- A debounced button press can change the effective layer and immediately call
  `updateLeds()` from `scanButton()`. The new layer's phase count is initialized
  later, near the end of `loop()`, by `startLayerIndicator()`.
- Consequently, an intermediate frame can use the new layer's settings with
  the outgoing indicator's phase count. An odd remaining phase count from the
  timed rainbow would be interpreted as a dark phase by the new blink behavior.
  This possibility was identified by inspection, not reproduced in a dedicated
  test or measured on hardware.
- Multiple LED frames can therefore be transmitted close together during a
  layer selection. `displayLeds()` adds no explicit frame-latch delay. The
  installed CH55xDuino WS2812 driver disables interrupts during transmission
  and restores them afterward, but does not enforce a minimum low interval
  between frames. Its source comments mention differing reset-time requirements
  between LED variants. Actual frame gaps and the installed LEDs' requirements
  have not been measured.

### Video and Frame-Sequence Findings

The user supplied `/Users/benperkins/Downloads/trimmed.mov`, a 4.656667-second
slow-motion clip. Inspection across extracted frames confirms that the key 1
LED stays dark for much of the first visible blink, rather than appearing dark
only at a single captured transition. Near its end:

| Clip Presentation Time | Visible State |
| --- | --- |
| 2.602083 seconds | Keys 2 and 3 lit; key 1 dark |
| 2.635417 seconds | All three lit |
| 2.668750 seconds | All three dark |

These are presentation times in the slowed clip, not wall-clock blink durations.
Encoder release timing is corroborated by the user's observation; the video
does not expose the electrical switch state. A brief camera capture artifact
does not account for the sustained partial indication.

A temporary host probe used the firmware's real input scanner and action
dispatcher with the supplied profile's binary settings. It started on **Layer 2**,
switched to **Layer 1**, let the rainbow finish, waited another second, and
switched back. It validated the binary profile with `configValid()`.
The captured frame trace showed:

| Relative Time From Debounced Layer Selection | Frame Submitted to the Driver |
| --- | --- |
| 0ms, before indicator initialization | All three black |
| 0ms, after indicator initialization | All three RGB `(255, 22, 7)` |
| 200ms, simulated encoder release | All three RGB `(255, 22, 7)` again |
| 250ms | All three black |
| 500ms | All three RGB `(255, 22, 7)` |
| 750ms | All three black |

The probe deliberately chose a 200ms held interval to demonstrate the release
path; it is not a measurement of the user's press duration. Host millisecond
timestamps cannot measure the microsecond gap between the first two frames.
No submitted frame in this sequence deliberately leaves only key 1 dark.

### Current Interpretation

The earlier outgoing-odd-phase hypothesis cannot explain the captured occurrence:
the rainbow had finished and its remaining phase count was zero. A redundant
black frame is still sent immediately before the first salmon frame.

The evidence strongly suggests that some or all LEDs miss the initial salmon
update while the blink timer continues normally. Encoder release submits another
salmon frame without restarting that timer. If the new frame is received, the
remaining part of the first blink becomes visible; holding the encoder provides
no such replacement frame before the first on-phase expires. The second blink
has its own update after a long idle interval.

Insufficient low time between consecutive LED frames is the leading hypothesis.
The driver does not guarantee this interval, and individual LED variants have
different reset/latch requirements. For example, the manufacturer's
[SK6812MINI-E datasheet](https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf)
specifies more than 80µs, while the manufacturer's
[WS2812B-V5/W datasheet](https://datasheet.lcsc.com/datasheet/pdf/3795cfb9d54f7ec8ecc0b043ede3c05a.pdf?productCode=C2846931)
specifies more than 280µs. Neither identifies the particular LEDs installed in
this pad. The physical gap, signal quality, and per-LED latch behavior remain
unmeasured; the hypothesis is not yet a confirmed root cause.

### Isolated Latch-Interval Test Build

An isolated source copy under `/private/tmp/macropad-led-frame-probe/` adds a
300µs wait before every LED transmission. This leaves interrupts enabled during
the wait when they were already enabled; the driver retains its existing
interrupt handling during transmission. Blink timers, layer selection, input
debounce, and the profile format are unchanged. The encoder bootloader debounce
change was not part of this LED test; it was implemented separately afterward.

The ordinary C driver-call wrapper plus the new wait exceeded the three-key
application flash limit. The final trial packs the existing driver's DPTR/B/A
arguments directly in SDCC assembly to fit. Host builds still use the stub's
ordinary C call. The original trial patch contained only this `displayLeds()`
change. The validated change was subsequently
applied to the project's firmware source, with an updated explanatory comment.
Fresh builds of the integrated source produced HEX files identical to the trial
builds for both variants. The change saves 4 flash bytes per variant, with no RAM
allocation or stack-capacity change at that checkpoint.

Fresh baseline and final trial builds used the installed CH55xDuino 0.0.25
toolchain, 24MHz, 148-byte USB reservation, enabled color preview, and the actual
14,336-byte application limit:

| Variant | Baseline Flash | Trial Flash | Trial Flash Spare | Stack Capacity, Both Builds | Paged RAM, Both Builds | External RAM, Both Builds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three keys | 14,332 | 14,328 | 8 | 80 | 95 | 360 |
| Six keys | 14,336 | 14,332 | 4 | 77 | 95 | 369 |

Both trial builds pass the native memory-layout checks. Existing host input
suites pass for both variants with an added stub assertion requiring the 300µs
wait before every frame, including startup and bootloader indication. This
assertion checks call ordering, not the physical duration or LED response.

No release files were generated or replaced.

### Hardware Validation and Resolution

After testing the three-key trial build, the user reported approximately 30
attempts without reproducing the glitch and accepted it as fixed. This supports
the latch-interval explanation for the partial or missing first blink. The
physical signal has not been measured, so the precise electrical failure remains
inferred. Six-key hardware validation has not been reported.

Issue 1 is resolved for the tested three-key device with the 300µs latch wait.
The tested latch wait has been integrated into the project's firmware source.
The unexpected red and dark startup events remain open, and
startup encoder bootloader debounce is implemented, pending hardware validation.

## Issue 2: Unexpected All-Red LEDs

### Observations

- After moving the device from the power brick to the computer, all three LEDs
  turned red and then recovered after a short interval.
- The duration was not measured; the user felt it was less than eight seconds.
- The encoder button was not pressed during that event.
- Key responsiveness was not checked while the LEDs were red.
- The startup profile is **Layer 2** with salmon blinks, ruling out the proposed
  explanation that the startup rainbow merely began at red.
- Many subsequent computer reconnection attempts did not reproduce the event.
- One later bootloader entry occurred while the encoder button was accidentally
  held. The user identified that entry as expected.
- The user subsequently reported three cases where the device appeared to enter
  bootloader mode on its own. Additional timings or USB identities were not
  supplied, so the reported appearances are not independently confirmed entries.

### Code and USB Findings

- `enterBootloader()` explicitly transmits solid red to every LED, disconnects
  USB, disables interrupts, and calls the chip's bootloader at address `0x3800`.
- The deliberate entry paths in this build are the startup encoder check and
  a successfully processed installer bootloader command.
- The investigated build's startup encoder check used a single sampled input state without debounce.
  A transient low sample is a possible explanation; no such sample was captured.
- A normal USB bus reset reapplies configuration/input state and does not repeat
  the startup encoder bootloader check.
- The invalid-profile warning flashes one red LED. The enumeration warning
  flashes one yellow LED. Neither deliberately lights all three red.
- A USB monitor sampled every 200ms from 18:34:47 to 18:44:47 PDT. It recorded
  one bootloader appearance at 18:38:55.854, consistent with the user's expected
  button-held entry. All other recorded device appearances were normal firmware.
  The original unexplained event occurred before monitoring began.
- Normal firmware uses USB VID:PID `1209:c55d`; the bootloader uses `4348:55e0`.
- The historical USB log also contained an initial monitor-start line at 18:34:26 from an unsuccessful launch; polling
  began with the subsequent successful launch at 18:34:47.

### Status and Follow-Up

Accidental bootloader entry remains a hypothesis for the original event. The
captured, expected entry does not establish its cause. All-red alone is not a
crash diagnostic, and there is no captured evidence of a stack fault.

If it recurs, record its time, video, key responsiveness, whether recovery occurs
without further interaction, and whether USB exposes the bootloader or normal
firmware. The monitor's sampling can miss brief transitions and does not report
internal resets or firmware execution state.

## Issue 3: Unexpected Dark Period Before the Yellow Warning

### Observations

- After moving the device from the computer back to the same power brick, the
  LEDs remained off for approximately five to ten seconds before the yellow
  enumeration warning appeared.
- No layer indicators played during that interval.
- Subsequent attempts with the same power brick did not reproduce the delay.
- The user confirmed that this was the same brick used throughout, rather than
  a newly introduced power source.
- No timed video or measurement of supply voltage, firmware startup, or key
  responsiveness during the dark interval was captured.

### Code Findings and Hypotheses

- The absence of layer indicators is expected while `startupWaiting` remains
  active. Startup indication begins after USB enumeration or a qualifying key 1
  press dismisses the warning. A power brick need not enumerate the USB device.
- The first visible yellow phase is scheduled approximately 1000ms after setup
  initializes `errorLedChanged`: the first 500ms deadline enables the warning
  while keeping the LED dark; the second lights it yellow.
- `USBInit()` configures registers and endpoints without a multi-second wait.
  The observed five-to-ten-second delay is not the intended warning timing.
- A possible delay before application startup was considered. The configured
  hardware bootloader trigger is a pull-up on P3.6 / USB D+, separate from the
  firmware's encoder-button check. Some chargers apply identification voltages
  to the USB data pins. If those voltages trigger hardware bootloader entry,
  a bootloader wait followed by application startup could delay the warning.
  This sequence was not observed directly, and no exact timeout was established
  for this device.
- Hardware bootloader entry happens before our firmware's `enterBootloader()`
  code runs, so it need not produce the firmware's red indication.
- Delayed or unstable supply power, repeated startup, and a firmware timing or
  LED-output fault remain alternatives without measurements to distinguish them.
  Failure to reproduce with the same brick leaves these possibilities unresolved.

### Status and Follow-Up

Suggested comparisons have not been reported as completed: the same cable with
another already powered brick, or the original brick with data connections
blocked. On a separate attempt, a brief key 1 press around two seconds into the
dark period could help: successful warning dismissal and normal lighting would
show that the application was already running. No response would be inconclusive.

Background sources supporting the hardware hypothesis:

- [TI TPS2514 charging-controller documentation](https://www.ti.com/product/TPS2514)
  describes charger modes applying identification voltages to D+ and D−.
- [Adafruit CH552 setup instructions](https://learn.adafruit.com/adafruit-ch552-qt-py/arduino-ide-setup)
  identify the P3.6 / D+ pull-up bootloader configuration.
- [Adafruit CH552 bootloader instructions](https://learn.adafruit.com/adafruit-ch552-qt-py/bootloader-mode)
  describe its limited bootloader waiting period. They do not establish the
  timeout or behavior of this particular macropad and power brick.

## Verification and Investigation Limits

`python3 tests/run_host_tests.py` passed during this investigation: configuration,
actions, protocol, USB, macros, timed actions, input tests for both hardware
variants, and six build-layout checks. Existing startup tests cover first yellow
at 1000ms, enumeration, warning dismissal, and clock wrapping.

The host tests simulate the clock, GPIO, USB, and LED transmission. They do not
exercise charger voltages, the chip's hardware bootloader, physical LED latching,
or intermittent electrical faults. The later frame probe confirms submitted
frame contents and ordering, and the isolated trial tests require a latch wait;
neither reproduces the physical fault in software. No common cause for all three
issues has been established.
