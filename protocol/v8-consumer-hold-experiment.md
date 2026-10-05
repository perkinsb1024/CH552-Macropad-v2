# Consumer Hold experiment

Branch: `experiment/v8-consumer-hold`, independently based on `196e81e`.
The standalone milestone records firmware implementation. The final combined
build and v8 configurator/migration are now on `experiment/v8-merged`; see
[format v8](config-v8.md). Existing checked-in releases are untouched.

| Build | Six-key flash | Three-key flash | Free (6/3 key) |
| --- | ---: | ---: | ---: |
| Baseline | 14,263 | 14,259 | 73 / 77 |
| Initial linked implementation | 14,355 | 14,353 | -19 / -17 |
| v8-only validation/accessors | 14,281 | 14,279 | 55 / 57 |
| Including USB reset reassertion | 14,307 | 14,305 | 29 / 31 |

Final net flash cost: **44 / 46 bytes**, including the action-map change,
validation, arbitration, release handling, and USB reset support. Dropping legacy
firmware format checks saves 74 bytes; firmware accepts only v8 to prevent old
Type Text records being interpreted as Consumer Hold. Legacy migration must
happen in the configurator, not flash storage. This optimization preserves v8
validation and never skips CRC/bounds checks.

RAM areas: PSEG 108 bytes; XSEG 526 / 517 bytes; DSEG 127 / 127 bytes;
ISEG 12 / 9 bytes; BSEG 28 bits; stack reserve 116 / 119 bytes. Consumer state
adds three persistent indirect-RAM bytes. A poll-loop index also moves from a
register/direct spill to indirect RAM. Page-zero external RAM remains full but
does not grow. These are linked allocation figures, not runtime stack profiling.

Encoding: Type Text is first byte `0x10` with its original string-pool offset;
None stays `00 00`; Consumer Tap is type `0x8`; Consumer Hold type `0x9`.
Both consumers retain the full nonzero 12-bit usage range. Reserved None auxiliary
values reject, as do Consumer Holds on rotation or either timed-action binding.

Selected authorized compact behavior: most recent consumer action wins and
previous holds are **not restored**, consistently for both hold-over-hold and
tap-over-hold. Consumers use a shared pending-output lane so older queued taps
cannot later override a newer hold. A tap interrupts an active hold with a
release/press edge, and releases afterward. Already accepted USB reports preserve
their queue order; input arriving before assertion can supersede pending usage.

Keyboard and consumer holds retain original bindings through layer transitions.
Either chord member releases a chord hold. Short presses retain assertion until
accepted and retry release under pressure. USB report-generation changes reassert
the current hold; configuration clearing releases all consumer output. Host
repeat behavior is not replaced by firmware tap repetition.

Validation: all host firmware suites pass for both hardware geometries. Added
tests cover all 4,095 usages, rotation/timer rejection, reserved None auxiliary
values, legacy version rejection, short presses, backpressure, same-usage taps,
overlap/release ownership, no restoration, chords, layers, reset, and USB
generation changes. Both SDCC builds pass memory-layout checks.

Temporary diagnostic artifacts: `/private/tmp/macropad-v8-builds/consumer-final/`.
No hardware flashing or host repeat-behavior check has been performed.
