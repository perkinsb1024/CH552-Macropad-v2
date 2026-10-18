Branch `experiment/v18-additional-features`, baseline/source commit
`be43c89ec56a0832f2334d44f90b4f1cfcb83eca`. Status: selected optimization applied
to active source/tests and README/spec memory figures, uncommitted. User requested
a thorough chord optimization pass after the no-chord comparison. No feature,
format, CRC, preview or precision cuts. No result commits, release generation,
flashing, hardware validation or publication.

All57candidates/114native measurements, patches, source/HEX hashes, mem reports,
parent-relative ledger, exact replay checks, final/local-only source archives and
validation live in `protocol/chord-optimization/`. Full rationale/dependencies:
NOTES.md and measure.py. Native maps/assembly/binaries:
`/private/tmp/macropad-chord-optimization/`. The complete ledger follows this entry
and records every measured candidate, including zero/negative and rejected probes.
All links use the real14336 limit, CH55xDuino0.0.25/SDCCbuild.13407_4, existing flags,
24MHz,USB148,preview. No relaxed links or failed RAM layouts in this pass.

Measured final flash13951/13932, saves254/269vs14205/14201; free385/404.
Stack105/108vs102/105(+3each),PSEG102vs108(-6),XSEG404/395unchanged,
absolute134unchanged,totalexternal788/779vs794/785(-6each). Current source
matches tested final files; fresh active HEX matches final candidate hashes.
Six/three ordering throughout. These are linker reserves, not high-water figures.

Selected src/config.c,h and src/actions.c changes: one mask-based scan replaces
per-partner eligibility calls and pair sorting/arithmetic; singleton asks any
participation, two bits asks exact pair. Return an action offset, using3/15ROM
bytes of complemented lexicographic pair masks. Narrow scope/index temporaries,
early count0 return/decrement loop. Share dispatch, cache accepted input mask,
replace repeated variable shifts with4/7ROM input bits, byte-bound pending release
comparison, use local release scratch and merge partner initialization. Move
inputDown plus pending input/layer/timestamp5bytes from pdata to direct data;
smaller API/overlay allocation frees8stackbytes before this placement consumes5,
leaving3more than baseline. Remove obsolete timedWork1paged byte. No new buffers.

Bounds/dependencies: header9,image128,layers5/7,physicalkeys6/3,validated pair IDs
0..14/0..2 and scope0..6/global7. New configChordOffset requires valid active image,
layer,nonzero one/two physical input bits. Callers range-check input before ROM
index; pending layer/input were captured under those checks. Release input+1<=7;
only that comparison is narrowed. Exact16-bit now-pendingSince arithmetic remains.
Shared dispatch retains owner ordering, constituent clearing, release/backpressure,
both-member retrigger lock, layer/one-shot/encoder and telemetry semantics. Sorted
records preserve local-before-global. Main application needs no format/editor
transition. Test fixture adapts old defensive lookup assertions to the new internal
API; permanent direct production lookup tests also run. Remeasure on another
parent/toolchain; direct/overlay storage is compiler-source dependent.

Important cost attribution: original chord removal saves928each (actions556,
config372, sketch/protocol0). Final removal with common input optimizations gives
13238/13231, so39/42of total254/269saving also applies without chords. Remaining
chord marginalcost713/701, reduction215/227from928. Do not infer674/659by merely
subtracting total savings. The optimized-no-chords control is diagnostic only,
rejects chord profiles and is not adopted. No tap-hold composition was measured.

Rejected/unselected detail is in the complete ledger: pair row-base table, pair-
offset API, alternate validators, generic timing helpers/split exact comparisons,
physical-bit caching, partner release/link tweaks and callee-save expansions
mostly grow code or save less. Callee-save trials add66–68bytes. Partner idata
placement saves0andloses6stack; initial pending idata placement saves6/loses4stack.
Direct pending state in the smaller final API is a distinct measured layout.
Local-only fallback local-selected saves100each with unchanged baseline RAM/stack,
and is fully validated/preserved separately. Final was chosen for additional
154/169saving and better RAM/stack, with simpler runtime participation scans.

Validation: final complete normal host runner passes with no omitted functions,
including palette508064frames/board,8layout and19mockedbootloaderchecks. New
permanent direct lookup cases519750/15120. Final strict ASan/UBSan independent
identifier/order/membership oracle plus1600x700-event+drain traces/board covers
1906778/2140336checks/eventstates and155480/149666USBreports; hashes exactly match
unchanged baseline8844a138149fad66/809cab1d46b26dba. Covers all IDs/two-ID orderings,
layers,palettes,scope/priority,holds,wrap,one-shots,layers,backpressure,generation,
reset,timers,macros,telemetry,drops and action families. Intermediate mask-combined,
local-combined,mask-narrow,local-selected,mask-compact-do,compact-bit-table and
data-all-init also pass focused differential sanitizers and full normal runner.
Other probes have native size/layout evidence only, not full behavioral claims.

Final npm run verify:deploy passes against be43c89 plus uncommitted firmware/tests/
memorydocs: complete configurator suite,95uploader tests,TypeScript,production
sitebuild,16frozenarchives. Firmware/native,configurator,uploader and site checks
are distinguished in active-validation.json/NOTES.md. No hardware/high-water
validation claim. Release files and frozen editors unchanged. Independent port:
apply final.patch+final-tests.patch to recordedbaseline, or port the selected
local code with its documented bounds. Do not stack baseline-relative candidate
patches. Replay/build/host/sanitizer/deployment checks are required after porting.

