# Encoder Startup Bootloader Debounce Findings

## Scope and Status

Explored October 9, 2026, against `8de77d2` on
`experiment/usb-enumeration-warning-indicator`. The user confirmed that the
remaining encoder check at power-up should be debounced. The old runtime
long-hold gesture is already removed; the HID bootloader command remains.

The original trial initially exceeded the application flash limit. Its patch
and historical probe remain in Git history; their startup coverage is now
integrated into `tests/input_test.c`.
Following the user's request to review recent features for optimizations, the
debounce change and a smaller layer-indicator update have been integrated into
the project's firmware source. Both variants now fit the real limit and pass
host checks. Hardware validation remains pending. No releases were generated or
replaced, and no firmware was flashed during this exploration.

The measurements below describe this integration checkpoint. Later function-call
optimizations and the USB interrupt parameter fix changed the totals; see
[the current format reference](config-v12.md#builds-and-measurements) for current
firmware measurements.

## Integrated Behavior

Use the existing 10ms `DEBOUNCE_MS` constant and sample the encoder button before
each of ten 1000µs waits, then once more before entering the bootloader. Any
sample showing release ends the startup check immediately. A released button
adds no wait; a continuously held button adds approximately 10ms. Interrupts
remain enabled during the waits when already enabled.

This is a startup qualification window. It does not restart after release or
arm a later runtime gesture. Holding the button steadily before applying power
remains the intended recovery gesture, including with missing or invalid
configuration. A button still bouncing when checked can reject that attempt;
reconnecting with the button already held permits another attempt.

Sampling every 1ms can miss a shorter release between samples, just as polling
the normal input scanner can miss transitions between scans. The candidate
requires agreement across eleven samples, rather than checking only the two
ends of a 10ms delay. The HID command and its acknowledgement sequence are
unchanged.

## Initial Flash and RAM Measurements

Temporary native builds used CH55xDuino 0.0.25, SDCC 4.2.2 build.13407_4, 24MHz,
148 USB DMA bytes, and enabled color preview. The actual application capacity
is 14,336 bytes. The exploratory linker ceiling was raised to 16,384 bytes only
to measure oversized candidates; those outputs are not installable firmware.
Both candidates pass the builder's RAM/startup-layout checks.

| Hardware | Current Flash | Trial Flash | Increase | Over Application Limit | Paged RAM, Both | Ordinary XSEG, Both | Absolute Image, Both | Stack Capacity, Both |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Three keys | 14,328 | 14,344 | 16 | 8 | 95 | 360 | 128 | 80 |
| Six keys | 14,332 | 14,348 | 16 | 12 | 95 | 369 | 128 | 77 |

The initial candidate added no persistent RAM allocation and did not reduce
linker stack capacity. At least 12 additional flash bytes needed to be reclaimed
to fit both variants with this implementation.

Other measured candidates:

| Implementation | Flash Increase Per Variant | Result |
| --- | ---: | --- |
| Continuous GPIO polling using the 16-bit millisecond clock | 30 | Both variants exceed the limit |
| Continuous GPIO polling using the low eight millisecond bits | 22 | Both variants exceed the limit |
| 1ms samples with the bootloader call inside the counter loop | 20 | Both variants exceed the limit |
| 1ms samples with the final bootloader call outside the loop | 16 | Smallest plain-C candidate measured without RAM changes |

Moving the two-byte warning timestamp from ordinary XSEG to paged RAM reduced
the sampled candidate by another 4 flash bytes, but still left the six-key build
8 bytes over the limit. It also changed the allocator's ordinary XSEG starting
address from `0x0F4` to `0x109`, increasing the gap before that area. This RAM
placement change was not included in the original trial.

The expendable startup-indicator behavior identified in `AGENTS.md` was reviewed
as a possible source of flash savings. The branch has already changed its
pre-enumeration behavior for the yellow warning. The old 24-byte saving cannot
be assumed to carry over unchanged; removing current indication-preservation
behavior would require a separate measured candidate and review of its effects.

## Recent Feature Review and Integrated Measurements

The review focused on the 300µs LED latch wait, no-enumeration warning, preserved
layer-indicator state across enumeration/resets, and HID bootloader handoff.
The user also reported three apparent spontaneous bootloader entries; this is
additional motivation for preventive debounce, not confirmation of their cause.

The retained optimization is in the layer-indicator update at the end of
`loop()`. The original code called `actionsLayer()` up to three times and
compared the resulting layer against `lastLayer` twice. Read the selected-layer
notification and the current layer once, handle an actual layer change once,
then start the indication if a selection or change occurred. The notification
getter only clears its pending flag; it does not change the effective layer.
No layer-changing actions run between these reads and the indicator update.

This preserves same-layer re-indication, temporary-effect retention on same-layer
selection, effect clearing on an actual switch, and encoder movement reset only
on an actual switch. It leaves warning timing, USB acknowledgement/disconnection,
and the validated LED latch wait unchanged.

An initial current-layer snapshot saved 12 flash bytes per variant. Flattening
the control flow around the selection flag saved 18 bytes. A separate cached
"layer changed" Boolean was also measured; it exceeded the six-key flash limit
when combined with debounce and was not retained.

Separate temporary native builds with the real 14,336-byte limit measured:

| Hardware | Baseline Flash | Optimization Only | Optimization Saving | Optimization and Debounce | Net Change | Final Spare |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three keys | 14,328 | 14,310 | 18 | 14,326 | −2 | 10 |
| Six keys | 14,332 | 14,314 | 18 | 14,330 | −2 | 6 |

The optimization pays for the 16-byte debounce addition and leaves 2 more bytes
free on each variant. Final paged RAM remains 95 bytes. Ordinary XSEG remains
360 bytes for three keys and 369 for six keys, plus the separate 128-byte active
image. Linker stack capacity remains 80 bytes for three keys and 77 for six keys.
No RAM allocation or stack capacity was reduced at this checkpoint.

The project's integrated builds and memory reports are under
`/private/tmp/macropad-startup-optimization/integrated-three-key/` and
`/private/tmp/macropad-startup-optimization/integrated-six-key/`.
Both are ordinary temporary builds, not releases.

## Automated Verification

The new 184-case startup matrix is integrated into `tests/input_test.c`. Run:

```sh
python3 -B tests/run_host_tests.py
python3 -B tests/run_host_tests.py --no-preview
```

Both full suites pass: configuration, actions, protocol, USB, macros, timed
actions, input tests for both variants, and six memory-layout tests. Existing
input coverage includes same-layer re-indication, momentary layer restoration,
temporary effects, encoder resets, startup warning dismissal, and indication
preservation across USB enumeration/reset.

A historical host probe reproduced the original trial against the sketch and
input-test source from `8de77d2`, using the configuration/action modules and host
headers available at that checkpoint. It applied the patch to a temporary sketch
copy and ran that input suite plus 184 startup scenarios for each hardware
variant with color preview enabled and disabled. All four runs passed. The
integrated input suite covers the same startup matrix, including:

- A released button and release at every sampled boundary from 0ms through 10ms.
- A single released sample followed by another press, rejecting the startup
  attempt instead of restarting qualification.
- A continuously held button entering only after ten waits.
- Valid and missing/invalid profiles.
- Start times crossing the 8-bit, 16-bit, and 32-bit clock boundaries.
- Normal runtime presses and extended holds after a rejected startup attempt.
- Existing HID handoff checks, including the red indication and disconnect waits.

The probe's delay stub advances simulated time. It validates control flow and
sampling boundaries; it does not measure electrical bounce, physical delay
duration, or USB behavior during the 10ms startup window. Hardware validation
remains pending for the integrated build, which now fits the real flash limit.

Temporary native reports are under
`/private/tmp/macropad-bootloader-debounce/final-three-key/` and
`/private/tmp/macropad-bootloader-debounce/final-six-key/`. The temporary source
is under `/private/tmp/macropad-bootloader-debounce/samples-tail-source/`.

Debouncing is preventive hardening. The unexpected all-red startup event and
the delayed yellow-warning event remain unexplained; neither was reproduced
or linked conclusively to the encoder input.
