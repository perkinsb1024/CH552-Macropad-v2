# Global Auto-Sleep Comparison

Measured October 14, 2026 on `experiment/v15-remove-per-layer-auto-sleep`.
Baseline: `a91cb995efa57f7290328bf46d26d809547a0bf9`, with a clean working tree.
This is an isolated firmware experiment. No candidate has been selected or
applied to the active source, configurator or current protocol reference.

All four candidates remove per-layer sleep gating and implicit layer reset/wake
behavior. Layer-option bit 1 is ignored again. One global sleep timer runs
independently of layer selection. Physical presses and completed encoder detents
still reset it; the new explicit action supplies the programmable exception.

## Final Measurements

All values are bytes. Six-key values precede three-key values in paired columns.
Flash delta compares each hardware variant with its own baseline; negative is a
saving. Stack means linker-reserved capacity, not runtime high-water usage.

| Candidate | Timeout Layout | Action Behavior | Flash Six/Three | Delta Six/Three | Free Flash Six/Three | Total External RAM Six/Three | Stack Six/Three |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | Per-layer, existing four durations | No explicit action | 14,222 / 14,218 | 0 / 0 | 114 / 118 | 752 / 743 | 90 / 93 |
| A | Global enable bit; 15/30/60/120 minutes | Reset and wake | 14,212 / 14,208 | −10 / −10 | 124 / 128 | 752 / 743 | 90 / 93 |
| B | Global enable bit; 15/30/60/120 minutes | Select reset-only or reset-and-wake | 14,226 / 14,222 | +4 / +4 | 110 / 114 | 752 / 743 | 90 / 93 |
| C | Off/10/15/30/45/60/90/120 minutes | Reset and wake | 14,222 / 14,218 | 0 / 0 | 114 / 118 | 752 / 743 | 90 / 93 |
| D | Off/10/15/30/45/60/90/120 minutes | Select reset-only or reset-and-wake | 14,236 / 14,232 | +14 / +14 | 100 / 104 | 752 / 743 | 90 / 93 |

All candidates retain PSEG 105, ordinary XSEG 365/356, the 134-byte absolute
active/runtime buffer, and 148 USB DMA bytes. Internal allocations leave the
same stack capacity as baseline. No RAM is added or reclaimed. The saved image
remains 128 bytes; the setting changes consume one previously reserved header
bit and no additional DataFlash bytes. A dedicated keep-awake timer still costs
six saved bytes and one of four user timer slots; a step added to an existing
macro costs two bytes.

The cheapest option saves only 10 bytes after fitting the explicit action.
Candidate C supplies the additional durations at exactly the baseline flash
cost. Candidate B or D adds 14 bytes over its corresponding single-behavior
candidate. The principal benefit is simpler behavior rather than a large flash
recovery. C is a reasonable choice if that simplification and the expanded
intervals are preferred; A maximizes the measured saving.

## Action Semantics and Encodings

The auxiliary field is a nibble in the first action byte. Type `0x0` plus
auxiliary `0x4` gives full first byte `0x40`.

| Candidates | First Byte | Parameter | Behavior |
| --- | --- | --- | --- |
| A, C | `0x40` | `0x00` | Reset the sleep countdown and wake existing auto-sleep |
| B, D | `0x40` | `0x00` | Reset the sleep countdown and wake existing auto-sleep |
| B, D | `0x40` | `0x01` | Reset only; preserve existing auto-sleep and pending physical wake |

Other parameters reject. Other unsupported type-0 auxiliary values remain
invalid. Existing **Nothing**, **Pause** and **Type Text** encodings are preserved.
The new action works on keys, encoder buttons/directions, chords, timer expiry,
**On Next Input**, and macro steps. A macro executes it in sequence, rather than
interpreting it as text; repetition and following steps continue normally.

Both behaviors restart only the built-in timer's elapsed and fractional phase.
They do not reset user timers, execute or clear their pending **On Next Input**
actions, manufacture input, change layers, or produce host input reports.

Reset-and-wake restores **Both as Configured** only if a built-in sleep expiry
is pending. It clears that pending sleep, so **Consume Wake Input** does not
consume the next physical input on behalf of that cleared sleep. User timers
can still consume the next physical input independently. Resetting while awake
does not overwrite a manual lighting policy or temporary effect.

The action does not request a layer indication. Restoring configured policies
can make **Always On** visible again, but does not replay an expired timed or
blink indication. Ordinary physical wake retains the configured **Show Layer
Indicator** behavior. Reset-only preserves the pending physical wake and its
consumption/reminder settings.

A name such as **Wake and Reset Sleep Timer** makes the single-behavior action
explicit. For B/D, **Reset Sleep Timer** with a **Wake If Asleep** option could
represent the two encodings. These are naming suggestions; no UI is changed.

## Header Layouts

Both layouts use header byte 6, accept bits 0–5, and reject bits 6–7. CRC coverage
and header length remain unchanged. Defaults keep auto-sleep off and retain
physical wake consumption and the layer reminder.

### Candidates A and B

| Bits | Meaning |
| --- | --- |
| 0–1 | Timeout: 0 = 15, 1 = 30, 2 = 60, 3 = 120 minutes |
| 2 | **Consume Wake Input** |
| 3 | **Show Layer Indicator** |
| 4 | **Dim Instead of Off** |
| 5 | Global **Auto-Sleep** enable |
| 6–7 | Reserved, zero |

Default byte: `0x0D` (disabled, remembered 30-minute selector, consume and reminder
on). Enabled 30-minute default: `0x2D`.

### Candidates C and D

| Bits | Meaning |
| --- | --- |
| 0–2 | Timeout: 0 = Off, 1 = 10, 2 = 15, 3 = 30, 4 = 45, 5 = 60, 6 = 90, 7 = 120 minutes |
| 3 | **Consume Wake Input** |
| 4 | **Show Layer Indicator** |
| 5 | **Dim Instead of Off** |
| 6–7 | Reserved, zero |

Default byte: `0x18` (Off, consume and reminder on). Enabled 30-minute default:
`0x1B`. Off occupies a selector, rather than retaining a separate duration in
the firmware's saved header.

Intervals use the existing fine clock and 4.096-second ticks. Each duration uses
the smallest integer tick count at least as long as its nominal duration.

| Minutes | Ticks | Tick Interval |
| --- | ---: | --- |
| 10 | 147 | 10 minutes 2.112 seconds |
| 15 | 220 | 15 minutes 1.120 seconds |
| 30 | 440 | 30 minutes 2.240 seconds |
| 45 | 660 | 45 minutes 3.360 seconds |
| 60 | 879 | 60 minutes 0.384 seconds |
| 90 | 1,319 | 90 minutes 2.624 seconds |
| 120 | 1,758 | 120 minutes 0.768 seconds |

## Implementation Search

Native measurements used CH55xDuino 0.0.25 / bundled SDCC build.13407_4,
model-small, size optimization, no-xinit-opt, int-long-reent, 24MHz, 148 USB DMA
bytes and the real 14,336-byte application flash limit. The baseline was rebuilt
with identical settings. Source and patch hashes are in [results.json](results.json).
Native memory reports are preserved in [memory/](memory/).

Removal-only controls, before adding an explicit action, measured 14,168 bytes
for the four-duration layout and 14,178 for the expanded layout on six-key.
These are explanatory controls, not final equivalent-feature candidates: they
lack the requested new action. The first straightforward four-duration/single
implementation measured 14,232, 10 bytes larger than baseline. Final A is 20
bytes smaller than that first implementation.

Optimizations retained in the finalists:

- Reserve state index `CONFIG_TIMED_MAX` (slot 4) for sleep, independent of the
  active user timer count. The existing loop jumps over unused user slots to
  this fixed state slot. All five state slots were already allocated, so RAM
  is unchanged. The synthesized record still starts at image offset 128.
- Reset the fixed sleep state directly in the existing type-0 dispatch case,
  avoiding an additional helper tail jump. Use a bit test for auxiliary `0x4`.
- Skip the built-in slot entirely when global sleep is off. Applying a profile
  resets all timer state, so a globally disabled saved configuration cannot
  carry a pending sleep into that path. Explicit reset does not enable sleep.
- In single-behavior validation, accept auxiliary 0 and 4 together with the mask
  `!(aux & 11)`, requiring parameter zero. Strict validation is preserved.
- For the single behavior, capture the pending bit before clearing all sleep
  state and restoring lighting. A byte local is smaller than a bit local on
  this source; no new persistent state is allocated.

Also measured: the original variable sleep slot, separate versus inlined
helpers, mask versus bit dispatch, exiting versus continuing the disabled slot,
byte versus bit pending locals, and two dual-behavior encodings. Not every
intermediate candidate was built for both pads. [results.json](results.json)
distinguishes measured results from missing measurements; no unmeasured values
are extrapolated.

Using auxiliary `0x8` for reset-only, with parameter zero for both actions,
measured 14,230/14,228 bytes with four durations and 14,240/14,238 with expanded
durations. These exceed the parameter-byte finalists by 4/6 bytes on six/three
keys, respectively. B/D therefore use the parameter byte. Auxiliary candidates
were measured but are not the delivered or fully regression-qualified patches.

## Validation

All four finalists pass the complete adapted host suite both normally and with
color preview disabled, on both geometries. Each native build passes the normal
real-limit link, RAM layout, startup, and USB interrupt-parameter checks.

Tests retain the existing unrelated firmware regressions and the physical wake
checks for all previous durations/settings, key presses, encoder button and
both encoder directions, consumed releases, one-shot handling, and all layer
indicator modes. Obsolete per-layer sleep expectations are replaced by global
coverage. Added checks include:

- Every enabled duration and all combinations of consume/reminder/dim settings;
  global Off, repeated expiries, physical resets, and ignored layer bit values.
- Layer changes during partial inactivity and after sleep; repeated layer
  changes cannot prevent sleep or implicitly wake it.
- All user timer counts from zero through four, preserving their pending
  follow-ups and consumption while resetting/waking only built-in sleep.
- All type-0 auxiliary/parameter combinations at each action site, including
  macro definitions, every header byte value, and every layer-options byte.
- Reset immediately before and after expiry, long timeout high-age clearing,
  fractional reset, awake reset, and no unintended indication or host output.
- A user inactivity timer continues to expire despite explicit sleep resets.
- Macro order, repetition, reset-only execution, and following keyboard output.
- The actual LED renderer restores **Always On** after off or dim sleep, with
  timer firing immediately before or after the 15-minute threshold.

Patch application was checked independently against the baseline. Candidate
firmware and test hashes identify the exact tested contents. Candidate changes
remain isolated in temporary source trees; only this comparison package is
added to the checkout. The active editor and uploader have not been adapted to
these encodings, so their deployment checks do not validate the candidates.
Hardware validation, flashing, release generation and publication were not run.

## Patches and Reproduction

Each patch independently applies to baseline `a91cb995efa57f7290328bf46d26d809547a0bf9`.
Apply one candidate, not several. Patches contain firmware plus the corresponding
host test adaptations and new regressions; editor/protocol integration is
deferred until a candidate is selected.

| Candidate | Patch |
| --- | --- |
| A | [a-four-single.patch](patches/a-four-single.patch) |
| B | [b-four-dual.patch](patches/b-four-dual.patch) |
| C | [c-eight-single.patch](patches/c-eight-single.patch) |
| D | [d-eight-dual.patch](patches/d-eight-dual.patch) |

From a checkout at the baseline, for example:

```sh
git apply --check protocol/global-auto-sleep-comparison/patches/a-four-single.patch
git apply protocol/global-auto-sleep-comparison/patches/a-four-single.patch
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 pio-platform/build_firmware.py build . /private/tmp/global-sleep-check-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/global-sleep-check-three 24000000 148 14336 1
```

Measurement projects, native maps/assembly/HEX files, candidate sources and logs
remain under `/private/tmp/macropad-global-sleep/`. The durable comparison,
checksums, patches and memory reports are in this directory. No commit is
created by this experiment package.
