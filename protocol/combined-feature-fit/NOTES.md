# Chords, Independent Tap-Hold and HID Layer Selection

Measured October 18, 2026 on experiment/v18-additional-features, from
baseline 18ae05b0c26811eb10c58c6825727f7e7abb8ee3. Firmware implementation:
796120bc4a209d7dd3dbfb47380d5a4d702679df. Configurator implementation is explicitly
deferred. Existing release HEX files and frozen editors are unchanged.

## Result

| Build | Flash Six/Three | Free Six/Three | Stack Reserve Six/Three | PSEG | Ordinary XSEG Six/Three |
| --- | --- | --- | --- | --- | --- |
| Optimized Chord Baseline | 13951/13932 | 385/404 | 105/108 | 102 | 404/395 |
| First Combined Prototype | 14531/14512 | Over by 195/176 | 100/103 | 102 | 420/405 |
| Selected Complete Firmware | 14329/14310 | 7/26 | 102/105 | 108 | 410/395 |

The complete implementation adds 378 flash bytes per pad over the optimized
chord baseline. Total external allocation is 800/785 bytes, including USB DMA
148, PSEG 108, ordinary XSEG 410/395 and absolute image/runtime storage 134.
Internal stack reserve decreases three bytes per pad from the starting revision;
it remains above the project's 90/93-byte reference. These are linker reserves,
not runtime high-water measurements.

Both variants fit the real 14336-byte limit. There are no feature, CRC, queue,
timer-slot, profile-capacity or timing-precision cuts. LED preview is preserved.
The selected result includes the scanner-order correction below. Earlier
combined, hot-* and final prototypes are superseded, even where they fit.

Measurements use CH55xDuino 0.0.25, SDCC build.13407_4, the existing small-model
size settings and selected callee-save extensions, 24MHz and USB DMA 148.
The ledger records 61 candidates / 122 native measurements. Oversized candidates
receive a 65535-byte diagnostic link to obtain sizes; these are measurement
artifacts, not installable CH552 images. Native allocation failures are rejected,
even when a map exists and its external addresses look plausible.

## Full Feature Semantics

Keys, the encoder button and chord results can use independent simultaneous
decisions. Each binding selects one of sixteen 32ms–512ms thresholds.
Tap accepts ordinary non-held actions, including macros; hold accepts ordinary
physical actions. Pair sharing, per-binding thresholds, exact release-boundary
handling, chord precedence, layer/one-shot interaction, sleep consumption,
brief-hold output backpressure and reset cleanup are supported.

Type F wraps an absolute four-byte tap/hold record. An optional counted prefix
after strings costs one byte plus four per record, and costs nothing when unused.
Both branches and unreferenced records are validated. Wrappers reject in
rotation, timer fields, macro steps and nested records. Macro starts follow this
optional block. Header size, chord window, CRC16 and profile capacity are retained.
This is a backward-compatible extension of the unreleased format 18; older
format-18 firmware rejects the new records and advertises mask 0x7FFF rather
than 0xFFFF. The current editor does not support these records.

HID opcode 13 selects the persistent runtime base layer. The target occupies
offset bits 0–6; bit 7 optionally services normal input handling, including wake
and consuming timer follow-ups. Quiet selection, previous-layer history,
one-shot cancellation, held-layer priority, backpressure and unchanged DataFlash
are covered. Acknowledged input consumption can suppress selection.
See the standalone config-v18.md reference for all encodings and protocol rules.

## Selected Optimizations and Portability

- Return a binding address instead of two output-pointer parameters. Physical
  press and rotation callers already constrain layer/input ranges; preserve that
  precondition when porting. Legacy test adapters retain value-based assertions.
  Independently saves 46 bytes and frees six stack bytes in the initial combined
  parent. Share pair loading and physical dispatch to reuse the same paths for
  chords, ordinary bindings and resolved tap-hold branches.
- Put USB queue head/tail/count and four private idle-control bytes in direct
  RAM. Queue placement alone saves 44 bytes and uses three internal bytes.
  USB interrupt parameter storage remains external and is checked by the builder.
  Do not copy paged/clock probes that fail direct overlay allocation.
- Put raw input levels in seven paged bytes and move report-generation cache to
  direct RAM, a net six-byte PSEG increase. The independent probe saves 30 bytes
  and uses one stack byte. Final PSEG fills 0x094–0x0FF; native page-zero checks
  and startup selection remain mandatory.
- Add configLayerCount, configTimedCount and USB_reportsPending to the existing
  callee-save convention. Both caller and callee must use identical flags.
  Independent savings are 10, 8 and 16 bytes; combined savings are not additive.
  Other getters, allocator settings and compiler switches were measured and rejected.
- Reuse the prior arithmetic audit's bounded debounce-index, descriptor-index
  and palette-stride casts. Geometry, table bounds and qualified pointer types
  are dependencies. Do not narrow elapsed timestamps or CRC arithmetic.
- Compare the full elapsed value with threshold minus one. A pending wrapper's
  first byte is 16*selector+15, so twice that byte OR 1 is 32*selector+31.
  Widen before doubling so selector 15 still means 512ms. The actual runtime
  predicate is exhaustively checked for every 16-bit elapsed value and selector
  at two origins. Narrow only the bounded timestamp-array byte offset.
- Split the event queue's first/second action bytes into parallel eight-byte
  arrays. Capacity, FIFO order and sixteen-byte storage are unchanged. The
  independent saving is two bytes; remeasure interaction with other changes.
- Check section capacity by subtraction before addition for the default maximum
  of five timers. Fixed records are at most 242 and pool plus palettes at most
  142. Check fixed <=128, then pool/palettes <=128-fixed, before summing.
  Higher CONFIG_TIMED_MAX retains the wider fallback. The selected-parent saving
  is six/four bytes. No malformed-image rejection is relaxed.
- Keep the shared current tap timestamp, cached mouse state and macro repeat
  state external to recover stack capacity. Cold-state placement costs twelve
  bytes and recovers two stack bytes in the measured parent. Several further
  stack-recovery combinations exceeded flash; their patches remain available.

These optimizations do not require removing chords or other features. Binding
address lookup and shared loading must be ported together with their callers;
tap-specific arithmetic requires the F wrapper invariant. RAM placement and
compiler-convention changes must be remeasured against main rather than assuming
this branch's layout. The complete selected patch includes both features and
optimizations; use the independent candidate patches and their recorded parents
when extracting only an optimization.

## Scanner Ordering Correction

The first prototype moved all expired chord singles before the physical scan.
That can change the layer used by a simultaneous encoder-button press.
The ordinary-chord regression passes on the original baseline, fails on the
superseded prototype and passes on the corrected source on both geometries.
It covers all seven nonzero windows, before/at/after expiry and clock wrap.

Only pending tap-hold singles resolve before scanning. Ordinary chord deadlines
retain their original post-scan ordering. A private foreground bit marks the
output-poll pass and is cleared by the shared resolver; it adds no function
parameter or timestamp quantization. Separate integration cases verify that a
tap-hold layer decision does precede the next binding even when its key has waited
through a chord window.

## Validation and Scope

The selected source passes the complete normal host runner on both geometries,
including 508064 LED frames per geometry, exhaustive chord lookup, five timers
plus auto-sleep, USB, macros, input, telemetry, eight layout tests and nineteen
mocked bootloader tests. New sanitizer suites use ASan/UBSan with recovery disabled:

| Suite | Six-Key Cases | Three-Key Cases |
| --- | ---: | ---: |
| Tap-Hold Encoding and Runtime | 2593181 plus runtime matrices | 2591853 plus runtime matrices |
| Real Scanner and Combined Interactions | 129 | 123 |
| Optional-Input HID Layer Selection | 330133 | 461205 |
| Ordinary Chord Scanner Ordering | 42 | 42 |

Fresh active-tree native outputs match the selected HEX hashes on both pads and
pass real-limit, startup, USB-parameter and RAM-layout checks. The firmware
commit contains the exact tested sources; subsequent documentation is separate.
Hardware validation, release generation, flashing and publication were not performed.

The shared deployment gate fails two existing assertions in
webapp/tests/v14-actions.test.ts, one per geometry: they expect every type-F byte
to be rejected, but a valid F prefix now declares the optional record block.
The other 817 configurator tests pass. Configurator code and tests are unchanged
pending the user's UI discussion. Uploader tests and the complete site/archive
build are run separately because this gate stops at the configurator failures.
See validation-summary.json for final per-suite results. This is not a fully
passed deployment gate.

## Artifacts and Reproduction

candidate-table.md and results.json preserve every measurement, including
rejected probes. recipes.json and measure.py identify each composition.
Each candidate has a baseline-relative firmware patch and source hashes;
results.json identifies its shared regression patch. The selected-source and
baseline-source archives preserve complete native/test inputs. Validation JSON
records the exact commands' results and source hashes.

For isolated probe reproduction, start from the recorded baseline, copy this
artifact directory into that checkout, and run measure.py with the desired names.
The driver keeps a baseline snapshot for subsequent probes and rejects overwrites.
finalize.py selected prepares the adopted composition and added regressions.
validate.py selected runs sanitizers and the full host suite.
collect.py gathers the artifacts after measurements. Existing temporary source,
map, assembly and native outputs are under /private/tmp/macropad-combined-feature-fit.

For the adopted firmware, use the ordinary host and temporary native-build
commands in config-v18.md. Never install an oversized diagnostic HEX.
