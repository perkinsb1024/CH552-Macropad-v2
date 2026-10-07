# Final v11 macro implementation and validation

The dynamic, repeated, paused path is implemented in firmware and the web
configurator on `experiment/macros`. The standalone final wire/editor reference
is [config-v11.md](config-v11.md). The original comparison results and all
retained/rejected optimization work are in [macros-findings.md](macros-findings.md)
and [macros-measurements.json](macros-measurements.json).

## Final memory measurements

SDCC 4.2.2 build.13407_4, 24 MHz, 148 USB DMA bytes, actual 14,336-byte
application limit. Native outputs are temporary; releases are unchanged.

| Resource, bytes | Six-key | Three-key |
| --- | ---: | ---: |
| Flash used | 14,304 | 14,300 |
| Flash remaining | 32 | 36 |
| Occupied internal RAM (including register banks/overlays) | 179 | 176 |
| Paged external RAM | 108 | 108 |
| Ordinary XSEG | 369 | 360 |
| Absolute active image | 128 | 128 |
| Total allocated application external RAM | 605 | 596 |
| USB DMA, additional | 148 | 148 |
| Linker stack capacity | 77 | 80 |

The final code allocation improves flash by two bytes on each board relative to
the initial dynamic/repeat/pause prototype. RAM and stack capacity are unchanged.
Compared with v10 baseline `4647e6d`, stack capacity increases by two bytes on
each board and allocated application xRAM increases by one byte. Stack capacity
is not a runtime high-water measurement; v11's hardware peak is still unknown.

The active image occupies `0x300–0x37F` and is absent from XSEG's reported size.
The layout guard checks its exact address, hardware bounds and overlap with
ordinary/paged/USB allocations. Six-key XSEG is `0x114–0x284`; three-key XSEG
is `0x100–0x267`. Both leave 128 physical xRAM bytes above the active image.
The zeroing loop does not initialize absolute storage; `protocolInit` loads all
128 bytes before image use. Preserve that initialization contract if relocating it.

## Retained implementation choices

- No macro count, directory or permanently reserved definition slots. Definitions
  occupy the tail after strings. Each step costs two bytes; a zero pair ends the
  sequence. The image boundary can terminate the final nonempty sequence.
- Absolute byte references avoid a runtime directory/search. Tail-relative
  alignment permits odd starts and shared suffixes. Validate all tail pairs,
  even unreachable ones; reject nested macros and release-dependent actions.
- Four persistent control bytes track next/start address, remaining repeats and
  a private mouse-toggle lane. Each invocation consumes one queue entry; steps
  stream directly, so a sequence longer than eight actions cannot overflow the
  queue merely by expanding. Later invocations can still fill it and drop.
- **Pause** reuses the existing deadline/phase state; its 16 ms quantum and maximum
  4080 ms duration preserve wrap-safe 16-bit deadline comparisons. No new timer
  or pause state is allocated. Inputs/USB/LEDs continue polling while it waits.
- Consumer tap releases drain before the next macro step. Held pointer/scroll
  repeat checks include active macro state, preventing repeats in inter-step gaps.
- Shared main-loop validator context avoids repeated argument setup/register
  spills. Layer bindings are walked directly; string bytes are read once.
  Native key count is a compile-time constant, while host tests retain both geometries.
- Hot state uses direct RAM freed by validation; other fields remain indirect or
  paged. Page-aligned active-image addressing saves 62 flash bytes in the
  original aligned/unaligned comparison. Do not remove the alignment guard.
- Queued immediate steps use one range check after pointer/scroll handling;
  held actions never enter that queue. Macro toggles use their private lane.
  Consumer tap/hold dispatch tests parity: final types 7/8 mean odd tap/even hold.
  This parity check was inverted during renumbering; auxiliary usage bits stay intact.

The earlier pair/count/quantum/RAM-placement alternatives, including failed
flash/direct-RAM fits, remain documented in the investigation. Its reproduction
harness pins prototype `38e5816` and baseline `4647e6d`; subsequent product edits
cannot silently change those historical results. The initial local type-4 macro
encoding is relevant only to those experiment artifacts. Final v11 uses type F.

## Web configuration and migration

The final action map shifts old types 5–F down one; **Execute macro** is F,
**LED control** is E, and **Pause** is full byte 20. The decoder interprets the
source version before remapping. Existing auxiliary values/parameters, consumer
usages, click counts, layer history targets, held flags and axes are preserved.
V10 migration adds no profile bytes. V7–v9 timers still grow from five to six
bytes and retain their exact durations. Older JSON/drafts use semantic action
names; v11 drafts recover them without overwriting their old namespaces.

Optional numbered macro definitions support step editing/reordering/deletion,
shared strings, invocation repeats, pauses, clipboard/drag swaps, undo/redo,
layer target remapping, storage validation and read-only live view. Removing a
macro clears its invocations and shifts later indices in all binding types.
All absolute addresses are rebuilt during encoding. Layer-route analysis follows
steps only until an effective layer change cancels the sequence.

A referenced empty macro survives binary readback. Unreferenced empty definitions
have no distinct wire representation and may disappear on readback. Firmware
allows suffix references; the editor can expand a noncanonical shared suffix
into a separate definition, retaining semantics but possibly increasing storage.
An oversized decoded/imported profile stays editable/exportable and cannot be saved
until the user reduces it. These limits are explicit in the format reference.

The v10 editor/live view was frozen before v11 web changes, with provenance and
checksums. Older firmware redirects to matching archives. The uploader build
still bundles the existing v10 release files and now links them to the v10
archive. No firmware release-generation command was run.

## Verification and reproduction

```sh
python3 tests/run_host_tests.py
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v11-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v11-three 24000000 148 14336 1
cd webapp
npm test
npm run build
```

Both native builds and all firmware host suites pass. The web suite checks the
actual compiled firmware validator independently of TypeScript decoding, including
all shifted action codes in keys/chords/rotation/timers, full macro storage tails,
repeat bounds, odd alignment, suffixes, empty sequences, invalid/nested/held tail
records, storage relocation, deduplicated text, JSON/drafts and simulated upload.
Editor tests cover add/edit/reorder/delete, reference renumbering, undo/redo,
layer remapping, held/nested restrictions and repeat/pause controls.
The production build includes archive checksum verification and the existing
web uploader bundle. All 467 web tests pass, including local archive HTTP checks. The final macro
suite also passes AddressSanitizer and UndefinedBehaviorSanitizer on both boards.

Chrome visual validation used a separate six-key simulator tab: added a macro,
selected **Pause**, verified the 256 ms slider and storage accounting, assigned
**Execute macro** to a key, entered 16 repeats, and saved/read back all 128 bytes.
No physical macropad was modified during this task.

Hardware validation remains: both board geometries, actual stack high-water,
OS readiness delays for Spotlight/typing, consumer releases and held-output
coexistence under USB backpressure, long/repeated macros with later queued input,
queue-drop counters, layer/reset cancellation and migration of real v10 flash.
The existing v10 stack measurement does not establish the new runtime peak.

## Configurator layer-switch restrictions

Layer-switching actions must finish a macro, including absolute/relative and
one-shot variants even when their target might already be active. Every
invocation of such a macro must use repeat count 1. The editor disables **Add
step**, explains the rule in the panel/sidebar, and blocks saving invalid
ordering or repeat counts. JSON import applies the same validation. Existing
invalid device profiles remain editable for repair. This is a configurator-only
restriction; firmware, binary encoding, flash, RAM and stack capacity are unchanged.
A separately triggered layer change still cancels an active macro.
