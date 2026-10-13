# V14 Hold Implementation Findings

The initial sections record firmware `67b34d0`. The Action Ordering Follow-Up
below records the subsequent reordered source; use [Configuration V14](config-v14.md)
for the current allocation.

Recorded 2026-10-11 on `experiment/modifier-media-hold`, starting from main
`934fa05b9ea3977bb49d5658bda00d44d23caca2`. Both requested features fit using
optimization alone. No existing features were cut or degraded, every action
record remains two bytes, and RAM and stack allocations remain unchanged.

## Source Checkpoints

| Commit | Result |
| --- | --- |
| `663425c` | Modified consumer holds, with absolute and momentary layers sharing type 9; before flash fitting |
| `b4da187` | Relative layer holds, with all six layer modes sharing type 9; before flash fitting |
| `67b34d0` | Optimized, tested firmware fitting the real limit on both variants |

The initial investigation is preserved in
[Modified Consumer Hold Investigation](modified-consumer-hold-investigation.md).
Its proposed type numbers describe earlier prototypes. The fitted source uses
the provisional allocation in [Configuration V14](config-v14.md), which is a
complete binary/protocol reference. Configurator, migration and JSON/draft changes
are deferred at the user's request pending action reordering. No active editor,
configurator archive or release file was changed.

## Resulting Behavior and Encoding

**Media / System Hold with Modifiers** uses provisional type 8: the auxiliary
nibble holds the four modifier bits and the parameter is a nonzero eight-bit
Consumer Page usage. All sixteen masks, including zero, are accepted. It works
on physical keys, encoder press and chords; rotation, timers and macros reject
it. `68 6F` holds **Shift** + **Alt** with Brightness Up. Existing modified taps
retain type 4 and twelve-bit unmodified taps retain type 7. Twelve-bit unmodified
holds move from type 8 to type A without losing their usage range.

All consumer actions share the existing latest-wins lane. Keyboard modifiers
are queued before the consumer press; the consumer release is queued before
modifier cleanup. Brief presses and every output stage retry under USB
backpressure. Physical keyboard holds and taps keep their own modifier/key
contributions. Held consumer bindings survive layer changes. Replacing an owner
ends its modifier contribution; superseded holds are not restored. An older
ordinary tap's pending release is preserved before a modified hold starts.

**Set Layer**, **Momentary Layer** and **Relative Layer** share type 9. Auxiliary
bits 0–1 select persistent, one-shot or hold (`00`, `01`, `10`); bit 2 selects
relative, and bit 3 is reserved. Full first bytes are `09`, `19`, `29`, `49`,
`59` and `69`. Type B is free and rejected during validation. GET_INFO advertises
format 14 and action mask `0xF7FF`; HID transport remains version 1.

A relative hold resolves its signed -6–+6 offset once, with wraparound, from the
selected base layer before consuming an armed one-shot. It stores that absolute
target in the existing per-input state. Changes beneath the overlay do not move
the target. The newest layer hold wins; releasing it restores an older held
layer, otherwise the current base. Physical relative actions retain their prior
base-layer reference semantics; timer/macro relative actions use the effective
layer. No new runtime storage is needed.

## Measured Flash Costs

All figures are measured native SDCC output in bytes, using CH55xDuino 0.0.25,
SDCC build.13407_4, the small model with size optimization, 24MHz and 148 USB DMA
bytes. The real application limit is 14,336 bytes. Over-limit candidates were
linked with a temporary 16,384-byte measurement limit; only the final builds
were accepted using the real limit.

| Candidate | Six Keys | Three Keys | Result |
| --- | ---: | ---: | --- |
| Main baseline | 14,328 | 14,326 | 8/10 bytes free |
| Modified holds, two layer types (`663425c`) | 14,356 | 14,354 | 20/18 bytes over |
| Both features, two layer types | 14,390 | 14,386 | 54/50 bytes over |
| Both features, one layer type (`b4da187`) | 14,380 | 14,378 | 44/42 bytes over |
| Final optimized source (`67b34d0`) | 14,332 | 14,330 | 4/6 bytes free |

Sharing all layer modes saves 10/8 bytes compared with the measured two-type
implementation of both features. It also frees an additional action type.
The final optimizations save 48 bytes on each variant against the initial
one-type implementation. Relative to main, all new features together add only
4 bytes on each variant. These are costs of the measured implementations, not
minimum possible costs or additive estimates for future versions.

## Optimization Measurements

Each row's savings are against its named parent, not against the preceding row.
Temporary sources, builds, logs, parent-relative patches and `measurements.json`
are preserved under `/private/tmp/macropad-v14-fit/`.

| Candidate | Parent | Six Keys | Three Keys | Saving vs. Parent | Decision |
| --- | --- | ---: | ---: | --- | --- |
| `ascii-shift` | `one-layer-type` | 14,374 | 14,372 | 6/6 | Included |
| `relative-bounds` | `one-layer-type` | 14,372 | 14,368 | 8/10 | Included |
| `media-bits` | `one-layer-type` | 14,370 | 14,368 | 10/10 | Included |
| `layer-validation` | `one-layer-type` | 14,376 | 14,374 | 4/4 | Included |
| `combined-opts` | `one-layer-type` | 14,352 | 14,348 | 28/30 | Combines the four above |
| `consumer-release` | `combined-opts` | 14,348 | 14,344 | 4/4 | Included |
| `layer-pending` | `combined-opts` | 14,348 | 14,344 | 4/4 | Included |
| `keyboard-copy` | `combined-opts` | 14,356 | 14,352 | -4/-4 | Rejected |
| `owner-assign` | `combined-opts` | 14,352 | 14,348 | 0/0 | Rejected |
| `second-combined` | `combined-opts` | 14,344 | 14,340 | 8/8 | Combines release and pending changes |
| `consumer-validation` | `second-combined` | 14,332 | 14,330 | 12/10 | Included; final result |
| `layer-upper` | `second-combined` | 14,356 | 14,352 | -12/-12 | Rejected |
| `short-release` | `second-combined` | 14,338 | 14,334 | 6/6 | Measured only; not needed |
| `crc-mask` | `second-combined` | 14,348 | 14,346 | -4/-6 | Rejected |

### Included Changes

In `src/actions.c`, `ascii-shift` extracts the ASCII shift bit using
`((usage >> 2) & 0x20)` instead of a conditional. This is independently applicable
to main and does not depend on v14 encoding, but its measured saving is from the
v14 candidate; a main-only application requires fresh size measurement.

In `src/config.c`, `relative-bounds` uses unsigned byte wrapping:
`(uint8_t)(param + 6) <= 12`. It accepts exactly the existing -6–+6 range.
It can independently replace main's relative-layer parameter check; remeasure
and exhaust all byte values after applying.

`media-bits` assigns modified hold to type 8 and unmodified hold to type A.
Modified consumer types 4/8 have both low bits clear; bit 3 distinguishes holds
8/A from taps 4/7; `(type & 0xD) == 8` recognizes the two consumer holds.
Dispatch uses these classifiers only for consumer state or validated action
types. A compile-time guard enforces the allocation assumptions. This change
is format-dependent and cannot be applied as a compatible main optimization.
An action reorder must update the classifiers and guard, then remeasure.

`layer-validation` combines the reserved-bit and context restriction into
`aux & (8 | (rotation << 1))`, while separately rejecting mode 3. The validator
normalizes the rotation/timer/macro context to 0/1. This depends on the new layer
encoding; apply with consolidation, rather than as a standalone v13 change.

`consumer-release` factors the unmodified-hold check so it is evaluated once,
then retains the required release ordering and ordinary-tap pending release.
It depends on the modified-hold implementation; it is not an independently
measured main optimization. `layer-pending` moves a duplicated assignment of
`layerSelectionPending = 1` to the shared layer case. It depends on the shared
layer dispatcher and can be applied independently after consolidation.

`consumer-validation` shares a single validator for all four consumer forms:
reject bit-3 holds in nonphysical contexts, then allow a nonzero parameter or a
nonzero usage-high nibble for unmodified forms. It preserves the complete
12-bit range and rejects zero modified usages. It depends on `media-bits`' type
allocation and must be adapted if action types change.

### Rejected and Unselected Changes

`keyboard-copy` skips copying the already-equal prefix of the keyboard scratch
buffer, but SDCC's generated code grows by 4 bytes. `owner-assign` reverses the
order of conditional owner assignment and gives no saving. `layer-upper` uses a
context-dependent maximum mode instead of the bit mask and grows by 12 bytes.
`crc-mask` replaces the two excluded CRC byte comparisons with `(i & 0xFE) == 6`
and grows by 4/6 bytes. None of these changes is in the result.

`short-release` replaces the hold-release ternary with zero initialization and a
conditional assignment. It saves 6 bytes in its measured parent, but was not
combined with the chosen final validator or given final host validation. It
remains an unused candidate, not an independently validated additional saving.
All candidates retain the same RAM/stack layout in native measurement builds.

## Memory and Validation

| Allocation | Six Keys | Three Keys | Change vs. Main |
| --- | ---: | ---: | --- |
| Stack capacity | 81 | 84 | None |
| PSEG | 105 | 105 | None |
| Ordinary XSEG | 365 | 356 | None |
| Absolute active image | 128 | 128 | None |
| USB DMA | 148 | 148 | None |
| Total allocated external RAM | 746 | 737 | None |

PSEG remains `0x094–0x0FC`; ordinary XSEG remains `0x111–0x27D` on six keys and
`0x0FD–0x260` on three keys. The active image remains `0x300–0x37F`. Linker stack
capacity is unchanged; no new paged placement, absolute-address or interrupt
sharing assumptions were introduced. Existing keyboard scratch access still
emits `mov dptr,#_nextKeyboard`.

Both host runs pass, with preview enabled and disabled. Both real-limit native
builds pass layout/startup checks. The new suites cover every modifier mask and
usage byte; every layer auxiliary/parameter combination; all configured layer
counts, starts and relative offsets; encoder-press acceptance and rotation,
timer and macro rejection; report backpressure; ordinary-tap pending release;
physical key/modifier overlap; consumer replacement and ownership; layer
retention; nested layer holds; one-shot consumption; chord release; reset and
report-generation behavior. Existing macro, timer, input, keyboard, mouse,
scroll, LED and USB regressions pass, along with seven layout tests and nineteen
bootloader tests.

Final checks:

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v14-fit/final-0 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v14-fit/final-1 24000000 148 14336 1
```

Hardware validation is outstanding. No flashing or release generation was
performed. Web tests and production builds were not run because the v13
configurator was intentionally left unchanged; v14 codec/editor migration is
not part of this result. The local experiment rules were recorded in the
checkout's excluded `AGENTS.md`, and optimization findings were also saved in
the excluded `potential_optimizations.md`.

## Action Ordering Follow-Up

The subsequent action-ordering task starts from documentation commit `4d7f3f1`
and firmware `67b34d0` on `experiment/modifier-media-hold`. Source changes are in
the working tree; the user requested implementation and measurement for this
follow-up, without a new commit request. The earlier sections retain the initial
implementation's measurements and type allocation.

The accepted proposal fits without feature cuts or further optimization. The
unused alternatives with Reserved at D or E were not needed or measured.

| Type | Current Action |
| --- | --- |
| `0` | **Nothing**; auxiliary `1` = **Pause**, auxiliary `2` = **Type Text** |
| `1` | **Keyboard Tap** |
| `2` | **Keyboard Hold** |
| `3` | **Mouse Click** |
| `4` | **Mouse Toggle / Down / Up / Hold** |
| `5` | **Scroll Tap / Hold** |
| `6` | **Single-Axis Mouse Movement** |
| `7` | **Combined Mouse Movement** |
| `8` | **Consumer Tap**, twelve-bit usage |
| `9` | **Consumer Hold**, twelve-bit usage |
| `A` | **Media / System with Modifiers**, tap, eight-bit usage |
| `B` | **Media / System Hold with Modifiers**, eight-bit usage |
| `C` | **Set Layer / Momentary Layer / Relative Layer**, all six modes |
| `D` | **LED Control** |
| `E` | **Execute Macro** |
| `F` | Reserved; all auxiliary/parameter combinations reject |

In `src/actions.c` and `src/config.c`, media types 8–B now use bit 0 to select
hold and bit 1 to select modified eight-bit usage. `(type & 0xD) == 9` recognizes
both consumer holds, while pointer types 6/7 retain their even/odd decoding and
shared mask. The compile-time guard checks the new consumer and pointer IDs.
Macro playback's immediate-action cutoff now starts at **Mouse Toggle**, type 4,
which includes persistent mouse modes and all consumer/layer/LED actions after
scroll/pointer processing. Leaving that cutoff tied to the modified-consumer
ID would incorrectly process persistent mouse and unmodified media macro steps;
the existing macro drag regression caught this during implementation. The
incorrect intermediate builds are excluded from the accepted measurements.

Type-0 validation uses the named **Pause** and **Type Text** auxiliary values;
playback uses their full first-byte constants. GET_INFO advertises `0x7FFF`,
derived from the reserved ID, with transport 1 and format 14 unchanged. Header
constants, raw modified-media/chord test fixtures and protocol assertions were
updated. The complete v14 reference now describes this map, including all v13
conversion requirements. Earlier unpublished v14 images require source-aware
conversion or recreation; their shared version byte does not identify allocation.

| Build | Six-Key Flash | Three-Key Flash | Free Bytes, Six/Three | Stack, Six/Three |
| --- | ---: | ---: | --- | --- |
| Before reorder (`67b34d0`) | 14,332 | 14,330 | 4/6 | 81/84 |
| Reordered firmware | 14,330 | 14,328 | 6/8 | 81/84 |

The reorder saves 2 flash bytes per variant. PSEG (105), ordinary XSEG (365/356),
absolute active image (128), USB DMA (148) and stack capacity are unchanged.
These savings depend on the compiler and complete allocation; they are not an
independent main optimization. Applying the reorder to main requires the full
v14 feature/format work and source-aware migration, followed by size measurement
and validation. No additional optimization candidates or feature degradations
were applied.

Both native builds use the real 14,336-byte limit and pass layout/startup checks.
Host suites pass with preview enabled and disabled. New validation coverage
exhausts every reserved-type auxiliary/parameter combination across key, rotation,
chord, timer expiry/resume and macro-tail contexts on both variants. Raw type-0
validation verifies the **Pause**-before-**Type Text** auxiliary order, including
string-start bounds. Existing playback tests verify text, pauses, macros, drag,
all consumer forms, modifier ownership/backpressure and layer holds.

Artifacts are preserved under `/private/tmp/macropad-v14-ordering/`: source
snapshots, `ordering.patch`, final build directories `final-0` and `final-1`,
logs `final-0.log`, `final-1.log`, `final-host.log` and
`final-host-no-preview.log`. Toolchain and memory placement match the initial
implementation. Hardware validation remains outstanding. Configurator/migration
code, archives and released firmware remain unchanged.
