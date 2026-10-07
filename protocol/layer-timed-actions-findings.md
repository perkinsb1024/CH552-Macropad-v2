# Layer-scoped timed actions: feasibility measurements

This is the initial measurement record. The subsequent
[interval-width and flash-fit investigation](six-byte-timer-intervals-and-fit.md)
fits the scoped eight-bit candidate without feature degradation and records the
retained opt-in implementation. The sizes and unchanged-production statements
below describe the initial pass, before those optimizations.

Measured on 2026-10-05 against `60661c8`, with an initially clean working tree.
Production firmware, configurator, configuration version and checked-in releases
were left unchanged. The new files are this investigation, its source generator,
and its host probe.

## Result

Six-byte records are the better candidate for this firmware. With the requested
reset-on-layer-change behavior, they add 156 bytes on six-key hardware and 158
bytes on three-key hardware. Expanding the interval to eight bits brings the
total increase to 178 / 180 bytes. The combined implementation exceeds the actual
application limit by 172 / 170 bytes.

Two shared selector bytes save at most two configuration bytes compared with
six-byte records, but the tested implementation adds 330 / 332 firmware bytes.
Packed decoding, conditional metadata placement, validation and addressing cost
more code than directly reading a sixth record byte.

The feature is small enough to justify a targeted flash-optimization investigation,
but neither layout fits the current firmware. A reasonable next target is to
recover 250–300 bytes before choosing a new configuration format. That would
leave roughly 78–128 bytes of six-key headroom after this combined prototype;
it is a target, not an established saving. These measurements are working
prototypes, not a claim that the implementations are size-optimal.

## Firmware sizes

The application limit is 14,336 bytes. Negative headroom means the image is too
large for the application region. All candidate numbers include configuration
validation, changed record/string addressing where needed, runtime behavior,
and the RAM-placement adjustments needed to link.

| Prototype | Six-key flash | Three-key flash | Increase, six / three | Headroom, six / three |
| --- | ---: | ---: | ---: | ---: |
| Current firmware | 14,330 | 14,326 | 0 / 0 | 6 / 10 |
| RAM placement only, control measurement | 14,332 | 14,328 | 2 / 2 | 4 / 8 |
| Shared selectors, pause outside layer | 14,554 | 14,552 | 224 / 226 | -218 / -216 |
| Shared selectors, reset on layer change | 14,660 | 14,658 | 330 / 332 | -324 / -322 |
| Six-byte records, pause, original interval | 14,410 | 14,408 | 80 / 82 | -74 / -72 |
| Six-byte records, reset, original interval | 14,486 | 14,484 | 156 / 158 | -150 / -148 |
| Six-byte records, eight-bit interval only, all timers global | 14,344 | 14,340 | 14 / 14 | -8 / -4 |
| Six-byte records, pause, eight-bit interval | 14,426 | 14,424 | 96 / 98 | -90 / -88 |
| Six-byte records, reset, eight-bit interval, cancel next-input action | 14,508 | 14,506 | 178 / 180 | -172 / -170 |
| Six-byte records, reset, eight-bit interval, retain next-input action | 14,508 | 14,506 | 178 / 180 | -172 / -170 |

The eight-bit interval alone costs 14 bytes. Adding it to the scoped reset
prototype costs another 22 bytes. Compiler register allocation and interactions
between paths make those incremental costs different.

## Configuration storage

Three bits can encode the optional scope without an additional enable bit:
`0` means all layers; `1–7` means the corresponding layer, with zero-based
runtime layer indices converted by adding one. Validation rejects a nonzero
selector beyond the configured layer count.

The shared prototype inserts two bytes between the chord table and the timer
records, only when at least one timer exists. Each byte holds two selectors in
bits 0–2 and 4–6. Bits 3 and 7 are unused. This avoids a selector spanning bytes.
String-pool addressing and capacity validation account for those two bytes.

The combined six-byte prototype uses this experimental layout:

| Record offset | Meaning |
| --- | --- |
| 0 | Interval minus one, 0–255 means 1–256 interval units |
| 1–2 | Expiry action, existing two-byte encoding |
| 3–4 | Next-input action, existing two-byte encoding |
| 5 bits 0–2 | Scope: all layers or one of seven layers |
| 5 bits 3–5 | Unused |
| 5 bit 6 | Consume first physical input after firing |
| 5 bit 7 | Restart interval on physical input |

The original-interval six-byte probes keep the existing first byte and use only
the scope bits in byte 5, to isolate the cost of layer support.

| Timer count | Current timer bytes | Shared-selector layout | Six-byte layout |
| --- | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 |
| 1 | 5 | 7 | 6 |
| 2 | 10 | 12 | 12 |
| 3 | 15 | 17 | 18 |
| 4 | 20 | 22 | 24 |

With four timers, the shared layout saves two configuration bytes; with one,
the six-byte layout saves one. The active image and DataFlash remain 128 bytes.
This is a reduction in available profile/string capacity, separate from the
firmware code costs above. Both layouts would require a format change and
migration before use in a product.

## Interval resolution

An eight-bit interval does not require a longer maximum duration. The probe
changes the shared fine clock from `millis() >> 9` to `millis() >> 7`, retaining
the existing eight-bit per-timer fractional accumulator:

| Property | Current | Eight-bit prototype |
| --- | --- | --- |
| Selectable interval unit | 131.072 s | 32.768 s |
| Number of interval units | 1–64 | 1–256 |
| Maximum duration | 8,388.608 s | 8,388.608 s |
| Fine scheduling quantum | 512ms | 128ms |

This gives four times finer selectable durations and four times finer dispatch
quantization, with the same maximum of 2 h 19 min 48.608 s. The one-unit deadline
is greater than 32.640 s and at most 32.768 s after reset, before polling,
playback and oscillator effects. Polling must remain frequent enough to avoid
missing a complete fine-clock wrap: 32.768 seconds in the prototype, compared
with 131.072 seconds currently. Existing unsigned `millis()` wrap behavior is
unchanged by these probes and remains a separate scheduler consideration.

The existing age counter embeds its pending next-input flag in bit 7. Using all
eight bits for age requires separate pending state. The prototype uses four
`__idata` bytes, one per timer, avoiding dynamic bit-mask operations. A compact
bit-mask alternative was not measured; its smaller RAM use does not necessarily
mean smaller 8051 code.

## Layer behavior and next-input actions

The reset variants implement the user's selected behavior at the actual effective
layer transition, rather than discovering it during a later timer poll:

- A scoped timer advances only while its layer is effective.
- Every actual effective-layer change clears scoped timers' age and fraction.
- Entering the layer therefore starts a fresh interval.
- Leaving and returning between timer polls still resets the interval.
- Same-layer selection does not reset it.
- Global timers retain their existing timing and input behavior.
- Momentary and one-shot layers follow the effective layer, like other bindings.
- Timed actions can themselves change the effective layer; later timer records
  see the new layer during that same traversal.

There are two viable meanings for an already-armed next-input action. The strict
variants cancel it when changing layers. This also cancels a timer's next-input
action if its own expiry action changes away from its assigned layer.

The final additional variant resets only interval state and retains the pending
next-input action. Once armed, that action runs on the first physical input even
if another layer is now active, including the existing consume flag. This allows
an expiry action to select another layer and a next-input action to restore
**Previous layer**. Its measured flash size is identical to the cancelling
variant. Retaining the pending action is the recommended starting point for a
future implementation, subject to the intended user-visible behavior.

## RAM and implementation constraints

Direct internal RAM allocation is a real constraint as well as flash. Straight
additions initially failed the linker because new compiler temporaries did not
fit in directly addressed RAM. The retained six-byte probes move four validation
locals plus the timer traversal index/age into `__idata`. The separate control
measurement shows a net two-byte flash cost for those placement changes alone.
The packed shared layout also relocates two layer globals and two physical-input
locals to make its temporary allocation fit.

Six-byte probes keep paged RAM at 107 bytes, with one byte remaining in page zero.
The shared probes use 108 bytes, filling that page. Ordinary external allocation
remains 526 bytes for six-key and 517 for three-key. The combined six-byte probe
uses four additional pending-state bytes internally. Linker-reported stack
capacity changes from 111 / 114 bytes to 106 / 109 bytes for cancellation, or
107 / 110 for retaining next-input actions. These are static linker capacities;
no new hardware stack-usage measurement was performed.

## Verification and reproduction

The unchanged production firmware passed the complete
`python3 tests/run_host_tests.py` suite. Each of the twenty final board/prototype
combinations passed its targeted host probe before building with the normal SDCC
toolchain. The probes cover scope validation through all seven selectors, four
independent timers, string offsets and exact image-capacity limits, fractional
carry and fine-clock wrap, minimum/maximum intervals, repeated expiry and
coalesced next-input actions, consume/restart flags, global timing, persistent
and momentary layers, brief leave/return transitions, and expiry-driven layer
changes. The project builder's startup and paged/external memory checks pass for
the final linked candidates. `git diff --check` passes.

Reproduce all variants with:

```sh
python3 protocol/build-layer-timer-probes.py
```

The script creates temporary source snapshots, runs
`protocol/layer-timer-probe.c`, and builds both geometries. It uses a 16,384-byte
linker ceiling solely to measure images that exceed the real 14,336-byte limit.
Its output reports real application headroom and retains `.mem`, `.map`, assembly,
ordinary firmware outputs and build/probe logs. Build failures cause a nonzero
exit; expected negative flash headroom is a measurement result.

The consolidated artifacts for this investigation are at
`/private/tmp/macropad-layer-timer-findings-8lqrekla/`, with `results.json` and a
directory for each table row/board. Temporary artifacts may be removed by system
cleanup. The generator and probe remain in the repository for reproduction.

*The experimental images are incompatible measurement images, still advertising
the unchanged version number, and the feature candidates exceed usable flash.
They are not suitable for flashing to a device.* No upload, hardware validation,
release generation, configurator change or new configuration version was made.
