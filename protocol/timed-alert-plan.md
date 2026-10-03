# Timed wake consumption and temporary LED effects

Baseline: `168fbca`, four timers, 14,231 / 14,227 flash bytes (six/three keys).
The existing investigation notes are local in `toInvestigate.md`.

## Preservation

Keep baseline on `experiment/timed-actions`; checkpoint wake consumption on
`experiment/timed-wake-consume`, then retain combined work on a separate branch.
Keep size probes and source snapshots in temporary build directories. Commit
only the investigation changes, firmware, and tests; preserve release files.

## Investigation and implementation

1. Rebuild both variants and record flash, page-zero allocation, and stack size.
2. Compare two consume-wake encodings without restricting resume actions:
   six interval bits plus inline consume/reset flags (1–64 ticks), versus
   retaining 1–128 ticks with one shared four-bit mask in byte 127. Both keep
   five-byte timer records; the latter reserves one profile byte in total.
   Retain compatibility with existing v6/v7 images through an experimental
   format bump (distinct versions identify the alternative layouts).
3. Resume all armed timers once, aggregate their consume flags, and suppress one
   physical key/encoder event if any requests consumption. Avoid creating held
   actions/chords from a consumed key; still debounce and release it normally.
   Preserve software bootloader entry and existing non-consuming behavior.
4. Test no-resume consumption, multiple timers, holds/chords, encoder detents,
   input/timer collisions, and optional reset behavior. Build both variants and
   checkpoint the complete implementation before pursuing the LED effect.
5. Add compact LED commands for restoring normal indication, bright always-on
   colors/rainbow, and 1–8 blinks. Reuse indication options and the existing
   phases/deadline. Preserve existing key-feedback priorities. Define restore
   as removing the overlay and revealing existing brightness policies.
6. Test all colors/modes, exact blink completion, animation on non-rainbow layers,
   replacement, actual layer-switch cancellation, config reset, and resume.
7. Measure initial/optimized/combined costs on both variants. Inspect SDCC output
   for expensive addressing, duplicated branches, and unnecessary helpers.
   Preserve measured checkpoints before changing implementation strategies.
8. Run relevant firmware regressions and actual constrained builds. Document
   final encoding, behavior, flash/RAM/stack costs, optimizations, limitations,
   and branch/commit checkpoints. Web editing/migration is a separate follow-up.
