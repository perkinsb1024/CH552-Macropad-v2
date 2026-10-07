# Macro feasibility and implementation experiments

The recommended design supports dynamically stored sequences, 1–16 executions
per trigger, and **Pause** steps. It fits both CH552 variants without removing
an existing feature. Linker stack capacity increases from 75/78 to 77/80 bytes,
above the requested 64-byte minimum. The implementation is on `experiment/macros`;
it is a host-tested firmware prototype, not a released firmware/editor feature.

The complete recommended wire format is in [config-v11.md](config-v11.md).
[macros-measurements.json](macros-measurements.json) contains all final measurements
and the recorded optimization probes, including failures. Baseline is revision
`4647e6d`, with SDCC 4.2.2 build.13407_4, 24 MHz, 148 USB DMA bytes and the real
14,336-byte application flash limit. No release artifacts were generated,
no hardware was flashed, and the web app was not changed.

## Designs compared

All sizes below come from separate temporary native builds. Flash and stack
columns show six-key / three-key bytes. The pair and counted comparisons omit
**Pause** so that storage/execution differences can be compared directly.

| Design | Sequence length | Executions per trigger | Flash bytes | Spare flash | Stack capacity |
| --- | --- | --- | ---: | ---: | ---: |
| Production v10 baseline | One action | 1 | 14,294 / 14,292 | 42 / 44 | 75 / 78 |
| Fixed pairs | Exactly two slots | 1 | 14,208 / 14,206 | 128 / 130 | 78 / 81 |
| Fixed pairs with repeats | Exactly two slots | 1–16 | 14,228 / 14,224 | 108 / 112 | 77 / 80 |
| Count in invocation | 1–16 actions | 1 | 14,220 / 14,218 | 116 / 118 | 80 / 83 |
| Count in invocation with repeats | 1–16 actions | 1–4 | 14,254 / 14,250 | 82 / 86 | 77 / 80 |
| Terminated sequences | Limited by remaining image space | 1 | 14,232 / 14,228 | 104 / 108 | 78 / 81 |
| Terminated sequences with repeats | Limited by remaining image space | 1–16 | 14,252 / 14,250 | 84 / 86 | 77 / 80 |
| Recommended: terminated, repeated, **Pause** | Limited by remaining image space | 1–16 | 14,306 / 14,302 | 30 / 34 | 77 / 80 |
| Recommended features, ordinary unaligned image | Same | 1–16 | 14,368 / 14,364 | -32 / -28 | 77 / 80 |

The unaligned comparison exceeds flash and does not produce a usable build.
The other designs pass both the real flash limit and memory-layout checks.

### Fixed pairs

Each definition occupies four configuration bytes. **Execute macro** carries an
absolute definition address; its high nibble is either reserved or the execution
count minus one. No definitions means no allocated macro data. One-action macros
use **Nothing** in the second slot. This is simple, but cannot represent the
three-action Spotlight example in one macro. Nested macros are rejected.

The final pair executor saves only about two dozen flash bytes relative to the
unrestricted executor with the same repeat option. That saving does not justify
restricting every macro to two slots.

### Counted sequences

The invocation's auxiliary nibble stores action count minus one. Its parameter
stores a six-bit absolute word address. The remaining two parameter bits can
encode 1–4 executions. Definitions are contiguous two-byte actions with no
terminators; the tail is aligned to an even byte, requiring at most one padding
byte. Bounds validation checks the complete counted span, and every tail action
is still validated independently. Overlapping action windows are allowed.

This is genuinely variable storage, but caps each invocation at 16 actions.
The repeat version has essentially the same code cost as unrestricted sequences
while offering fewer actions and repeats. The no-repeat version saves a little
flash and three stack bytes, but neither saving is needed. This alternative is
reproduced as experimental format 13; it is not compatible with v11 images.

### Terminated sequences: recommended

Type `0x4` becomes **Execute macro**. The parameter is an absolute image address;
the auxiliary nibble encodes 1–16 executions. A prospective editor can present
names or macro numbers and resolve those to addresses during encoding.

Definitions follow the existing string pool. Each step uses its ordinary two-byte
action encoding; `00 00` ends a sequence. There is no new header byte, macro count,
lookup directory, predefined slot allocation or fixed macro-length limit. The
last sequence may end implicitly at the image boundary. Without other dynamic
data, one layer leaves space for 48 steps on six-key or 52 on three-key hardware.

A standalone N-step definition normally costs `2*N + 2` bytes; undefined macros
consume zero configuration bytes. Text is still deduplicated in the normal
string pool. References may target any aligned tail step, including shared
suffixes or an empty terminator. This deliberately avoids imposing a directory
or expensive start-marker scan on firmware. Every pair is validated, including
unreferenced pairs; referenced steps cannot point into strings or layer records.

Playback uses four persistent control bytes regardless of how many macros are
defined: next address, start address, repetitions remaining, and a private mouse
toggle lane. Only one macro executes at a time. An invocation uses one normal
queue entry; steps stream directly from the active image instead of expanding
into the eight-event queue. A 40-step host test verifies that queue capacity does
not impose an eight-step limit. Long macros can delay later queued actions.

### Repeats and pauses

The repeat option adds roughly 20 bytes of flash and one runtime byte to the
unrestricted executor. It reloads the original steps, including string indices
and intrinsic mouse click counts, on each iteration. Repeating a single action
uses a one-action macro. It does not require duplicated configuration actions.

**Pause** uses full first byte `0x20`, an unused auxiliary value of low-nibble
**Nothing**. Its parameter is 0–255 units of 16 ms, allowing 0–4,080 ms. It reuses
the existing nonblocking deadline/phase state and adds no persistent RAM.

I also built 1 ms and 256 ms quantum variants. The 1 ms choice is slightly smaller
but caps a step at 255 ms; the 256 ms choice is coarse for short waits. The 16 ms
choice provides useful precision and a four-second range, matching the existing
fine timer quantum. Longer waits can use consecutive pause steps.

The example is **Keyboard tap** with GUI+Space → **Pause** for 256 ms → **Type Text**
with `chrome` → **Keyboard tap** with Enter. It adds 17 configuration bytes:
seven for `chrome\0` and ten for four steps plus their terminator. Changing the
execution count adds no configuration bytes. Host tests verify the action order
and pause timing; actual Spotlight/application readiness requires hardware/OS
validation and may need a different delay.

## Supported behavior and deliberate limits

- Keys, encoder press/rotation, chords, timer expiry and timer resume can invoke
  macros. Releasing a physical trigger does not cancel its sequence.
- Steps support the encoder-compatible action subset: taps, text, scroll/pointer
  taps, mouse toggles, consumer taps, layer selection, LED control, and **Pause**.
  Physical held outputs remain active alongside macro taps.
- Held actions and nested macros are rejected. There is no recursive stack or
  held-action ownership lifecycle inside a macro.
- Each queued step completes its accepted output/release before the next starts.
  Consumer tap release ordering and USB backpressure have explicit regressions.
  Held pointer/scroll repeats wait through gaps between macro steps.
- An actual effective-layer change, configuration application or normal USB
  reset/reconfiguration clears macro playback. A macro's own layer change aborts
  its remaining steps; selecting the same effective layer continues.
- Macro mouse toggles share one private lane independent of physical/timed
  toggle ownership. Consumer steps retain the existing latest-wins consumer lane.
- Immediate physical/timer layer, LED, toggle and consumer actions retain their
  existing dispatch semantics. They can interleave with or interrupt a macro;
  the macro is ordered within queued playback, not a lock on all device activity.
- Overflow rejects an invocation as one queue item and uses the existing saturated
  drop counters. Long sequences can still fill the queue with later invocations.

## RAM accounting and stack

| Allocation | Baseline six / three | Recommended six / three |
| --- | ---: | ---: |
| Occupied internal RAM, including banks/overlays | 180 / 177 | 179 / 176 |
| Paged external RAM | 108 / 108 | 108 / 108 |
| Ordinary XSEG | 496 / 487 | 369 / 360 |
| Separate absolute active configuration | 0 / 0 | 128 / 128 |
| Total allocated application xRAM | 604 / 595 | 605 / 596 |
| USB DMA reservation, separate from application xRAM | 148 / 148 | 148 / 148 |
| Linker stack capacity | 75 / 78 | 77 / 80 |

The other aligned macro designs use the same external allocation totals. Their
internal and stack differences are shown in the main table and measurement JSON.
No design in the final successful set reduces stack below the previous 75/78
baseline. Early allocation probes did reduce capacity or fail direct-RAM
allocation; those were discarded and remain in the probe log.

The active image is aligned at xRAM `0x300–0x37F`. SDCC does not include this
absolute allocation in XSEG size, so reporting only 369/360 bytes would undercount
RAM by 128 bytes. The build explicitly checks its address and overlap. The image
is completely loaded from DataFlash by `protocolInit` before use; absolute
storage need not be zeroed by the ordinary XSEG startup loop.

Alignment trades unused address-space gaps for smaller instructions. On six-key
hardware ordinary XSEG ends at `0x284`, leaving a 123-byte gap before the image
plus the existing 20-byte gap below XSEG. On three-key it ends at `0x267`, leaving
a 152-byte gap. Both layouts leave 128 physical bytes above the image. Allocation
increases by just one byte; the larger gaps reduce contiguous spare xRAM.

Stack figures are linker-reserved capacity, the same metric as the previous
75/78-byte builds. They are not measured runtime unused stack. The v10 hardware
high-water result cannot establish v11's runtime peak; no v11 hardware stack
measurement was performed.

## Optimization investigation

The first straightforward prototypes exceeded flash by roughly 350–470 bytes
and exposed direct-RAM allocation failures. A header-bit draft was discarded
because byte 5 bit 7 already controls transparent black LEDs. The final layout
preserves every header field and every released feature.

Retained changes:

1. Share main-loop-only validator context instead of passing image metadata at
   every action validation call. Reuse that image pointer throughout validation.
   This reduces repeated argument setup, register spills and internal allocation.
2. Read each string byte once during validation; walk layer binding addresses
   directly instead of recomputing each offset. Preserve the full bounds, ASCII,
   CRC, string-start, chord-order and timer validation checks.
3. Expose the fixed hardware key count to SDCC in the header. Host validation
   retains runtime geometry so the existing cross-variant tests remain valid.
4. Place hot macro/consumer state in the direct RAM freed by validation changes.
   Other state remains paged or indirect as appropriate.
5. Allow validated suffix references and empty sequences, avoiding a separate
   directory or start-marker scan while retaining all safety checks.
6. Dispatch queued immediate steps after handling scroll and pointer types. Held
   bindings never enter that queue, so one range check covers the remaining types.
7. Align the active image on page three, saving 62 bytes on each board in the
   final comparison. The unaligned build's flash failure demonstrates why this
   placement and its guard belong with the macro implementation.

Measured but rejected: packing button raw/stable state into bitmasks; moving USB
queue counters and timestamps into paged/indirect RAM; swapping paged action
arrays for those USB fields; alternate USB write pointer expressions; shrinking
the ASCII map; byte-only config bounds arithmetic; broader direct-RAM placements;
and selective/global callee-saves compiler options. Several looked promising
from C but grew SDCC output or caused direct-RAM allocation failures. Global
callee-saves grew the image to 15,422 bytes in its test. None is retained.

The [SDCC Compiler User Guide](https://sdcc.sourceforge.net/doc/sdccman.pdf),
sections 3.3.5 and 3.5, informed the memory/calling-convention probes. Decisions
come from the installed compiler's linked output rather than assuming the newer
manual produces identical code. No compiler upgrade, code-limit relaxation,
assembly rewrite, bootloader borrowing, timer-range reduction or release-feature
removal was needed.

## Validation, artifacts and reproduction

Run:

```sh
python3 protocol/build-macro-experiments.py
```

The script snapshots source into temporary directories and builds both variants
for nine designs, including the v10 baseline and the expected unaligned overflow.
It runs the complete ordinary host suite for each design. Counted sequences use
an additional dedicated wire-format probe; fixed/terminated sequences use the
full macro suite on both geometries. Each result has a source snapshot, native
map/memory/assembly files, build logs and host-test logs. Only successful native
builds emit a regular temporary `firmware.hex`; there is no release generation.

Coverage includes every invocation parameter/auxiliary combination, bad CRC,
invalid/nested/held steps, string storage, exact image ends, repeat counts 1–16,
40-step playback, USB blocked/pending behavior, queue order and overflow, chords,
rotation, timed invocation, cancellation, independent toggles, consumer release,
held pointer suppression, and pause limits/wraparound. The recommended macro
suite also passes AddressSanitizer and UndefinedBehaviorSanitizer on both
geometries. The extended build-layout suite checks the absolute image allocation.

Final comparison artifacts: `/private/tmp/macropad-macro-comparison-ej5l_br8`.
Earlier optimization snapshots: `/private/tmp/macropad-macros-71gdjd2l/`.
Temporary artifacts may be cleaned by the OS; the committed harness and
measurement JSON preserve the final comparison recipe and results.

The next product step is the v11 configurator: macro definitions/editor, action
selector, capacity calculation, address remapping, import/export and migration,
reachability/warnings, and matching hardware/OS validation. The existing v10
editor and checked-in uploader/release files are untouched by this investigation.
