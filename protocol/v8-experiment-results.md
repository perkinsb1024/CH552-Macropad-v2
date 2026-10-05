# V8 firmware experiments

## Combined implementation

Branch: `experiment/v8-merged`. The normal build enables timed-action precision,
Consumer Hold and held scrolling. Acceleration is disabled by default. Color
preview and all existing lighting behavior are preserved.

| Build | Six-key flash | Three-key flash | Free (6/3 key) |
| --- | ---: | ---: | ---: |
| Initial combined implementation, acceleration on | 14,879 | 14,875 | -543 / -539 |
| Optimized combined implementation, acceleration on | 14,667 | 14,665 | -331 / -329 |
| Optimized combined implementation, acceleration off (default) | 14,325 | 14,323 | 11 / 13 |

The default build adds seven persistent RAM bytes (four timer fractions and
three consumer state bytes). RAM areas are PSEG 108, XSEG 526 / 517, DSEG 127,
ISEG 16 / 13, BSEG 26 bits, stack reserve 112 / 115 bytes. Acceleration adds
six more persistent bytes; its linked ISEG is 23 / 20 and stack reserve 106 / 109.

Optimizations keep action types and stream contexts eight-bit, narrow consumer
ownership comparisons, assemble consumer usages without an intermediate
16-bit right shift, share repeat eligibility, simplify timer clock updates and
keyboard validation, and avoid CRC boolean-conversion overhead. Host suites
pass with acceleration both enabled and disabled. Two USB queue trials were
discarded: direct critical wrappers were rejected by SDCC's nested-critical
rules, and deriving report lengths saved RAM but no flash.

Standalone milestone costs remain recorded below and in the consumer/scroll
experiment reports. Combined costs are not additive because compiler allocation
and shared optimizations change when features are linked together. The default
combined build is not compatible with the unchanged v7 configurator; v8 UI and
migration are the next implementation step. Acceleration testing is isolated to
its own experiment branch.

Baseline: `196e81e`. Flash capacity: 14,336 bytes. Measurements use ordinary
temporary builds of both fixed hardware geometries, never release generation.
Oversized diagnostic builds use a relaxed linker ceiling solely to measure cost;
they are not flashable images. No hardware has been flashed by this experiment.

| Build | Six-key flash | Three-key flash | Delta from baseline (both) | Six-key free |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 14,263 | 14,259 | 0 | 73 |
| Timed action precision | 14,323 | 14,319 | +60 | 13 |

RAM is recorded by SDCC memory area, not a single ambiguous percentage:

| Build | PSEG | XSEG (6/3 key) | DSEG (6/3 key) | ISEG (6/3 key) | BSEG bits | Stack available (6/3 key) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 108 | 526 / 517 | 128 / 128 | 9 / 6 | 30 | 120 / 123 |
| Timed action precision | 108 | 526 / 517 | 127 / 127 | 13 / 10 | 29 | 115 / 118 |

PSEG is page-zero external RAM above the 148-byte USB DMA reservation; its
108-byte baseline already fills the region through address 255. XSEG is ordinary
external RAM. DSEG includes direct-address allocations/layout, ISEG indirect
internal allocations, BSEG bit allocations, and stack availability is the
linker's static reserve, not a measured worst-case runtime stack depth.

## Timed action precision milestone

Branch: `experiment/v8-timed-action-accuracy`.

Uses one extra fractional age byte per supported timer and the existing shared
clock byte, now sampled from `millis() >> 9`. Each timer advances its coarse age
on its own 256-tick overflow. Elapsed fine ticks are accounted for across missed
polls and the eight-bit clock wrap, provided polling gaps remain below 131.072
seconds. Normal main-loop polling is much faster; arbitrarily blocked execution
for a full wrap remains outside this clock representation's contract.

Configuration stays five bytes per timed action, with 1–64 intervals of 131.072
seconds and the same >2-hour maximum. Reset quantization is below 512 ms instead
of 131.072 seconds. Due-time ordering, resume/consume flags, periodic phases, and
per-action reset flags are preserved.

The initial implementation exhausted direct/paged RAM. Moving fractional
counters and the event helper's byte argument to indirect internal RAM resolved
the linker constraints without changing existing allocations. Compiled cost is
60 flash bytes. Counters add four persistent RAM bytes; compiler argument/bit
allocation also changes the reported areas above.

Validation includes all host firmware suites for both geometries, real main-loop
tests around fine-clock boundaries and maximum duration, independent resets,
fractional carry, skipped ticks, clock wrap, and existing resume/consume behavior.
Build artifacts and maps: `/private/tmp/macropad-v8-builds/timed-idata-param/`.
