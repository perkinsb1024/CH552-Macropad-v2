# Function Call Optimization Findings

Six retained changes remove repeated firmware work and save 44 flash bytes on
both hardware variants. The combined changes preserve internal RAM usage,
external RAM usage, and linker-reserved stack capacity. Configuration format 12
and HID protocol behavior are unchanged.

## Measurement Basis

Baseline: commit `7a870a7e3caea2233431bea1d469546674ca4b87`, before the six
changes described here. The baseline snapshot was verified against that commit's
firmware sources and `platformio.ini`. Final measurements use the working tree
containing the six retained changes.

Build settings: CH55xDuino 0.0.25, bundled SDCC build.13407_4, small memory model,
`--opt-code-size`, 24MHz clock, and 148 bytes reserved for USB DMA. The production
application flash limit is 14,336 bytes.

Individual candidates were measured independently against the same six-key
baseline. Diagnostic candidate builds used a larger linker code limit so that
over-limit candidates could be measured. Both final hardware variants were built
and checked at the production limit. Combined results were measured directly,
rather than inferred by adding individual results.

## Retained Changes

| Change | Implementation | Why Reuse Is Safe |
| --- | --- | --- |
| Timer loop bounds | Cache `configTimedCount()` before the loops in `timedEvent()` and `resetLayerTimers()` | Timer actions can change the layer, but cannot change the configuration or timer count during traversal. |
| Chord layer count | Cache `configLayerCount()` in `configChord()` for its table offset and layer validation | Both operations inspect the same active configuration. |
| USB report generation | Read `USB_reportGeneration()` once in `actionsPoll()` and compare/store that snapshot | A later interrupt change remains different from the stored snapshot and can be detected on a subsequent poll. The existing `i` temporary is reused. |
| Chord window | Cache `configChordWindowMs()` for `actionsPress()` | Pending-action resolution can change the layer, but cannot change the configuration's chord window. The cached byte uses `__idata` to limit direct-RAM pressure. |
| LED color table | Compute `configLedColorOffset(layer)` once per frame, then use `configLedColorAt(offset, key)` for packed nibble reads | Rendering uses a stable layer and fixed hardware geometry. The caller supplies a valid layer and key, removing repeated layer/key validation and layer-offset calculation. |
| Unchanged flash byte | Return success immediately when `writeByte()` finds that the byte already matches | A matching byte needs no write or second read. Actual writes retain their verification read and interrupt protection. |

The LED accessor replacement is internal to firmware; its callers and host tests
were updated together. The new interface requires a valid layer and key instead
of returning the old fallback color for invalid arguments.

### Individual Six-Key Measurements

All sizes and changes below are bytes. Flash saved is relative to the original
14,330-byte baseline. RAM changes describe additional or released allocation;
stack changes describe available reserve, so less reserve is a cost.

| Retained Change | Flash Size | Flash Saved | Internal RAM Change | Stack Reserve Change |
| --- | ---: | ---: | --- | --- |
| Timer loop bounds | 14,324 | 6 | 1 byte added | 1 byte less |
| Chord layer count | 14,322 | 8 | Unchanged | Unchanged |
| USB report generation | 14,326 | 4 | Unchanged | Unchanged |
| Chord window | 14,316 | 14 | Unchanged | Unchanged |
| LED color table | 14,318 | 12 | 1 byte released | 1 byte more |
| Unchanged flash byte | 14,330 | 0 | Unchanged | Unchanged |
| Combined Six Changes | 14,286 | 44 | Unchanged | Unchanged |

External RAM allocation is unchanged for every candidate. The unchanged-flash-byte
change saves an EEPROM read on an already-matching byte without changing flash
size. Runtime savings were identified from the removed operations; elapsed time
was not benchmarked.

## Rejected Candidates

| Candidate | Six-Key Flash Size | Added Flash | Internal RAM Change | Stack Reserve Change |
| --- | ---: | ---: | --- | --- |
| Cache the bootloader wait loop's `millis()` result | 14,338 | 8 | Unchanged | Unchanged |
| Reuse upload CRC verification through a content-only validator | 14,340 | 10 | 1 byte added | 1 byte less |

Bootloader clock caching reduced up to three `millis()` calls to one per loop
iteration, but its extra local and control flow increased compiled size. The
original wait loop was restored.

Upload commit calculates the CRC and then calls `configValid()`, which calculates
it again. The rejected implementation extracted content validation into
`configContentsValid()` and kept `configValid()` as the full-validation wrapper.
That wrapper and parameter storage cost more than merely deleting a function
call. It also added a two-byte return address while startup content validation
ran through the wrapper.

CRC reuse eliminated one calculation only when a completed configuration upload
reached commit validation. Startup still calculated the CRC once; ordinary key,
encoder, and LED processing did not benefit. The unmeasured upload-time saving
did not justify the flash cost, so the original validator and commit path were
restored.

For comparison, all eight candidates together used 14,304 flash bytes, saving
26 bytes, with internal RAM increased by one byte and stack reserve reduced from
77 to 76 bytes. Those are intermediate measurements, not the retained build.

Repeated `USB_reportsPending()` and `flushOutputs()` calls remain because
interrupts or intervening action processing can change their relevant state.
`configKeyCount()` already expands to a compile-time constant in SDCC firmware
builds, so repeated uses do not represent repeated function calls there.

## Final Measurements for Both Variants

| Variant | Baseline Flash | Final Flash | Flash Saved | Final Flash Free | Stack Reserve Before / After |
| --- | ---: | ---: | ---: | ---: | --- |
| Six-Key | 14,330 | 14,286 | 44 | 50 | 77 / 77 |
| Three-Key | 14,326 | 14,282 | 44 | 54 | 80 / 80 |

| RAM Allocation | Six-Key Before / After | Three-Key Before / After |
| --- | --- | --- |
| Internal footprint, including register and bit regions | 179 / 179 | 176 / 176 |
| Paged external RAM | 95 / 95 | 95 / 95 |
| Allocated non-paged external RAM | 369 / 369 | 360 / 360 |
| Separate absolute active-configuration buffer | 128 / 128 | 128 / 128 |
| USB DMA reservation | 148 / 148 | 148 / 148 |

Internal footprint is 256 bytes minus linker-reserved stack space. Stack figures
describe the linker's available region, not runtime high-water measurements.
Absolute configuration storage and USB DMA are listed separately from the
allocated non-paged external RAM figure reported by `firmware.mem`.

## Validation and Reproduction

`python3 tests/run_host_tests.py` passed configuration, actions, protocol, USB,
macros, timed actions, input/LED behavior, and six memory-layout tests. Suites
cover both hardware geometries where applicable. Added LED coverage checks two
layers and every packed color nibble value on both geometries.

Both final builds passed the production flash limit and linked memory-layout
checks. `git diff --check` passed. The normal six-key PlatformIO build was updated
with `pio run`; three-key measurements used temporary outputs. No hardware was
flashed and no release artifacts were generated.

Build the current source into temporary outputs with:

```sh
python3 pio-platform/build_firmware.py build "$PWD" /private/tmp/macropad-call-reuse-six-key 24000000 148 14336 0
python3 pio-platform/build_firmware.py build "$PWD" /private/tmp/macropad-call-reuse-three-key 24000000 148 14336 1
python3 tests/run_host_tests.py
```

Inspect each output's `firmware.mem` and `firmware.map` for the size and layout
results. To reproduce the original baseline, run the same build driver against a
separate checkout of the baseline commit. Subsequent firmware changes can alter
the final sizes reported here.
