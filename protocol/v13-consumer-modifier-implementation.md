# V13 Consumer Modifier Implementation and Measurements

The reduced-range consumer tap replaces persistent modifier actions at type
`0x4`. Each fine-brightness direction now occupies two action bytes instead of
seven macro bytes plus two binding bytes. Both native builds now fit the real
14,336-byte application flash limit: six keys use 14,326 bytes with 10 free;
three keys use 14,324 bytes with 12 free. Four small code optimizations save
36 bytes per variant from the first pass, without cutting any features or
changing allocated RAM or linker-reserved stack capacity.

## Scope and Encoding

Branch: `experiment/v13-8bit-consumer-with-modifiers`. Source checkpoint:
`c6d3ade` for the persistent modifier implementation, then `24ba81f` for the
first consumer implementation. The fitting firmware is the uncommitted
optimization and regression-test patch on `24ba81f`. The standalone format is [config-v13.md](config-v13.md).

| Field | Encoding |
| --- | --- |
| Type | `0x4` |
| Auxiliary nibble | Modifier mask 0–15: **Ctrl** = 1, **Shift** = 2, **Alt** = 4, **GUI** = 8 |
| Parameter byte | Consumer Page usage `0x01`–`0xFF`; zero rejects |
| Brightness examples | `64 6F` / `64 70` for Shift + Alt with up/down |

The action is a tap available to keys, encoder press/rotation, chords, both timer
fields and macro steps. **Mouse Hold** remains at `0x35`. The existing twelve-bit
consumer tap/hold actions and HID descriptor remain unchanged. There is no
lookup table or modified hold mode.

Temporary modifiers share the latest-wins consumer lane, combine with physical
keyboard holds and temporary keyboard taps, and release automatically after the
consumer release. The existing shared USB FIFO preserves report ordering:
keyboard modifiers, consumer press, consumer release, keyboard modifier removal.
Queue rejection retries the unfinished stage. Replacement releases the previous
modified consumer before changing masks, including replacement by an unmodified
tap or hold. Layer/configuration/action reset cleanup follows that same order.
Macros wait for output reports to drain before dependent steps advance.

The active configurator replaces the persistent modifier controls with
**Media / System with Modifiers**, an eight-bit control picker, custom usage input
and four modifier controls. JSON/drafts reject removed persistent action names.
V12 mouse holds still migrate to `0x35`; the existing frozen v12 archive and all
other archives remain unchanged. The experiment retains format number 13 because
this is an alternative to the unpublished persistent-modifier v13 experiment.
Earlier experiment v13 binary profiles are incompatible: their type `0x4` bytes
would now be consumer actions. Rebuild those profiles using the updated editor;
do not upload their old binary images to this firmware. Published v12 is unaffected.

## First-Pass Flash Costs

All sizes are bytes. All builds use CH55xDuino 0.0.25, SDCC build.13407_4, small
memory model, size optimization, 24MHz and 148 USB DMA bytes. The starting build
was reproduced from the clean current branch before edits.

| Hardware | Starting Persistent Modifiers | Removal Only | New Consumer Action | New Action vs. Removal | New vs. Starting | Overage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,316 | 14,268 | 14,362 | +94 | +46 | 26 |
| Three keys | 14,314 | 14,266 | 14,360 | +94 | +46 | 24 |

Removing persistent modifiers frees 48 bytes per variant while retaining the
applicable existing optimizations. The removal-only build has 68/70 bytes free.
Relative to the original unoptimized v12 source (`3d23690`, 14,312/14,308 bytes),
the combined retained optimizations and new action add 50/52 flash bytes.

Those first-pass production-limit builds failed at linking, as expected for
the measured overage. Separate temporary builds with a 16,384-byte linker limit complete to allow the
usual linked memory/startup checks and generated-code inspection; they report
identical flash sizes. The larger limit is only for measurement and does not
increase the actual usable application flash. Those first-pass images do not fit
with the current bootloader layout.

## Optimized Flash Costs

| Hardware | First Pass | Optimized | Flash Saved | Free of 14,336 Bytes |
| --- | ---: | ---: | ---: | ---: |
| Six keys | 14,362 | 14,326 | 36 | 10 |
| Three keys | 14,360 | 14,324 | 36 | 12 |

Final builds link successfully with the real application limit and pass the
native memory/startup layout checks. Relative to removal-only firmware,
the combined consumer action and new optimizations cost 58 flash bytes per
variant. Relative to the persistent modifier implementation, the net increase
is 10 bytes per variant. All features and configuration encodings are preserved.

Four changes in `src/actions.c` account for the savings:

- Read the pending consumer auxiliary nibble once, interpret it as the modifier
  mask for type `0x4`, and otherwise reuse it as the twelve-bit usage's high nibble.
  The action bytes remain intact so rejected queue writes can retry.
- Inside the consumer switch cases only, test bit 3 to distinguish hold type
  `0x8` from tap types `0x4` and `0x7`, replacing repeated full-type comparisons.
- Initialize consumer ownership to zero and assign the held input conditionally,
  avoiding the conditional expression's unnecessary promoted intermediate.
- Stop comparing keyboard reports at the first difference and use the loop
  index instead of a separate changed flag. Report copying and queue retry
  behavior are unchanged.

Individual savings are compiler-layout dependent. The local optimization
notebook records both variants' isolated and combined measurements. The full
combination saves 36 bytes; isolated savings must not be assumed additive.

## Measured RAM and Stack

| Allocation | Starting Six / Three | Removal Six / Three | Final Six / Three |
| --- | --- | --- | --- |
| Internal footprint, including registers and bit regions | 177 / 174 | 177 / 174 | 177 / 174 |
| Linker-reserved stack capacity | 79 / 82 | 79 / 82 | 79 / 82 |
| Paged external RAM | 105 / 105 | 104 / 104 | 105 / 105 |
| Ordinary XSEG allocation | 365 / 356 | 365 / 356 | 365 / 356 |
| Absolute active configuration | 128 / 128 | 128 / 128 | 128 / 128 |
| USB DMA reservation | 148 / 148 | 148 / 148 | 148 / 148 |

The new action adds one paged RAM byte to removal-only firmware. Its temporary
consumer mask replaces the removed persistent modifier byte, so total allocated
RAM is unchanged relative to the starting branch. Stack capacity remains 79/82
bytes, one byte above the original v12 78/81 reserves. This is linker-reserved
capacity, not a runtime high-water measurement.

Final PSEG is `0x094–0x0FC`, leaving three bytes in page zero. XSEG occupies
`0x111–0x27D` on six keys and `0x0FD–0x260` on three. The absolute configuration
is `0x300–0x37F`. Total allocated external RAM is 746/737 bytes of 1,024, leaving
278/287 bytes unallocated across gaps and free regions; most of that space
cannot be addressed with existing page-zero pointers. Layout checks pass.

## Retained Optimizations

The paged keyboard scratch buffer, explicit xdata USB pointer conversion,
paged persistent mouse mask, arithmetic chord indexing and contiguous queued
immediate-action range remain. Keyboard byte zero is initialized directly from
temporary consumer modifiers, rather than the removed persistent mask.
The shared mouse/modifier state pointer is removed; mouse state uses the existing
clear/XOR calculation directly.

During the first pass, a temporary comparison using the original mouse
up/down/toggle branches, with all other first-pass firmware identical, measured 14,368/14,366 bytes. The retained
mouse-only clear/XOR calculation therefore saves six flash bytes on each variant
without changing RAM or stack. The fitting pass preserves that calculation
and adds the four small optimizations listed above. The local `potential_optimizations.md` records portability
and independent application details.

## Validation and Reproduction

Host suites pass with and without color preview, including both geometries,
configuration, actions, protocol, USB, macros, timers, input and seven linked-layout
regressions. Consumer tests cover all sixteen masks, usage boundaries, report
ordering, each queue-rejection boundary, overlap with physical holds and keyboard
taps, replacement by tap/hold/modified actions, all sixteen high nibbles of
twelve-bit taps and holds, interrupted twelve-bit holds,
macro repetitions/draining, rotation, chords, both timer fields and layer/reset
cleanup. The first pass's 523 web tests passed, covering codec/firmware agreement, JSON/drafts, v12
migration and editor restrictions. The web build includes archive checksum verification.

Temporary builds and logs are under `/private/tmp/macropad-consumer-`:
`start-six/three`, `removed-six/three`, `final-six/three`, `measure-six/three`
and `original-mouse-six/three`. These are the first-pass measurements; `final`
failed against the real application limit, while `measure` and `original-mouse`
used the measurement-only larger limit.

The fitting pass's sources, builds and logs are under
`/private/tmp/macropad-consumer-fit/`. The `baseline`, `hold-bit`, `high-nibble`,
`both`, `owner-only`, `owner-branch` and `changed-break` comparison builds use the
measurement-only larger limit. `final-six` and `final-three` link successfully
at the real 14,336-byte limit.

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-consumer-fit/final-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-consumer-fit/final-three 24000000 148 14336 1
```

The fitting pass generated no release artifacts, flashed no firmware and
created no commit. The previous persistent modifier workflow worked on macOS;
the new self-contained action still needs hardware verification.
