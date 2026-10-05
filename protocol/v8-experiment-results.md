# V8 firmware experiments

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
