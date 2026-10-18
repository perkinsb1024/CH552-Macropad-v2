# Five-Timer and Chord-Scope Measurements

Measured October 17, 2026, on `experiment/v18-more-timed-actions`, from clean
baseline `38724fbb23480c5e782a1ad33a22a83145bd9ff0`.
Scope: isolated flash/RAM experiments. The active firmware, configurator,
format version and release artifacts are unchanged. Patches retain version 17
only for measurement; they are not compatible production firmware upgrades.

## Results

All figures are measured bytes using CH55xDuino 0.0.25, SDCC build.13407_4,
the existing flags, 24MHz, USB148 and the normal feature set.
The application limit is 14,336 bytes. Negative free space means the candidate
does not fit. Six-key and three-key values appear in that order.

| Candidate | Flash Six/Three | Change from Baseline | Free Six/Three | Stack Reserve Six/Three |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 14,329 / 14,325 | 0 / 0 | 7 / 11 | 103 / 106 |
| Five Timers, Existing Wide Validation | 14,355 / 14,351 | +26 / +26 | -19 / -15 | 99 / 102 |
| Global Chord Scope 7 Only | 14,305 / 14,301 | -24 / -24 | 31 / 35 | 104 / 107 |
| Global Chord Scope 0 Only | 14,307 / 14,303 | -22 / -22 | 29 / 33 | 104 / 107 |
| Five Timers and Global Chord Scope 7 | 14,331 / 14,327 | +2 / +2 | 5 / 9 | 100 / 103 |
| Five Timers and Global Chord Scope 0 | 14,333 / 14,329 | +4 / +4 | 3 / 7 | 100 / 103 |
| Five Timers with Narrow Validation | 14,323 / 14,319 | -6 / -6 | 13 / 17 | 101 / 104 |
| Five Timers with Narrow Validation and Global Chord Scope 7 | 14,299 / 14,295 | -30 / -30 | 37 / 41 | 102 / 105 |

Five timers consume the last paged byte: PSEG increases from 107 to 108 bytes
and ends at `0xFF`. Ordinary XSEG remains 404/395 bytes, although its start shifts
from `0x113` to `0x114`. Total external allocation increases from 793/784 to
794/785 bytes. The two internal counter arrays grow by one byte each.
No state is relocated. The absolute active image/runtime record remains 134
bytes. A fifth configured timer consumes six more bytes of the existing
128-byte saved profile. Stack figures are linker capacities, not high-water
measurements; the preferred combined candidate loses one byte versus baseline.

## Five-Timer Changes

`five.patch` raises `CONFIG_TIMED_MAX` to 5, serializes six runtime slots
(five user timers plus **Auto-Sleep**) in a 20-byte timer reply, moves its CRC
to bytes 18–19 and moves the macro-step source from 14 to 15 to avoid the new
sleep source. It also updates the affected host tests. The timer loops already
use the configured count. No packet buffer, queue or image size is increased.

The initial flash cost comes from the pre-existing wide metadata validation
fallback for timer limits above four. `five-narrow.patch` instead groups the
calculation into two independently byte-bounded terms:

```text
records = 9 + layerSize * layerCount + 3 * chordCount + 6 * timerCount
poolAndPalettes = poolLength + paletteBytes
end = uint16(records) + uint16(poolAndPalettes)
```

After the existing geometry/count checks, records are at most 242 bytes and
pool plus palettes at most 142 bytes. Both terms can be narrowed independently;
their sum remains 16-bit and must be at most 128. The maximum fixed term on
three keys is 237. The wide fallback remains for limits above five.
This saves 32 flash bytes and recovers two stack bytes relative to the initial
five-timer candidate, with no validation or behavior removed. Its independent
effect on the four-timer baseline has not been measured.

## Chord Encodings

`chord-seven.patch` uses scope 7 for global chords and zero-based scopes 0–6
for local layers. Bit 7 is reserved and rejected. Pair IDs, record sizes,
ascending identifier order and local-over-global precedence remain intact.
Global lookup becomes an exact byte comparison rather than a masked comparison.
The validator accepts global scope independently of the configured layer count.
This saves 24 flash bytes and one byte of internal compiler storage per board.

`chord-zero.patch` uses scope 0 for globals and scopes 1–7 for local layers.
Its validator orders identifiers by the byte value `id - 16`, keeping local
chords before global chords. Local lookup adds one to the layer index.
It saves 22 bytes, two fewer than the scope-7 encoding.

The initial scope-0 probe omitted the ordering adjustment and appeared to save
32 bytes. It was rejected: numeric sorting with globals first would change
local-over-global precedence. Its temporary source remains in the earliest
artifact tree recorded in `results.json`; final measurements and patches use
the corrected ordering. No behavior degradation was adopted.

Both encodings require a new configuration format and corresponding editor
changes before adoption. Neither reuses bit 7 for a new feature.

## Validation and Reproduction

`results.json` records every final candidate, source revision, artifact path,
HEX checksum and memory totals. `source-hashes.json`, the patches and `memory/`
preserve the measured sources and reports. No release generation or flashing
was performed.

The baseline was built at the real limit. Other initial probes used a 16,384-byte
diagnostic limit to measure overflows while retaining the normal RAM/layout
checks. Both narrow-validation candidates were subsequently rebuilt for both
boards at the real 14,336-byte limit. All four passed the builder's paged,
external, absolute-image, startup and interrupt-parameter checks; their HEX
files exactly match the diagnostic builds.

The complete normal host runner passes on both the initial five-timer source
and the five-timer narrow-validation source, including configuration, dispatcher,
protocol, USB, macros, timers, real input/sleep/live telemetry, per-key palettes,
8 layout tests and 19 bootloader tests.

AddressSanitizer/UndefinedBehaviorSanitizer checks pass for five timers with
narrow validation, its scope-7 combination and the corrected scope-0 combination.
Each compares 2,400 valid profiles and 308,000 chord lookups against a separately
compiled baseline implementation. Bounds checks cover 393,216 metadata cases
(layers, timers, chords and pool lengths); the chord variants additionally test
all 256 identifiers at every layer count, for 396,288 total bounds cases.
Separate regressions pass on both hardware geometries for five independent
timers, pending input actions, **Auto-Sleep** in the sixth slot and distinct
macro telemetry identity.

The combined chord candidates have focused differential/sanitizer coverage,
not a complete port of all old binary chord fixtures or configurator tests.
This is a feasibility experiment, not a validated release or deployment.
Configurator, uploader and complete-site gates were not run because no active
deployment input changed. Hardware behavior has not been tested.

From the baseline checkout, reproduce temporary probes with:

```sh
python3 protocol/five-timer-chord-probes/measure.py
python3 protocol/five-timer-chord-probes/validate.py /path/to/candidate/source
```

Run the normal `tests/run_host_tests.py` from a timer-only candidate source tree.
The scope-7 patch can be applied independently of the timer change. The narrow
arithmetic requires the stated header/count/geometry bounds; remeasure on other
sources or compilers rather than assuming the same savings. Adopting any timer
or chord format change also requires freezing v17, updating the active editor,
version routing, telemetry parsing and documentation, then running the normal
firmware and complete-site gates.
