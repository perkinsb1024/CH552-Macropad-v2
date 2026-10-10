# V13 Persistent Modifier Implementation and Measurements

The firmware fits both hardware variants without removing any features. Relative
to the starting v12 source, the final six-key build adds 4 flash bytes and the
three-key build adds 6. Both gain one byte of linker-reserved stack capacity,
reaching 79 and 82 bytes respectively, above the requested 64-byte minimum.

## Scope and Checkpoints

The experiment branch is `experiment/fine-grained-brightness-control`.

| Checkpoint | Commit | Contents |
| --- | --- | --- |
| V12 baseline and agreed plan | `3d23690` | Firmware unchanged; exploratory plan recorded |
| Initial implementation | `521c3a0` | V13 modifier actions, relocated mouse hold and host coverage; exceeds flash limit |
| Firmware fit | `ef9b8db` | Shared dispatch, compact chord indexing and paged scratch/state placement; both builds fit |

Type `0x4` now encodes **Modifier toggle**, **Modifier down** and **Modifier up**,
with auxiliary values 0, 1 and 2 and a nonzero four-bit modifier parameter.
**Mouse hold** moves to full first byte `35`, sharing type `0x5` with existing
mouse toggle/down/up modes. Physical holds retain their release lifecycle and
reject in macros, rotation and both timer action slots. The complete binary
and transport reference is [config-v13.md](config-v13.md).

One persistent modifier mask combines with physical and temporary keyboard
modifiers. It follows the existing persistent mouse ownership and reset model.
Normal macro completion and repetitions do not release it; explicit up steps
can release modifiers midway through playback. Reports drain before dependent
macro steps proceed.

The web configurator, JSON/drafts, migration, archives and release artifacts are
unchanged. No device has been flashed. Modified brightness behavior remains
unverified by hardware testing.

## Build Measurements

All figures are bytes. Settings are CH55xDuino 0.0.25, bundled SDCC
build.13407_4, small memory model, size optimization, 24MHz, 148 USB DMA bytes,
and the real 14,336-byte application flash limit. Outputs are temporary builds.

| Hardware | V12 Flash | Initial V13 Flash | Final V13 Flash | Final Delta | Final Free |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,312 | 14,402 | 14,316 | +4 | 20 |
| Three keys | 14,308 | 14,398 | 14,314 | +6 | 22 |

The initial feature adds 90 flash bytes on both boards and exceeds the limit
by 66/62 bytes. Retained optimizations save 86/84 bytes relative to that
implementation. Combined final costs were measured directly; they are not
isolated costs for modifier down/up alone or estimates for future changes.

| Allocation | Six-Key Before / After | Three-Key Before / After | Delta |
| --- | --- | --- | --- |
| Internal footprint, including registers and bit regions | 178 / 177 | 175 / 174 | -1 |
| Linker-reserved stack capacity | 78 / 79 | 81 / 82 | +1 |
| Paged external RAM | 95 / 105 | 95 / 105 | +10 |
| Ordinary XSEG allocation | 373 / 365 | 364 / 356 | -8 |
| Separate absolute active image | 128 / 128 | 128 / 128 | 0 |
| USB DMA reservation | 148 / 148 | 148 / 148 | 0 |

Allocated external RAM increases by two bytes: the new modifier mask and the
existing mouse mask moved out of internal RAM. The eight-byte keyboard scratch
buffer moves from ordinary XSEG into paged RAM, without adding a buffer.
Total allocated RAM across internal and external regions increases by one byte.
The initial implementation added one paged byte and retained the baseline
internal allocation and stack capacity.

Paged RAM occupies `0x094–0x0FC`, leaving three bytes in page zero. Final ordinary
XSEG occupies `0x111–0x27D` on six keys and `0x0FD–0x260` on three keys. Allocation
sizes exclude linker gaps and the absolute active image at `0x300–0x37F`.
Build checks verify overlap and capacity using the actual address ranges.
Stack capacity is a linker reservation, not a runtime high-water measurement.

## Retained Optimizations

- Mouse and modifier toggle/down/up share one dispatcher block and mode
  calculation. Down clears selected bits then XORs them on; up only clears;
  toggle only XORs. Physical mouse hold leaves persistent state unchanged.
- Macro dispatch uses the contiguous type range after handling scroll and
  pointer movement. Physical holds cannot reach the playback queue.
- Modifier validation uses bounded subtraction to reject zero and upper
  parameter bits. Report initialization clears bytes 1–7 and assigns the
  persistent mask directly to byte 0.
- Chord indexing uses equivalent triangular-table arithmetic instead of
  iterating preceding rows. Its product fits eight bits for both geometries.
  Independent lexicographic tests cover every pair and swapped input order.
- Keyboard scratch and both persistent masks use paged external RAM. Smaller
  addressing instructions save flash; the mouse mask relocation increases stack
  capacity. Explicitly widening the scratch pointer for the existing USB API
  compiles to its exact address. Native builds check the page-zero bounds.

An attempted placement of additional globals in direct internal RAM was rejected
because SDCC could not allocate direct-RAM overlays. Retained paged placement
avoids that failure and fits the production limit. No feature flags were disabled.

## Validation and Reproduction

Normal and color-preview-disabled host suites pass, exercising both geometries
where applicable: configuration, actions, protocol, USB, macros, timers, input
behavior and seven memory-layout checks. New coverage includes all modifier
encodings and contexts, v12 rejection, relocated mouse hold rules, idempotence,
independent toggles, overlap with physical holds and temporary taps, brightness
report ordering under rejected/pending USB output, repetitions, persistent state,
direct consumer interleaving, mixed keyboard/mouse/scroll/pointer/text output,
explicit release before later text, layer cancellation, action-reset cleanup
under backpressure, and generation-change reassertion. The existing USB reset
path invokes configuration application, which calls `actionsClear()`.

Both final native builds pass the application limit and linked layout checks.
Inspect `firmware.mem`, `firmware.map` and `actions.asm` for allocation, placement
and scratch-pointer code generation.

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v13-final-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v13-final-three 24000000 148 14336 1
```

Baseline outputs from `3d23690` are under
`/private/tmp/macropad-v13-baseline-six` and
`/private/tmp/macropad-v13-baseline-three`. Initial outputs are under
`/private/tmp/macropad-v13-first-six` and `/private/tmp/macropad-v13-first-three`;
their linker failures still produced measurement files. These paths are local
measurement artifacts, not published firmware.
