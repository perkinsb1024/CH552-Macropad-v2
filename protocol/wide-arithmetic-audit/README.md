# Wide Arithmetic Audit

Measured October 17, 2026, on branch
`experiment/v18-wide-arithmetic-optimization`, against clean firmware source
`eaf798c` (the finalized five-timer format v18 implementation).
This directory contains investigation artifacts and reviewable patches. The
initial scan left active firmware unchanged. The user subsequently selected the
recommended 94-byte patch; it is now applied to the active working tree, as
described under Implementation below. The configurator, protocol version
and checked-in releases are unchanged. No commits, hardware flashing or
publication were performed.

## Result

The recommended [combined patch](combined.patch) saves 94 bytes on each board
with small, local changes. An [expanded patch](expanded.patch) saves 102/104
bytes, and the [maximum-saving patch](maximal.patch) saves 104/106 bytes.
The latter alternatives introduce less readable address casts and, for the
last two bytes, additional metadata capacity branches. The combined patch is
the selected implementation; the other patches preserve the measured options.
All three patches apply independently to the baseline, rather than on top of
one another.

| Source | Six-Key Flash | Three-Key Flash | Saving Six/Three | Free Flash Six/Three | Stack Reserve Six/Three |
| --- | ---: | ---: | --- | --- | --- |
| Baseline | 14,299 | 14,295 | 0/0 | 37/41 | 102/105 |
| Recommended Combined | 14,205 | 14,201 | 94/94 | 131/135 | 102/105 |
| Expanded | 14,197 | 14,191 | 102/104 | 139/145 | 102/105 |
| Maximum Saving | 14,195 | 14,189 | 104/106 | 141/147 | 102/105 |

Every measured candidate retains PSEG 108 bytes, ordinary XSEG 404/395 bytes,
absolute active-image/runtime storage 134 bytes, USB DMA 148 bytes and total
external allocation 794/785 bytes. Stack figures are linker reserves. There is
no stack reduction relative to this v18 baseline, or to the project's 90/93-byte
minimum reference. There is no added persistent state or feature reduction.

## Scope and Method

Reviewed the complete active sketch, every `src/` C file/header and
`timed_actions.inc`, including local USB control, HID queues, descriptors,
configuration validation/accessors, storage, action dispatch, macro playback,
timers, debounce and LED rendering. Also inspected linked CH55xDuino timing and
EEPROM code and the builder's source selection and flags. Historical probes,
frozen JavaScript archives and unrelated upstream examples are not active
firmware and were not treated as flash-saving opportunities.

Read the existing local optimization notebook and the five-timer measurements
before selecting candidates. Located promotions, shifts, products, comparisons,
ternaries and indexed accesses in source, then inspected emitted SDCC assembly.
Measured 28 isolated candidates on both boards, plus three combinations and the
baseline (64 native builds). A second assembly pass accounted for remaining
carry operations and multiplications. Full native output, assembly, maps and
source snapshots are under `/private/tmp/macropad-wide-audit/`; durable patches,
source manifests, memory reports, checksums and the complete measurements are
stored here.

Measurements use CH55xDuino 0.0.25, SDCC build.13407_4, the existing small-model
size flags and callee-save list, 24MHz, USB DMA 148, and the real 14,336-byte
application limit throughout. LED preview remains part of the normal firmware.
Each build runs the builder's page-zero, external/absolute RAM, startup clearing
and interrupt-parameter separation checks. No release-generation target was run.

## Recommended Changes and Bounds

Individual savings below are baseline-relative. They total 92 bytes, while the
measured combination saves 94 because code generation and alignment interact.
Do not add independent measurements to predict a different combination.

| Candidate | Location | Saving per Board | Reason It Preserves Behavior |
| --- | --- | ---: | --- |
| `press-mask` | `actionsPress` | 14 | The input range check precedes the shift; accepted input is at most six, and `inputDown` is a byte. Cast the shifted mask before the AND. |
| `release-mask` | `actionsRelease` | 14 | A chord partner is a physical key index (0–5). The mask and stored state only need eight bits. |
| `validator-layer-mask` | `actionValid` | 14 | Rotation context is normalized to 0/1 for layer actions. Its shifted mask is 0/2; the auxiliary nibble is 0–15. |
| `validator-mouse-limit` | `actionValid` | 14 | The conditional yields only 2 or 3. Cast its result before comparison, avoiding a signed 16-bit comparison. |
| `validator-timer-index` | `configValid` | 8 | The complete metadata capacity check has passed before the timer loop. Each six-byte record, including scope at +5, lies inside the 128-byte image. |
| `macro-index` | `actionsPoll` | 8 | Nonempty validated macro steps start at or below 126; their parameter is at or below 127. The repeated empty macro terminator at 127 never takes this load. |
| `usb-out-subtraction` | `USB_EP0_OUT` | 12 | Replace `received + length <= expected` with `received <= expected && length <= (uint8_t)(expected - received)`. The first check prevents subtraction underflow. This preserves overflow rejection; it does not truncate an unchecked sum. |
| `led-color-cursor` | `configLedColorAt` | 4 | Add into the existing byte parameter before indexing. It has exactly the old cast's modulo-256 semantics; valid reads remain inside the image. |
| `string-cursor` | `configStringChar` | 4 | Add into the existing byte cursor before indexing. Original pool and overflow checks remain, and the resulting byte is identical to the old explicit cast. |

These casts communicate the width needed by the consuming operation. Declaring
the inputs `uint8_t` alone is insufficient: C promotes them to `int` before many
expressions. Casting a whole result that is immediately assigned to a byte often
saves nothing because SDCC already discards the high byte. The useful mask casts
act before an AND/conditional comparison; the cursor assignments also improve
SDCC's handling of the page-aligned active image.

For example, the original press guard emits a two-register shift loop, zero
extension of `inputDown` and a two-byte AND/test. The narrowed guard emits a
one-byte shift and AND/test. The timer-index and macro-index casts remove the
separate high-byte calculation of `offset + constant`. Pointer-base carries for
ordinary external RAM remain where they are needed.

## Additional Options

`raw-changed-index` saves six bytes per board by calculating each debounce
timestamp's byte offset before adding the full external-RAM base. It preserves
16-bit timestamp loads/stores and elapsed-time precision. Input indices are 0–6;
the offset into seven `uint16_t` elements is 0–12. The byte pointer is converted
back to the original word type at an element boundary. The casts are more
verbose than the existing array accesses.

`string-descriptor-index` saves two bytes per board. The existing `valueLow <= 3`
check bounds the pointer-table byte offset; `sizeof` preserves host/native pointer
sizes. The code-memory pointer still uses its full width. The nested pointer
casts are a readability cost for a small saving.

`palette-stride` saves zero bytes on six keys and two on three keys. Casting
`keys + 1` before shifting preserves the 3/6-key palette lengths. It is included
in the expanded alternative, along with the two address rewrites above.

`metadata-subtraction` saves two bytes per board in isolation and on top of the
expanded alternative. For limits up to five timers, the fixed record subtotal
is at most 242 and pool plus palettes at most 142. Reject fixed records above
128, then compare the variable subtotal with `128 - fixed` before adding. The
accepted end offset then fits a byte without wrapping. The wider fallback for
timer limits above five remains. This preserves the same image capacity and
validation rules, but adds branches for a smaller benefit than the main changes.

## Zero or Negative Results and Necessary Width

The full [candidate table](candidate-table.md) and [machine-readable results](results.json)
include all 28 isolated attempts. Narrowing the encoder index, binding bound,
rotation selection, pointer decode intermediates, LED-effect shift, telemetry
source shift, rainbow speed index, relative-layer sum, pair-index intermediate,
bootloader clock operands or sketch clock locals gave no saving. A narrower
palette-table product and LED-relative sum changed generated bytes but did not
reduce size. Rewriting the live-state pointer-table index grew flash by ten
bytes; an algebraic byte-oriented X/Y decoder grew it by four. These are not
recommended for adoption.

Preserve the full CRC-16 accumulator and consumer usage, the 16-bit macro pause
range, signed deadline checks, debounce and protocol timeout subtraction, and
USB idle durations (`rate * 4` reaches 1,020ms). Timer ages are already split
into byte fields without reducing the interval range. The ordinary metadata
sum must retain its carry unless adopting the separately checked subtraction
alternative. External/code pointer bases can cross pages even when an index
fits a byte; narrowing the complete address would be incorrect. The core
`millis()` implementation preserves its 32-bit API, and cycle-sensitive LED and
delay assembly were left intact. Most remaining multiplies already use the
8051's native byte multiply and discard an unused high result where appropriate.

## Validation

The recommended, expanded and maximum-saving snapshots each pass the complete
normal `tests/run_host_tests.py` runner: both hardware geometries, configuration,
actions, protocol, USB, header repacking, modified holds, layers, macros, timers,
five-timer capacity, input scanning, sleep integration, telemetry and palettes,
plus eight layout tests and nineteen mocked bootloader tests. Palette tests
compare 508,064 frames per geometry. Native builds of all three combinations
pass the real flash limit and linked-layout checks.

Each combination also passes AddressSanitizer/UndefinedBehaviorSanitizer checks
for configuration, protocol, USB, actions, macros, timed actions and timer
capacity, on both variants. Baseline/candidate differential checks cover:

- 1,376,256 action encodings across seven layer counts and three action contexts.
- 852,512 sealed configuration images, including all metadata count/pool
  combinations for both geometries with optional palettes present/absent, every
  byte of every timer record, and 20,000 seeded malformed images. Validator input
  allocations are exactly 128 bytes so out-of-bounds access is detectable.
- 195,072 palette reads and 131,072 string offset/index combinations.
- All 16,777,216 combinations of the three USB range-check byte operands,
  including sums above 255.

The recommended and maximum-saving snapshots additionally run real sketch input,
sleep, telemetry and palette suites under address/alignment sanitizers for both
variants, covering the optional word-pointer address rewrite in the maximum
patch. Validation records identify the exact source manifest. Host compilation
uses wider `int` than SDCC; the native assembly and real linked builds supply
the target-width and address-space checks that host tests cannot provide.

The baseline was clean `eaf798c`; validation ran against isolated uncommitted
candidate snapshots. These results do not claim hardware validation. No
configurator, uploader or site changes were made, so their deployment suites
were not run for this source scan.

## Implementation

The user authorized applying only the recommended combination on October 17,
2026. It is implemented in `src/actions.c`, `src/config.c` and the local
`src/userUsbHidKeyboardMouse/USBhandler.c`, with brief comments documenting bounds
and the USB subtraction guard. The optional pointer casts, metadata branching
and palette-stride alternatives remain isolated measurements.

Fresh native builds of the actual working tree produce 14,205/14,201 bytes of
flash, leaving 131/135 bytes free. Both HEX files match the audited combined
candidate byte for byte, and all linked-memory/startup/interrupt checks pass.
RAM and stack reserves remain unchanged. See [build records](implemented-builds.json),
[source checksums](source-implemented-sha256.json) and the implemented memory
reports under `memory/`.

The full normal firmware host runner passes again on the active source. The
same differential, address/undefined-behavior and address/alignment sanitizer
checks described above also pass again against the active working tree; see
[implementation sanitizer validation](validation-implemented.json).

`npm run verify:deploy` passes after the final firmware edits: configurator
tests, 95 uploader tests, TypeScript, complete-site production build and all
16 frozen archive manifests. Tested revision is `eaf798c` plus the uncommitted
three-file firmware patch and these audit records. No deployed inputs changed
after this gate. These are implementation checks, with hardware validation and
release generation outside this task.

## Reproduction and Adoption

From the original baseline checkout:

```sh
python3 protocol/wide-arithmetic-audit/measure.py
python3 protocol/wide-arithmetic-audit/measure.py combined expanded maximal
python3 protocol/wide-arithmetic-audit/validate.py combined
python3 protocol/wide-arithmetic-audit/validate.py expanded
python3 protocol/wide-arithmetic-audit/validate.py maximal
python3 /private/tmp/macropad-wide-audit/combined/source/tests/run_host_tests.py
```

Run the host runner from the corresponding snapshot directory, as its compiler
arguments are relative to the project root. Repeat it for `expanded`/`maximal`
when reproducing their complete validation.

For independent adoption, apply only the chosen baseline-relative patch to
matching source, retain the documented range checks, and remeasure both boards.
The recommended patch has no configuration-format, migration, archive or
memory-placement dependency. Other source/compiler changes can alter savings.
The expanded/maximum patches additionally rely on the pointer-table and scanner
geometry bounds above. Any integration or deployment needs its own final checks.
