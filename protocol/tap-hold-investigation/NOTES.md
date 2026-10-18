# Tap-Hold Investigation Notes

Recorded October 18, 2026 on `experiment/v18-additional-features`, baseline
`8b4a164ccf5f904236d9c5c155a61b30e30c18e4`. These are isolated experimental
sources, patches and measurements, not an adopted format or firmware change.
The active firmware, production documentation, configurator, uploader and releases
are unchanged. No commits, release generation, flashing or publication occurred.

## Result

The proposed general-purpose encoding works. No fitting implementation was found
in 26 saved candidates (including baseline), with 52 native variant measurements.
The smallest completed candidate adds 496 flash bytes per pad and reduces linker
stack reserve by four bytes. A second completed candidate preserves all baseline
stack capacity for another 38 flash bytes. Both retain existing features.
The optional-input HID layer command adds exactly 84 bytes to either completed
candidate in a direct combined measurement. Its old baseline-relative patch
needed a header-context adjustment and updates to old test calls of the release
API; combined and incremental patches are preserved here.

| Candidate | Flash Six/Three | Added Flash Six/Three | Over Limit Six/Three | Stack Six/Three | XSEG Six/Three |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 14205/14201 | 0/0 | Fits (131/135 free) | 102/105 | 404/395 |
| `complete-small` | 14701/14697 | 496/496 | 365/361 | 98/101 | 420/405 |
| `complete-stack` | 14739/14735 | 534/534 | 403/399 | 102/105 | 424/409 |
| `complete-small-combined` | 14785/14781 | 580/580 | 449/445 | 98/101 | 420/405 |
| `complete-combined` | 14823/14819 | 618/618 | 487/483 | 102/105 | 424/409 |

The four-byte reduction in `complete-small` is explicit: 98/101 versus the actual
102/105 baseline, although still above the project reference of 90/93.
`complete-stack` preserves the baseline and is the safer starting point when
stack capacity takes priority. These figures describe linker capacity; no runtime
stack high-water or hardware measurements were performed.

Both completed tap-hold implementations keep PSEG at 108, USB DMA at 148 and the
absolute active image/runtime timer at 134 bytes. Total external allocation is
810/795 for `complete-small` (+16/+10) and 814/799 for `complete-stack` (+20/+14),
versus 794/785. Timestamp arrays have seven entries on six-key hardware and four
on three-key hardware. External helper storage explains the remaining bytes;
no saved-image size increase accompanies this runtime RAM allocation.

The application limit is 14336 bytes. The real-limit links fail for every
nonbaseline candidate. Final sizes and RAM/layout checks come from diagnostic
links with a relaxed code limit of 65535, using the same compiler/flags/sources.
Their HEX files are oversized measurement artifacts, not installable firmware.
The final diagnostic links pass page-zero, ordinary/absolute external RAM,
startup-clearing and USB interrupt parameter checks. Early candidates with
internal RAM allocation errors are explicitly marked in the candidate ledger;
their reported stack is not a valid usable reserve.

## Provisional Encoding

This experiment deliberately retains the v18 version byte to run the existing
fixtures. It adds type F and advertises action mask `0xFFFF`. This is not a
production-compatible v18 revision. Adoption requires a deliberate format,
capability, migration and configurator/archive decision, all deferred here.
`CONFIG_ACTION_RESERVED` remains a test-compatibility alias for F in the snapshot;
the old negative tests now check F without a valid pair block, or outside the
prefix position. No production editor can create this extension yet.

The ordinary binding becomes two bytes:

| Byte | Meaning |
| --- | --- |
| 0 | `(thresholdSelector << 4) | 0x0F` |
| 1 | Absolute address of the pair's tap action, not the block prefix |

After all existing metadata and the string pool, before macros, an optional block
has one prefix byte `((pairCount - 1) << 4) | 0x0F`, followed by 1–16 four-byte
pairs. Each pair is the existing two-byte tap action followed by the existing
two-byte hold action. The macro tail starts immediately after these pairs.
No prefix, directory, count byte or header bit is stored when no pairs exist.

The prefix is unambiguous because F is not a legal macro step. The validator
bounds the whole block before reading any pair; validates all pairs, including
unreferenced pairs; requires references to actual four-byte record starts; and
starts macro-boundary scanning after the block. Macro pointers into the prefix
or either branch reject. Nested tap-hold rejects in both branches. The tap branch
uses ordinary non-hold action rules and permits macro invocation; the hold branch
uses physical-button rules, including macro invocation and physical holds.
Rotation, timer actions/follow-ups and macro steps cannot invoke tap-hold. Physical
keys, the encoder button and chords can invoke it. Chords retain local/global
precedence and end their selected physical hold on the first member's release.

DataFlash budget overhead is `0` when unused, otherwise `1 + 4 * distinctPairs`.
The two-byte wrapper replaces the existing binding and adds no bytes there.
Pairs can be shared across bindings, layers and thresholds. Referenced text or
macros consume their ordinary separate storage. The 16-pair bound covers the
maximum reachable distinct pairs under the current geometries and 128-byte
budget: physical bindings cost no extra metadata, but each additional chord
reference costs three bytes in addition to its pair. Unreferenced definitions
are still validated, but should not be emitted by a writer.

Example pair: `08 CD 2C 01` means tap **Play/Pause**, hold **Momentary Layer** on
**Layer 2**. `0C 01` instead makes the hold select **Layer 2** persistently.
Threshold is `(selector + 1) * 32ms`, from 32–512ms. Selector 5 gives 192ms and
selector 6 gives 224ms. Both completed implementations preserve exact elapsed
millisecond comparison; the smaller shifted comparison is mathematically
identical to the threshold test, including clock wrap.

## Runtime Decisions and Interactions

- The accepted debounced press stores that input's timestamp and wrapper bytes.
  All physical inputs may wait simultaneously; duplicate presses do not restart
  their deadlines. Different thresholds can share the same pair.
- Release before threshold selects the tap immediately. Release at/after threshold
  selects the hold even with no intervening output poll. A selected hold suppresses
  tap; an ordinary hold-branch action runs once, while physical holds use their
  existing release/backpressure behavior.
- Branch selection replaces the stored wrapper with ordinary action bytes, then
  uses the existing dispatcher. Layer recomputation occurs before release cleanup,
  so a momentary layer selected exactly at release can enter and leave normally.
- Due decisions are resolved before physical scanning, and also before output
  backpressure checks. A second key accepted exactly at a layer-hold deadline
  therefore binds on the held layer. Timers retain their existing priority before
  physical input; accepted input retains normal sleep/wake and consume handling.
- Chords win during their strict existing recognition window. A single key's
  threshold remains anchored to its accepted press, including after an unmatched
  chord window. If threshold is shorter than that window, hold activation waits
  until chord recognition resolves. A chord's own tap-hold clock starts when its
  second key is accepted. First release resolves a chord tap or ends its hold;
  constituent taps never leak through.
- Pair and threshold remain captured across physical or host layer changes.
  Relative action targets resolve when the chosen branch executes, using existing
  action-dispatch rules; an already activated relative layer hold retains its
  resolved target as before.
- A waiting wrapper is not executed telemetry and does not consume a one-shot
  layer. The selected branch consumes a then-armed one-shot through the normal
  dispatcher. Another input may consume it first. This policy is explicit and
  tested; it does not reserve a one-shot for the waiting key.
- Another input or encoder turn does not force a pending key into hold early.
  This is threshold-only tap-hold, without permissive-hold or hold-on-interrupt
  modes. Reset/profile application cancels pending decisions. Runtime state never
  writes DataFlash.

The release API now accepts the accepted scan timestamp. Existing test calls were
updated with a zero timestamp where no tap-hold is under test; dedicated tests
supply real boundaries. This API adjustment must accompany future integration.

## Optimization Findings

[The complete ledger](candidate-table.md) and `lineage.json` preserve every attempt,
parent, measured change and rejection. Patches are baseline-relative, not additive.
No unrelated precision reductions or existing-feature cuts were adopted. The
fixed-200ms candidate is an unselected diagnostic behavior alternative, not an
accepted simplification. No claim is made that further fitting work is impossible.

The main useful changes are byte-bounded prefix arithmetic, a shared branch-body
and macro-tail validation scan, and aligning pair references against the block's
end. The latter removes one validator state byte. External helper storage can
preserve the existing stack at modest flash cost. Blindly moving all metadata to
external RAM initially caused compiler spills and internal allocation failures;
inspect actual generated assembly and maps, not just declared storage totals.
Inlining expiry grew code. Reusing the decoded type saved nothing. A fixed 200ms
threshold saved only 24 bytes against its matched configurable parent.

For `complete-small`, linked object CSEG increases are exactly 28 bytes in the
sketch, 158 in configuration validation and 310 in action handling (496 total).
For `complete-stack`, these are 28, 178 and 328 (534 total). HID composition adds
42 action bytes and 42 protocol bytes, matching the measured 84-byte increment.
These are measured object differences for these sources/toolchain, not portable
estimates or proof of savings from a different encoding. A sparse hold-assignment
table was not implemented or measured; the experiment does not establish that
the wrapper is globally optimal among all encodings.

## Validation and Reproduction

Normal CH55xDuino 0.0.25 / SDCC 4.2.2 build.13407_4, 24MHz, small model, existing
size flags and callee-save list, permanent color preview enabled. Source manifests,
`.mem` reports, patch lineages and both HEX checksums per candidate are saved.
Native assembly/maps/diagnostic HEX remain in `/private/tmp/macropad-tap-hold/`.
Four compact source archives preserve the final firmware and tests durably here.

`complete-small`, `complete-stack` and `complete-combined` pass the full normal
host runner, including both physical geometries, existing macros, modified holds,
five user timers, sleep, telemetry, palettes (508064 frames per geometry), eight
build-layout tests and nineteen mocked bootloader tests. The runner also includes
both new tap-hold suites. Combined normal runs include the original input-style
HID regression (330133/461205 cases).

All four completed candidates pass strict ASan/UBSan tap-hold suites on both pads:
495997/494669 counted validation/model cases plus threshold matrices, and real
scanner integration (112/106 cases standalone, 115/109 with HID). The combined
sanitizer runs also pass all 330133/461205 HID regression cases. Coverage includes
all selectors and addresses in physical/rotation/chord/timer/macro contexts, every
two-byte action in both branch contexts, all block boundaries/counts, exact and
adjacent thresholds, 16-bit wrap, 2000 modeled overlapping-input traces per pad,
layer/one-shot/chord behavior, strings/palettes/macros, USB backpressure, report
regeneration, resets, wake consumption and all five timer consume masks.

No hardware validation is claimed. Real flash-limit validation fails, so these
are functionally tested oversized prototypes, not fully validated releases.
Configurator, uploader and complete-site gates were not run because their active
inputs are unchanged. The previous release files and frozen editors are untouched.

From the recorded baseline, regenerate isolated candidates with:

```sh
python3 protocol/tap-hold-investigation/measure.py baseline complete-small complete-stack complete-combined complete-small-combined
python3 protocol/tap-hold-investigation/validate.py complete-small
python3 protocol/tap-hold-investigation/validate.py complete-stack
python3 protocol/tap-hold-investigation/validate.py complete-combined
python3 protocol/tap-hold-investigation/validate.py complete-small-combined --focused
python3 protocol/tap-hold-investigation/finalize.py
```

The measurement driver uses the current checkout as its baseline; verify the
recorded baseline/source checksums before reproduction. On another parent, apply
or port a selected saved patch into a disposable checkout, then remeasure and
rerun tests. No optimization delta or RAM placement is guaranteed to transfer.

Each `complete-*.patch` contains firmware changes from the original baseline;
its matching `complete-*-tests.patch` contains API adaptations, new tests and
runner registration. Apply one standalone or one combined pair, not both.
The `hid-on-complete-*.patch` files are incremental alternatives for adding HID
after the corresponding tap-hold patch; do not add them to a combined patch.
`reapplication.json` confirms firmware/test patch pairs recreate the exact saved
source/test manifests in fresh copies. `active-firmware-unchanged.json` compares
all active changed-file candidates against the original snapshot. No production
source was edited while making these artifacts.
