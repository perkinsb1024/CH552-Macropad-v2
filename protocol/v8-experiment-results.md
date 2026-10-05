# V8 firmware experiments

## Combined implementation

Branch: `experiment/v8-merged`. This build enables timed-action precision,
**Consumer Hold**, held scrolling and 1–16 mouse clicks. Acceleration is disabled in this branch. Color
preview and all existing lighting behavior are preserved.

| Build | Six-key flash | Three-key flash | Free (6/3 key) |
| --- | ---: | ---: | ---: |
| Initial combined implementation, acceleration on | 14,879 | 14,875 | -543 / -539 |
| Optimized combined implementation, acceleration on | 14,667 | 14,665 | -331 / -329 |
| Original optimized combined implementation, acceleration off | 14,325 | 14,323 | 11 / 13 |
| Multi-click and 100 ms held scrolling, before final optimization | 14,365 | 14,361 | -29 / -25 |
| Multi-click and 100 ms held scrolling, optimized (current default) | 14,325 | 14,321 | 11 / 15 |

The original combined build adds seven persistent RAM bytes (four timer fractions and
three consumer state bytes). RAM areas are PSEG 108, XSEG 526 / 517, DSEG 127,
ISEG 16 / 13, BSEG 26 bits, stack reserve 112 / 115 bytes. Acceleration adds
six more persistent bytes; its linked ISEG is 23 / 20 and stack reserve 106 / 109.

The current default counts remaining clicks in the auxiliary nibble of the
playback action copy, saving 26 flash bytes and removing the dedicated click
counter. Replacing mouse-button checks with `(uint8_t)(param - 1) < 7` saves
another 14 bytes with the same accepted masks. A separate one-byte internal-RAM
clock gives held scrolling 100 ms between complete steps; pointer repeats retain
8 ms. Current PSEG is 107 bytes, and stack reserve is 111 / 114 bytes. Both
hardware builds and host suites pass.

Optimizations keep action types and stream contexts eight-bit, narrow consumer
ownership comparisons, assemble consumer usages without an intermediate
16-bit right shift, share repeat eligibility, simplify timer clock updates and
keyboard validation, and avoid CRC boolean-conversion overhead. Host suites
pass with acceleration both enabled and disabled. Two USB queue trials were
discarded: direct critical wrappers were rejected by SDCC's nested-critical
rules, and deriving report lengths saved RAM but no flash.

Standalone milestone costs remain recorded below and in the consumer/scroll
experiment reports. Combined costs are not additive because compiler allocation
and shared optimizations change when features are linked together. The combined
build uses its v8 configurator, including binary/JSON/draft migration, Consumer
**Hold** and held-scroll controls, and updated timer ranges. Frozen format-v7 editor
and live-view pages remain available for v7 firmware.
Acceleration testing is isolated to its own experiment branch; that branch's
flashable test build uses 14,235 / 14,231 bytes, with color preview and rainbow
animation disabled. Invalid-config and layer blinking remain. See the
[scroll experiment instructions](v8-scroll-experiment.md).

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
