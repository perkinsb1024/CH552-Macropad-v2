# Chord Optimization Pass

Measured October 18, 2026 on `experiment/v18-additional-features`, baseline
`be43c89ec56a0832f2334d44f90b4f1cfcb83eca`. The baseline firmware matches the
earlier tap-hold experiment's 14205/14201-byte binaries exactly.
The selected optimization is applied to active firmware and tests, uncommitted.
README and current format memory figures are updated. No format, configurator
behavior, release file or frozen editor changes were needed. No commits,
hardware flashing, hardware validation, release generation or publication occurred.

## Result

| Measurement (Bytes) | Six Keys Before | Six Keys After | Three Keys Before | Three Keys After |
| --- | ---: | ---: | ---: | ---: |
| Flash used | 14205 | 13951 | 14201 | 13932 |
| Flash free | 131 | 385 | 135 | 404 |
| Flash saved | 0 | 254 | 0 | 269 |
| Linker stack reserve | 102 | 105 | 105 | 108 |
| Paged external RAM | 108 | 102 | 108 | 102 |
| Ordinary XSEG | 404 | 404 | 395 | 395 |
| Total external allocation | 794 | 788 | 785 | 779 |

The pass preserves all features and current chord behavior. Timing remains exact
16-bit elapsed milliseconds, with the same 20–90ms windows and wraparound rules.
Local/global precedence, multiple disjoint chords, first-member hold release,
retrigger lock until both members are up, one-shots, layers, encoder interactions,
USB backpressure, macros, timers, sleep and live telemetry remain intact.
The 128-byte profile, sorted three-byte chord records, CRC16 and color preview
are unchanged. There are no new saved bytes or runtime queues/caches.

Fifty-seven candidates have 114 native geometry measurements. These include the
unchanged baseline and a final chord-removal control, not 57 adopted changes.
All native builds pass the real 14336-byte application limit and memory/layout
checks. Only the selected and explicitly listed intermediate candidates received
the full behavioral/sanitizer validation; a successful size link alone is not a
correctness claim. The [complete ledger](candidate-table.md) records every probe,
parent, flash delta, RAM/stack measurement and rejected approach.

## What the Earlier 928 Bytes Included

The earlier feature-removal comparison is a marginal firmware size measurement,
not the size of the matching function alone. Linked object CSEG differences are
556 bytes in `actions.c` and 372 in `config.c` on each board. The action portion
includes participation checks, recognition, deferred singles, release/locking,
layer/one-shot interaction, initialization and partner telemetry. Configuration
includes the matcher, pair indexing, window getter, validation and table offsets.
Sketch, protocol and constant-table sizes did not change in that comparison.
`removal-breakdown.json` preserves the measured object totals.

Some selected changes also help input handling without chords. Repeating the
removal control with the same generic input optimizations gives 13238/13231-byte
firmware, versus the old 13277/13273. Therefore 39/42 bytes of the total 254/269
saving are shared input improvements. The remaining measured chord cost is
713/701 bytes, down from 928: a chord-specific reduction of 215/227 bytes.
The control rejects chord-bearing profiles and is diagnostic only; it is not
the active build. Do not subtract all 254/269 from 928 to infer the new marginal
feature cost. These values are measured, not additive size estimates.

## Selected Changes

- Replace repeated pair-by-pair participation queries with one scan. A query mask
  with one physical-input bit asks whether that input can form a chord on the
  layer. Two bits ask for the exact pair. The same scan handles both cases.
- Return the matching action's image offset. This removes four old parameter
  stores and no longer copies action bytes on unsuccessful participation scans.
  A tiny ROM table maps saved lexicographic pair IDs to complemented key masks
  (15 bytes on six keys, three on three keys). An excluded-bit test handles both
  kinds of query without sorting keys or triangular pair arithmetic.
- Keep decoded scope and ROM indices byte-sized, with a zero-count fast return
  and a decrement loop. Sorted records retain local-before-global priority.
- Share ordinary/chord dispatch after selecting the owning input. Retain input
  ordering, constituent clearing and the existing layer recomputation point.
- Calculate an accepted input's mask once. Four/seven-byte ROM input-bit tables
  replace repeated variable shifts in press, recognition and release paths.
- Narrow the pending-input release comparison only after the physical range
  guard proves `input + 1` is in 1–7. No time arithmetic is narrowed.
- Replace the obsolete paged release-mask scratch byte with a local mask and
  merge partner initialization into the existing input-state initialization loop.
- Move five frequently accessed bytes (physical-down mask and pending input,
  layer and exact timestamp) from paged RAM into direct internal RAM. Smaller
  lookup parameter/overlay storage first frees enough capacity that this still
  increases final stack reserve by three bytes against baseline.

ROM masks rely on the existing validator's legal pair IDs and fixed three/six-key
geometry. `configChordOffset` is an internal API requiring a validated active
image, a valid layer and one or two nonzero physical input bits. Press range
checks precede table indexing; pending input/layer are captured under those
invariants. Old defensive lookup tests use a fixture adapter to retain their
original assertions; the new production API also has independent direct tests.
Future callers must honor the documented contract.

The smaller local-only option (`local-selected`) saves 100 bytes on each board
without changing the old lookup API. It preserves baseline RAM/stack. It is
saved and validated as a simpler alternative, but the selected scan provides
another 154/169 bytes plus better stack/RAM and avoids repeated runtime scans.
Runtime latency was not benchmarked; reduced scans/variable shifts are identified
from the source and generated assembly rather than claimed elapsed-time results.

## Rejected and Unselected Attempts

The ledger preserves zero/negative results instead of assuming an attractive
rewrite must save bytes. Row-base tables, a pair-oriented offset API, separate
nibble matching, alternate validator expressions, shared timing helpers, cached
physical-input bits, partner-release assignment tricks and broad callee-saves
changes mostly grew flash or saved less. Moving partner state internally saved
no flash and reduced stack by six bytes. Indirect internal pending state saved
only six bytes while consuming four stack bytes in its original comparison.
Those placements are not used. Direct pending-state storage after the smaller
API has a different measured result and still exceeds baseline stack capacity.

Exact split high/low elapsed comparisons were measured without reducing precision,
but did not improve flash. The original 16-bit timing expressions remain.
The selected original validation rules are untouched; validator rewrites did not
offer a worthwhile saving. Callee-save changes added 66–68 bytes in the measured
lookup combinations. Source-dependent register/overlay effects mean component
savings must not be assumed additive or portable to another compiler/source.

## Validation

Both final native builds use CH55xDuino 0.0.25 / SDCC 4.2.2 build.13407_4,
24MHz, the existing small-model size flags and callee-save list, USB DMA 148
and the real 14336-byte code limit. Page-zero, external/absolute RAM, startup
clearing and interrupt-parameter checks pass. Fresh active-source HEX hashes
are identical to the tested final candidate. Stack figures are linker reserves;
runtime high-water and hardware validation were not performed.

The final independent ASan/UBSan audit passes 1906778/2140336 counted checks and
event states. It tests every chord identifier and every two-identifier ordering
for all layer counts and both geometries, independent pair-membership/priority
oracles, custom palette offsets, and 1600 deterministic 700-event traces per board
plus output draining. Trace hashes match the unchanged baseline exactly, including
155480/149666 accepted USB reports, button/partner/pending state, layer/one-shot
selection, timers, live telemetry, drops, transport stalls, generation changes,
resets, wraparound and ordinary action families. Final hashes:
`8844a138149fad66` / `809cab1d46b26dba`.

The complete active normal host runner passes, including the existing chord
threshold/release/lock, layer, one-shot, macro, held consumer/mouse, timer, real
scanner, sleep, USB and telemetry regressions; 508064 palette frames per board;
eight layout and nineteen mocked bootloader tests. No existing test functions
were omitted. New permanent direct lookup tests add 519750/15120 cases covering
singleton/exact queries, every pair, all local scopes, global precedence and
palette-shifted record starts, including a six-key image ending at byte 128.

The final `npm run verify:deploy` gate passes on baseline `be43c89` plus the
uncommitted implementation/tests and memory documentation:

- Firmware: both real-limit native builds, full host runner and matching final
  differential/sanitizer source hashes pass.
- Configurator: complete Vitest suite passes, including firmware agreement tests.
- Uploader: build and all 95 tests pass against current README/release inputs.
- Complete site: TypeScript and production build pass; all 16 frozen archive
  manifests verify. The gate rebuilds the preview output and bundled uploader.

Release files remain unchanged. `active-validation.json` records source and HEX
hashes and the uncommitted tested-tree status. This is not a hardware-validated
release or a claim that tap-hold plus chords now fits; that composition was not
implemented or measured in this task.

## Reproduction and Saved Work

All candidate patches are relative to baseline `be43c89`, not incremental.
Apply `final.patch` and `final-tests.patch` once to that baseline to recreate the
selected implementation. `local-selected` is an alternative, not an addition.
All 57 firmware/fixture patch replays are checked exactly. Final and local-only
tested source archives, memory reports, source/HEX checksums, validation results,
the candidate ledger and reproduction drivers are preserved here. Native maps,
assembly and temporary binaries remain in `/private/tmp/macropad-chord-optimization/`.
The Git-excluded optimization notebook preserves this pass and every parent delta.

Run the drivers from the named original baseline; they deliberately refuse to
overwrite measurement snapshots. The default measurement list contains the first
round; pass later ledger candidate names explicitly. Before `final`, measure
`data-all-init`; before comparisons, measure `baseline`. The final driver also
depends on the existing tap-hold investigation's native builder helpers and the
previous no-chord patch for the diagnostic control.

```sh
python3 protocol/chord-optimization/measure.py
python3 protocol/chord-optimization/measure.py data-all-init final optimized-no-chords
python3 protocol/chord-optimization/validate.py baseline final
```

For ordinary use, build the active source with the standard project native
builder and run the host/deployment gates. No format migration, editor archive,
release generation or hardware flashing is required to apply the optimization.
