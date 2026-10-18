# Tap-Hold Alternatives with Relaxed RAM Constraints

Recorded October 18, 2026 on `experiment/v18-additional-features`, clean firmware
baseline `855eb768b32eba027bc14eccfa9d10afa0ed01f5`. Its firmware matches the prior
investigation baseline; the baseline binaries also match the previous hashes.
This task leaves active firmware, configurator, production documentation, uploader,
release files and previous investigation artifacts unchanged. No commits, release
generation, flashing or publication occurred. The local optimization notebook is
updated separately, as required by the project instructions.

## Accepted Constraints and Result

The user authorized a ten-byte header and variable placement changes provided
linker stack reserve stays at least 70 bytes. Independent pending holds remain
preferred. Single-pending/interruption behavior was explicitly permitted for
comparison but is not preferred. Tap-hold assignments on chord actions are
excluded; ordinary chord actions, including existing physical holds, remain.
No existing features, color preview, CRC checks or timing precision were removed.

Thirty-five candidates including baseline have seventy native variant
measurements. None fits the 14336-byte application limit. The smallest completed
independent prototype uses the previous wrapper encoding with a fixed 200ms
threshold, centralized validation and internal timestamp arrays. It saves 112
flash bytes against the previous 496-byte implementation. Per-binding configurable
thresholds add 22 bytes. The ten-byte-header table is smaller in profile storage
for distinct assignments, but its lookup/state handling makes larger firmware.

| Prototype Alias | Flash Six/Three | Added Flash | Over Limit Six/Three | Stack Six/Three | XSEG Six/Three |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 14205/14201 | 0 | Fits (131/135 free) | 102/105 | 404/395 |
| `preferred-fixed` | 14589/14585 | 384 | 253/249 | 70/79 | 392/383 |
| `preferred-configurable` | 14611/14607 | 406 | 275/271 | 70/79 | 392/383 |
| `sparse-independent` | 14751/14747 | 546 | 415/411 | 71/83 | 399/390 |
| `single-sparse` | 14737/14733 | 532 | 401/397 | 75/78 | 385/376 |
| `single-wrapper` | 14739/14735 | 534 | 403/399 | 77/80 | 385/376 |
| `sparse-tail` | 14757/14753 | 552 | 421/417 | 71/83 | 399/390 |

Aliases identify saved comparison snapshots, not adoption decisions. Stack
capacity is reduced explicitly under the user's task-specific 70-byte floor.
These are linker reserves, not runtime high-water measurements. The six-key
preferred variants reach that floor exactly; hardware validation remains necessary
before adoption. All final aliases pass the native RAM, page-zero, absolute-image,
startup clearing and USB interrupt parameter checks using diagnostic links.

The real-limit links fail because flash is oversized. Diagnostic links use the
same compiler/settings with a 65535-byte code limit solely to measure size and
run layout checks. Their HEX files are measurement artifacts, not installable
firmware. Rows marked RAM FAIL in the complete ledger additionally fail internal
allocation and have no usable stack result.

Direct HID compositions preserve RAM/stack allocation and add exactly 84 bytes:

| Prototype with Optional-Input HID Command | Flash Six/Three | Added Flash | Over Limit Six/Three | Stack Six/Three |
| --- | ---: | ---: | ---: | ---: |
| `preferred-fixed-combined` | 14673/14669 | 468 | 337/333 | 70/79 |
| `preferred-configurable-combined` | 14695/14691 | 490 | 359/355 | 70/79 |
| `sparse-independent-combined` | 14835/14831 | 630 | 499/495 | 71/83 |
| `single-sparse-combined` | 14821/14817 | 616 | 485/481 | 75/78 |

## Encodings and Behavior

The wrapper retains a nine-byte header, fixed two-byte bindings and the optional
counted block from the previous investigation. A binding contains type F and an
absolute pointer to a four-byte tap/hold pair. The optional block after strings
costs one prefix byte plus four bytes per distinct shared pair; with no assignments
it costs zero bytes. Configurable wrappers retain their per-binding 32–512ms
thresholds in 32ms increments. Fixed wrappers use 200ms and ignore that auxiliary
nibble; canonical writers would write zero there. Pair sharing remains possible.

The sparse variants retain the ordinary binding as the tap action. Header byte 9
has hold count in bits 0–4 and a profile-wide selector in bits 5–7. The configurable
sparse threshold is `(selector + 2) * 64ms`, giving 128–576ms. Fixed variants use
200ms and ignore selector bits; canonical writers would zero them. The header
always costs one extra byte, including profiles without holds. Each assignment
adds a three-byte identifier/action record. Initially its identifier used three
input bits plus three layer bits; the optimized table uses the linear ordinal
`layer * (physicalKeys + 1) + input`. Input includes the encoder button. Sorted,
unique IDs must lie below `layerCount * (physicalKeys + 1)`. The remaining two
bytes use the existing physical-action encoding. There are no tap-hold action
records or nested definitions in this encoding.

The main sparse layout is header, layers, optional palettes, chords, user timers,
hold records, strings, macro sequences/padding. The normal macro start remains
`stringPoolStart + poolLength`; hold records never masquerade as macro steps.
A record's hold pointer and the tap bytes are captured at accepted press time.
Sparse tap bindings may themselves be ordinary physical-hold actions: a short
press executes and releases that action using existing USB backpressure handling.
The wrapper retains its earlier restriction to non-hold tap-branch encodings.

The internal-marker sparse alternative replaces cached tap bytes with a runtime
F marker and a pointer to its hold record. It reconstructs the tap binding from
that record's layer/input identity. It saves some state code but was not the
smallest sparse implementation. F remains prohibited in saved sparse actions;
its action mask remains `0x7FFF`. Wrapper action masks advertise F (`0xFFFF`).

The tail-table alternative stores records at `128 - 3 * holdCount`. It avoids
computing the lookup start from metadata, and leaves strings directly after
timers. Validation bounds macros below the table and requires explicit terminal
zero/padding when holds are present, so macro playback cannot fall through into
hold records. No-hold profiles retain the old implicit end-of-image termination.
The extra macro checks outweigh lookup savings by six bytes in the matched
optimized comparison. It is retained as an unselected encoding alternative.

All formats retain version byte 18 only as an experimental convenience for the
host fixtures. Neither the new sparse header/layout nor new wrapper actions are
an adopted v18 format. Production versioning, capability handling, editor changes,
migration and archive work are deferred. A new header shifts profile body
addresses but does not change USB packet offsets, CRC fields or image capacity;
the isolated regression adaptations preserve those distinctions.

Independent variants keep separate exact 16-bit millisecond deadlines. Early
release executes the tap immediately. At/after threshold selects hold even if
there has been no output poll. Selected hold suppresses tap; existing physical
hold release/report rules remain. Due decisions run before scanning the next
physical input and before output backpressure. Pair/record selection survives
layer changes. A pending dual-role action consumes a one-shot only when its
selected action executes, through existing dispatch rules. Another input may
consume it first. Reset cancels pending decisions; runtime never writes DataFlash.

## Single-Pending and Chords

Both single-pending approaches check for a valid chord before promoting a pending
hold. Pressing button 1 with a hold, then button 2 strictly inside their configured
chord window executes only the chord. No constituent tap or hold leaks through.
Tests cover both press orders, local/global scope, exact window boundaries and
16-bit clock wrap, including real debounced scanner events.

If a second input does not form a chord, single-pending variants promote the
previous pending dual-role key to hold before binding the new input. Overlapping
quick taps can therefore become holds. This is the reason the user considers the
behavior nonpreferred; the experiments do not adopt it as the default.

The sparse single-pending state is separate from the existing ordinary chord
candidate. The wrapper single-pending variant reuses that candidate/timestamp and
adds paths for incoming encoder holds, ordinary pending chords, layer changes
and rotations. Rotations preserve an active chord opportunity until its window
closes; they must not steal the chord. Already resolved physical holds can coexist.
The simpler RAM state does not imply smaller firmware once these rules are kept.

Before different RAM placement, `sparse-single-fixed-merged` is 22 bytes larger
than its matched independent `sparse-fixed-merged` parent. After separate RAM/ID
optimization the best sparse single-pending snapshot is only 14 bytes smaller
than the best sparse independent one. That is not a pure behavioral saving:
the single-pending variant has room for a different internal clock layout.
Both remain much larger than the independent wrapper, so there is no demonstrated
reason here to prefer interruption semantics for flash savings.

## Optimization Findings

The [complete candidate ledger](candidate-table.md), `lineage.json`, patches,
source hashes and memory reports preserve every measured attempt, including
failed layouts and rejected zero/negative results. Deltas are parent-relative;
patches are baseline-relative and must not be stacked arbitrarily.

Useful measured changes include:

- Internal pending timestamps/release parameter save 24 bytes in the initial
  matched wrapper comparison. Removing chord-result assignments and its timestamp
  write saves 12 bytes against the previous completed prototype.
- Fixed 200ms saves 20 bytes at the initial internal-wrapper checkpoint, or 22 in
  the final combination. Configurable thresholds remain a saved tested option.
- Centralized wrapper validation checks that an invocation is inside the layer
  binding records. This rejects chord and nested wrappers without separate
  dispatch contexts or repeated F checks in pair validation, saving 24 bytes.
- Internal debounce timestamps, balanced by an external release parameter, save
  32 more bytes in the matched wrapper layout while leaving 70/79 stack.
- Sparse lookup merged into configBinding's return value saves 44 bytes in its
  matched independent comparison. Linear IDs save another 24, and raw-level/
  release-parameter placement saves 20 more. These optimize sparse code but do
  not erase its total overhead versus the wrapper.

Simple arithmetic and validation bounds remain intact. Sparse metadata sums use
separately bounded byte subtotals (at most 213 and 172) and a wide final sum; the
additional 0–31 hold count must not wrap the older fixed-record sum. Linear IDs
replace two checks with a single physical-slot range check. All unreferenced
records still validate. Timestamp precision remains exact; no eight-bit wrap or
coarse-tick timing assumption was introduced.

Some proposed internal telemetry temporaries caused direct-RAM spills and failed
linker placement despite an apparently generous stack figure. Moving telemetry
counters or using internal marker state provided smaller or negative gains.
Actual assembly/maps determine whether a layout works. All adopted snapshot
layouts meet the task floor; failed candidates are not presented as usable builds.
PSEG108, USB148 and absolute active-image/runtime-timer134 stay unchanged in the
final aliases. Total external RAM is XSEG + 390, so the preferred pair allocates
782/773 external bytes versus baseline794/785, relocating bytes internally.

## Validation and Saved Work

Toolchain: CH55xDuino0.0.25, SDCC4.2.2 build.13407_4, normal 24MHz small-model
size flags/callee-save list, permanent color preview. Exact firmware sources,
`.mem` reports and diagnostic HEX hashes are recorded for both variants. Native
assembly/maps/HEX remain under `/private/tmp/macropad-tap-hold-alternatives/`.
Final aliases have durable source/test archives here.

The final fixed/configurable independent wrappers, sparse independent,
single-sparse and single-wrapper snapshots pass full normal host regressions
on both boards. These include existing keyboard/consumer holds, mouse, layers,
chords, macros, five timers, sleep, telemetry and palettes (508064 frames each),
eight build-layout and nineteen mocked bootloader tests. Final fixed-wrapper
HID composition also passes the complete runner and the original HID regression.
All four final HID compositions pass strict ASan/UBSan new-feature/scanner suites
and the complete HID input-command sanitizer matrix (330133/461205 cases).

New sanitized tests include all selectors, threshold-adjacent/exact releases,
clock wrap, both press orders and chord scopes, rotation interactions, pending
ordinary chord plus encoder hold, one thousand deterministic overlapping-input
model traces per board, every two-byte action in both branch contexts, identifier/
count boundaries, macro references, strings/palettes, USB backpressure, layer
selection at release, reset, wake consumption and all five timer consume masks.
Case counters are approximately240000 per board for wrappers and235000 for
sparse variants, plus114/108 real scanner cases (116/110 with HID-specific checks).
The sparse physical-hold tap and tail-boundary policy have explicit regressions.

The new `alternatives` and `alternative_integration` suites replace the previous
wrapper-specific tap-hold suites in these snapshots. Inherited old fixture files
are preserved for provenance but are not registered as current feature tests.
The normal runner remains otherwise intact, with profile addresses adapted to
the header size for sparse formats. Harmless unused test-helper warnings and an
unused loop local in a nonpreferred single-pending candidate are not hidden.

No hardware or runtime stack high-water validation was performed. Real flash-limit
checks fail, so none is a fully validated release. No configurator/uploader/site
gate ran because active deployment inputs did not change. Previous artifacts,
production documentation, releases and frozen editors remain untouched.

`aliases.json` maps readable patch names to full candidate names. Each alias has
firmware and tests patches plus a source archive. Apply exactly one pair against
the recorded baseline in an isolated checkout. Combined patches already include
HID; alternatively use `hid-on-<alias>.patch` after its standalone pair. Do not
apply both routes. `reapplication.json` checks exact final source/test hashes for
all alias patch pairs and four incremental HID patches. The active firmware hash
comparison is in `active-firmware-unchanged.json`.

For reproduction, use `measure.py <full-candidate-name>` followed by
`validate.py <full-candidate-name>`; `--focused` skips the full normal runner.
The drivers read the current checkout and depend on the preserved previous
investigation drivers/patches. Verify baseline/source checksums first. Rebaseline,
remeasure and rerun checks when porting to another parent/toolchain; these byte
savings and RAM overlays are not guaranteed to transfer. After validation,
`finalize.py` regenerates the aliases, ledger, source archives and reapplication
checks. The final result is an improved but still oversized implementation,
without changing existing firmware behavior or adopting a feature degradation.
