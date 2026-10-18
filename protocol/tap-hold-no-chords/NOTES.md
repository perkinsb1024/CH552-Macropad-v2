# Mutually Exclusive Chords and Tap-Hold Experiment

Measured October 18, 2026 on `experiment/v18-additional-features`, baseline
`9ae495d84266b64a8357c918fca27b674b7cf816`. This is an informational experiment:
active firmware, configuration format references, editor, uploader, release files
and frozen archives are unchanged. There was no flashing, hardware validation,
release generation, commit or publication. Measurements use isolated snapshots
under `/private/tmp/macropad-tap-hold-no-chords/`.

## Result

Removing chord support provides ample flash for full independent tap-hold.
Removing chords alone saves 928 bytes on each geometry. A complete hold build
with per-binding configurable thresholds, a compiler selector and a validated
profile-mode bit is 452 bytes smaller than the current firmware. Reusing the
header threshold/count fields makes it 490 bytes smaller. Neither requires the
previous 70-byte-stack placement compromises or a fixed threshold.

| Build | Flash Six/Three | Delta from Current | Free Six/Three | Stack Six/Three |
| --- | ---: | ---: | ---: | ---: |
| Current firmware | 14205/14201 | 0 | 131/135 | 102/105 |
| Chords removed, no tap-hold | 13277/13273 | -928 | 1059/1063 | 113/116 |
| Checked selectable chord build | 14221/14217 | +16 | 115/119 | 101/104 |
| Independent holds, per-binding thresholds | 13753/13749 | -452 | 583/587 | 110/113 |
| Independent holds, shared threshold | 13759/13755 | -446 | 577/581 | 110/113 |
| Independent holds, shared threshold and header pair count | 13715/13711 | -490 | 621/625 | 110/113 |

The last row is the compact header-reuse option, not an adoption decision. The
per-binding threshold option also fits comfortably, so choosing a single global
threshold is unnecessary for flash fit. The final hold build is 506 bytes smaller
than its checked chord counterpart. Both are compiled from identical firmware
source with only `CONFIG_ALTERNATE_HOLDS=0` or `1` changed in build flags.
`unified-chords` and `selectable-chords` produce identical HEX hashes.

All measurements use real 14336-byte links and pass native RAM/page-zero,
absolute active-image, startup-clearing and USB interrupt parameter checks.
No relaxed diagnostic code limit was needed. Toolchain is CH55xDuino 0.0.25,
SDCC 4.2.2 build.13407_4, 24MHz, normal size settings and callee-save list.
Color preview and all existing non-chord features remain compiled in.

The hold builds increase stack reserve by eight bytes relative to the measured
baseline, to 110/113. The checked chord build reduces it by one byte to 101/104;
that cost is explicit, though still above the project reference of 90/93.
These are linker reserves, not runtime high-water measurements. Hold builds use
PSEG 98, XSEG 420/405, USB DMA 148 and absolute active-image/runtime timer 134,
for total external allocation 800/785 versus baseline 794/785. No debounce or
hold timestamp arrays were moved into internal RAM to obtain these results.

## Compiler Selection and Experimental Encoding

`CONFIG_ALTERNATE_HOLDS` accepts exactly 0 or 1. Zero compiles the existing chord
implementation; one compiles independent tap-hold and omits chord matching,
pair indexing, chord validation, partner state, pending-single state and related
telemetry. The experiment's hold snapshots add the flag to `platformio.ini`.
The chord snapshot changes it to zero. Both modes include the same mode check.

The saved header remains nine bytes. Byte 3 bit 0, previously reserved, identifies
the alternate method: zero for chords, one for holds. Both validators reject
the opposite mode even after its CRC is recomputed. The pool length remains in
bits 1–7. Other header fields and CRC coverage retain their existing roles.
The hold mode reports no pending chord and no chord-partner telemetry.

The `independent` snapshot preserves the earlier wrapper encoding. A physical
binding has type F in its low nibble, a 0–15 threshold selector in its high nibble
and an absolute pair pointer in its second byte. Threshold is
`(selector + 1) * 32ms` (32–512ms). After strings, before macros, a counted prefix
and four-byte tap/hold records cost zero bytes when unused or `1 + 4 * pairs`
when used. Chord-count header bits must be zero in this snapshot.

The `shared` snapshot uses the same prefix/records but takes the threshold from
byte 5 bits 0–2, previously the chord window. Threshold is
`(selector + 2) * 64ms` (128–576ms); exact millisecond comparisons and wraparound
behavior remain. The wrapper's high nibble is ignored in this option. Reusing
these bits does not change transparency, rainbow phase or rainbow speed fields.
The global threshold costs six more flash bytes than per-binding selection in
this measured implementation; it is useful for header reuse, not a flash saving.

The final `header-count` snapshot additionally reuses byte 4 bits 3–7 as the pair
count (0–31) instead of chord count. Bits 0–2 still count user timers. Four-byte
pairs follow strings directly, without a prefix. This saves one DataFlash byte
when holds are used and 44 flash bytes versus `shared`. All records, including
unreferenced records, validate; pointers must address aligned record starts.
Metadata plus strings is at most 128 bytes before adding the block; four times
the five-bit count is at most 124. Their byte sum is at most 252 and cannot wrap
before the final 128-byte bounds check. The 128-byte profile capacity remains.

Each pair contains an ordinary two-byte tap action followed by a two-byte hold
action. The tap branch uses the earlier non-hold action rules and may invoke a
macro. The hold branch supports ordinary actions and physical keyboard, mouse,
consumer and layer holds. Recursive wrappers are invalid. Encoder rotation,
timer expiry/resume actions and macro steps cannot invoke tap-hold. Physical
keys and the encoder button can; all may wait independently and simultaneously.
Pair records can be shared across bindings and layers. A new distinct pair costs
four additional profile bytes; strings and macros retain their separate costs.
This trade therefore does not solve the DataFlash action-capacity limit.

The version byte remains 18 solely for these experimental fixtures. This is not
an adopted production-compatible v18 extension. Capability discovery for the
alternate method, production versioning, configurator choices, migration,
archives and packaging remain adoption work. The action mask is `0x7FFF` in
chord mode and `0xFFFF` in hold mode. The header flag guards saved profiles, but
does not by itself provide editor discovery of the flashed build's mode.

## Full Independent Hold Behavior

Each accepted debounced physical press captures its binding and exact 16-bit
timestamp. Duplicate presses do not restart the clock. Another key or encoder
rotation does not promote it early. Release below the threshold selects tap;
release exactly at or above it selects hold, including without an intervening
poll. Selection executes once, suppresses the other branch and retains existing
physical-hold release and USB backpressure handling.

Expired decisions run before scanning new inputs and before output backpressure.
A held momentary layer therefore affects another input accepted on its deadline.
Pending assignments survive unrelated layer changes. One-shots are consumed when
the chosen action executes; another input may consume the one-shot first.
Reset, profile application and the normal sleep/wake consumption rules apply.
Runtime state never writes DataFlash. No single-pending/interruption variant is
used in any measured hold build.

## Validation and Limits

The final header-count and per-binding builds pass strict ASan/UBSan focused
tests on both boards. Header-count covers 238955/237579 counted cases plus
112/106 real-scanner cases. Per-binding covers 238880/237474 plus 112/106 scanner
cases. Coverage includes every two-byte action in each branch context, all
threshold selectors, exact/adjacent releases, clock wrap, 1000 concurrent-input
model traces per board, all physical inputs pending and held together, shared
pairs, count/capacity boundaries, recursion, CRC and mode rejection, layer changes,
one-shots, strings/macros, USB backpressure, reset, wake and all five timer consume
masks. The final chord build passes the complete existing normal host runner,
including eight build-layout and nineteen mocked bootloader tests.

Hold snapshots also pass existing action, protocol, modified consumer hold,
layer, macro, timer/capacity and USB regressions with sanitizers, and normal input,
sleep, live-state and palette regressions (508064 compared frames per board).
Functions that assume chord behavior are omitted in hold mode and listed exactly
in each validation JSON; some are mixed tests, so this is a targeted regression
run, not a claim that every preexisting non-chord assertion ran. The original
action suite intentionally injects both geometries and normally runs once with
seven-entry storage. It was run that way; forcing its six-key fixtures through a
four-entry build produces a host-only bounds failure, saved separately. Dedicated
three-key hold/scanner and other geometry-specific suites use four-entry builds.

An exploratory attempt to sanitize the entire old input suite stops at the
existing LED effect-restore signed left shift of -1 in the sketch. The unchanged
baseline reproduces the same UBSan failure. Both the original attempt and baseline
reproduction are saved. Normal old input/renderer regressions and strict new
feature/scanner sanitizers pass; the unrelated LED expression was not changed.
No hardware validation or runtime stack high-water measurements were performed.
Configurator, uploader and site gates were not run because their active inputs
were unchanged. These are feasibility results, not a release validation claim.

## Saved Work and Reproduction

The [complete native ledger](candidate-table.md), `results.json`, per-build memory
reports and firmware/HEX hashes preserve all seven measured source candidates
on both boards. `header-count.patch` and `independent.patch` each contain the
complete selectable implementation; do not stack them. Apply the corresponding
`*-tests.patch` for adapted fixtures and tests. For chords, use
`unified-chords.patch` with `chords-tests.patch`. The firmware differs only by
the build flag between `header-count` and `unified-chords`.

Each final pair has a tested source archive and checksum. `reapplication.json`
checks exact firmware and test reconstruction against the recorded baseline.
`active-firmware-unchanged.json` verifies active source equality. Native maps,
assembly and temporary binaries remain in the temporary directory. All changes
and tradeoffs are also recorded in the Git-excluded optimization notebook.

From the named baseline in a clean checkout, the drivers reproduce snapshots:

```sh
python3 protocol/tap-hold-no-chords/measure.py
python3 protocol/tap-hold-no-chords/measure.py unified-chords
python3 protocol/tap-hold-no-chords/validate.py header-count
python3 protocol/tap-hold-no-chords/validate.py independent
python3 protocol/tap-hold-no-chords/validate.py chords
python3 protocol/tap-hold-no-chords/finalize.py
```

Measurement preparation refuses to overwrite existing source snapshots. Move
old temporary snapshots aside before reproducing. Validation retains older test
copies under timestamped names. Drivers depend on the preserved prior tap-hold
investigation and alternative test harnesses. Verify the baseline before use;
remeasure after porting because SDCC layout and byte costs are source-dependent.
