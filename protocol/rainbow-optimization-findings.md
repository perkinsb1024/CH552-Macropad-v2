# Rainbow Flash Optimization Investigation

Recorded October 13, 2026, on `experiment/v15-auto-sleep`, starting from clean
revision `069be2a2c618bf65bdb6eee29c95f6771d15ec4e`. All firmware changes were
initially measured in temporary source trees. The user subsequently authorized
applying the per-LED counter candidate to the active sketch; see the application
record below. Nothing was committed or flashed. Configurator and release files
remain unchanged.

## Findings and Recommendation

There is useful headroom available in the Rainbow implementation. A combination
that retains per-LED drift counters saves 122 flash bytes on each pad. A second
combination derives drift from a single frame counter and saves 126 bytes.
Both preserve exact RGB bytes and animation timing in the checks described below.

For a follow-up aimed primarily at flash, prefer the 122-byte candidate. It obtains
almost all the saving, increases stack capacity, and passes the original firmware
tests without changing their assumptions about independent hue/drift storage.
The frame-counter alternative is useful if internal RAM also matters, but its
additional four flash bytes require a representation change and adjusted internal
test fixtures. The per-LED candidate is now applied, uncommitted; the frame-counter
alternative remains unadopted. Neither has been hardware validated.

| Candidate | Six-Key Flash | Three-Key Flash | Saving, Six/Three | Free Flash, Six/Three | Stack Capacity, Six/Three |
| --- | ---: | ---: | --- | --- | --- |
| Baseline | 14,332 | 14,330 | 0/0 | 4/6 | 85/88 |
| Per-LED Counters | 14,210 | 14,208 | 122/122 | 126/128 | 90/93 |
| Derived Frame Counter | 14,206 | 14,204 | 126/126 | 130/132 | 95/95 |

All figures are measured bytes. Stack capacity is the linker-reserved region,
not a high-water measurement. Neither final candidate reduces stack capacity.
PSEG remains 105 bytes and ordinary XSEG remains 365/356 bytes. Including 148 USB
DMA bytes and the 134-byte absolute active/runtime buffer, allocated external RAM
remains 752/743 bytes. The existing page-zero, overlap, startup and interrupt
parameter checks pass without relaxation.

## What Produces the Saving

The preferred candidate combines six changes in
`CH552_Universal_Macropad.ino`:

1. Cache `rainbowSteps[spacing]` once per render. The original compiler hoists
   its address, but still reads code memory for each Rainbow LED. Caching the
   byte removes the repeated load and reduces pointer spill storage.
2. Compute the base Rainbow eligibility once before the LED loop and use
   `ACTION_BIT` for the base and per-LED flags. Preserve the per-key override:
   key palette 15 is **Off**, while layer palette 15 can be **Rainbow**.
3. Keep drift counters in physical LED order and replace the slot map with
   physical masks `{3,31,7,63,15,127}` / `{3,15,7}`. The renderer can load
   `rainbowDrift[i]` directly. The animation loop still advances exactly the
   original counter for each physical LED at its original cadence.
4. Move `rainbowChanged` from `__idata` to `__data`. Direct byte loads/stores
   avoid indirect-address setup. Native allocation checks show no loss of stack
   capacity or direct-RAM allocation failure on this source.
5. Resolve animation options into a byte only after the frame deadline is due,
   then test `animationOptions >= 0xF4`. For every byte `x`,
   `(x & 0xFC) > 0xF0` is exactly equivalent to `x >= 0xF4`. This replaces
   the original nested expression and its promoted 16-bit intermediate values.
   Preserve the preview bit-3 filter and invalid-config handling before the
   comparison. Option lookup still occurs only after a due deadline.
6. Multiply the wheel position by three once, reusing the dead palette scratch
   byte to retain the sector. Subtracting `85 * 3` is adding one modulo 256;
   subtracting `170 * 3` is adding two. Thus the three ramps can use the shared
   product, plus zero, one or two, with exactly the original complement and
   zero channels. Position 255 retains the original red endpoint.

The individual savings total 100 bytes, but the combination saves 122. The
compiler allocates registers, spill bytes and branches differently when changes
are combined. The measured combination, rather than a sum of isolated results,
is the relevant budget for future work.

### Derived Frame Counter

The alternative replaces the independent hue byte and three/six drift bytes
with a two-byte frame counter. Its low byte remains the base hue. For drift
slot `s`, after `F` eligible frames since reset:

```c
drift[s] == (uint8_t)(F >> (s + 2))
```

The original increment periods are 4, 8, 16, 32, 64 and 128 frames. Every
counter's full period divides 65,536 frames, so a wrapping 16-bit frame counter
preserves all reachable drift states indefinitely. Reset clears the counter;
USB reapplication without restart preserves it. Rendering uses the existing
physical slot map to derive the required byte.

Persistent Rainbow state shrinks by five internal RAM bytes on six-key and two
on three-key. Together with the other changes, stack capacity rises by 10/7
bytes. This is not just a flash optimization: variable shifts move work from
counter maintenance into the renderer. Execution time was not benchmarked on
hardware. The union's low-byte alias relies on the installed little-endian SDCC
MCS-51 representation; its generated loads, reset and carry increment were
inspected. A port to another target must verify that layout.

Both historical candidate patches explicitly require the current
`RAINBOW_DRIFT_MASK == 3`. A compile-time guard prevents silently using the
hard-coded physical masks or shift of two with a different base interval.
The applied per-LED implementation instead derives its masks at compile time
from `RAINBOW_DRIFT_MASK`, preserving the existing tuning parameter without
adding runtime arithmetic or flash bytes.

## Individual Native Measurements

Each row is an independent change to the same baseline, not an incremental
sequence. Positive saving means smaller firmware. Diagnostic builds used a
16,384-byte limit to measure oversized alternatives; the baseline and final
candidates were also built at the real 14,336-byte application limit.

| Probe | Six-Key Flash | Three-Key Flash | Saving, Six/Three | Stack Capacity, Six/Three |
| --- | ---: | ---: | --- | --- |
| `phase-cache` | 14,318 | 14,316 | 14/14 | 86/89 |
| `rainbow-bit` | 14,324 | 14,322 | 8/8 | 86/89 |
| `rainbow-hoist` | 14,312 | 14,310 | 20/20 | 87/90 |
| `drift-physical` | 14,322 | 14,320 | 10/10 | 85/88 |
| `timer-data` | 14,326 | 14,324 | 6/6 | 85/88 |
| `ramp-reuse` | 14,326 | 14,324 | 6/6 | 85/88 |
| `gate-due-threshold` | 14,288 | 14,286 | 44/44 | 87/90 |
| `drift-derived` | 14,318 | 14,316 | 14/14 | 90/90 |
| `drift-derived-byte` | 14,318 | 14,316 | 14/14 | 89/89 |
| `drift-break` | 14,330 | 14,328 | 2/2 | 85/88 |
| `drift-shift` | 14,328 | 14,326 | 4/4 | 85/88 |
| `drift-pointer` | 14,324 | 14,322 | 8/8 | 85/88 |
| `phase-table` | 14,328 | 14,317 | 4/13 | 86/89 |
| `phase-pointer` | 14,340 | 14,329 | -8/1 | 85/88 |
| `ramp-shared` | 14,322 | 14,320 | 10/10 | 84/87 |
| `ramp-normalize` | 14,348 | 14,346 | -16/-16 | 84/87 |
| `ramp-divmod` | 14,498 | 14,496 | -166/-166 | 82/85 |
| `drift-unroll` | 14,382 | 14,338 | -50/-8 | 85/88 |
| `drift-data` | 14,332 | 14,330 | 0/0 | 85/88 |
| `drift-pdata` | 14,332* | 14,330 | 0/0 | 91/91 |
| `hue-idata` | 14,338 | 14,336 | -6/-6 | 85/88 |
| `gate-byte` | 14,332 | 14,330 | 0/0 | 85/88 |
| `speed-byte` | 14,332 | 14,330 | 0/0 | 85/88 |
| `gate-match` | 14,324 | 14,322 | 8/8 | 85/88 |
| `gate-threshold` | 14,314 | 14,312 | 18/18 | 85/88 |
| `gate-direct` | 14,310 | 14,308 | 22/22 | 87/90 |
| `gate-helper` | 14,318 | 14,316 | 14/14 | 87/90 |
| `gate-local` | 14,298 | 14,296 | 34/34 | 87/90 |
| `gate-due` | 14,302 | 14,300 | 30/30 | 87/90 |

*The six-key `drift-pdata` result is a diagnostic memory report from a failed
link: PSEG grows to 111 bytes and crosses page zero. It is unusable. Three-key
PSEG reaches 108 bytes with no flash saving. This relocation is rejected.

The 256-position color wheel and fixed phase products were already relatively
compact. A full phase-offset table replaces multiplication with lookup, but its
extra data costs more than the phase-cache approach in both final combinations.
Division/modulo introduces expensive widened arithmetic. Normalizing a sector
before computing RGB and unrolling drift also grow the image. Moving all drift
bytes to direct RAM gives no saving.

The shared-ramp candidate saves 10 bytes alone but reduces stack capacity by
one byte; reusing the existing palette scratch byte avoids that reduction.
The shared-ramp variant also gives worse final combinations. Byte casts alone
do not repair the original animation expression: the useful saving comes from
expressing the gate as ordinary byte control flow and its equivalent threshold.
The eager `gate-local` variant resolves options on every loop pass; the selected
variant preserves the original deadline-first evaluation.

Measured early-exit drift loops provide an alternative to changing counter order:
if a faster slot is not due, no slower slot is due either. The pointer/countdown
version saves eight bytes by eliminating repeated indexing and shifting a local
hue rather than constructing masks. It produced larger final combinations than
physical-order counters and was not selected.

## Validation and Its Limits

The investigation completed 108 native measurements across 48 source forms:
one baseline, 29 individual alternatives and 18 combinations. Full measurements,
link outcomes, stack capacities and artifact paths are retained in
[results.json](rainbow-optimization-candidates/results.json).

Both final candidates pass:

- Native builds for both geometries at the real 14,336-byte limit, with default
  color preview enabled and the normal memory/startup checks.
- Complete host firmware suites with preview enabled and disabled, each covering
  both geometries: configuration, actions, protocol, USB, holds, layers, macros,
  timers, input, eight memory-layout tests and nineteen bootloader tests.
- A differential probe using an untouched copy of the baseline renderer, comparing
  complete GRB buffers byte-for-byte. Per candidate, preview enabled checks
  8,650,756 six-key and 1,769,476 three-key renders; preview disabled checks
  6,029,316 and 1,441,796. Separate sweeps cover the 65,536-frame state range, all phase
  presets, bright/dim output, every option byte and brightness-policy pair,
  every key mask, transparency and normal/preview/effect rendering modes.
- Per geometry and preview setting, 131,072 animation-gate combinations spanning
  every layer/preview option byte and valid/invalid configuration state.
- Per geometry and preview setting, 262,144 sequential frames at 4ms, 6ms,
  10ms and 18ms intervals, checking the pre-deadline and exact-deadline hue,
  full drift output, byte/word/frame-counter wraps and USB reapplication.
- Existing input regressions covering startup enumeration, sleep/wake reminders,
  runtime LED commands, temporary effects, transparency, numbered blinks and
  indicator expiry/cancellation.

The per-LED candidate uses the original host tests unchanged. The derived-counter
candidate needs representation-aware changes only in its temporary input-test
copy. The original spacing test directly writes the hue while holding independent
drift fixed, including an artificial hue wrap that does not advance drift.
That state cannot be represented by a single frame counter. Its variable-phase
checks instead use an independent expected-color formula and the actual next
frame at the wrap; fixed-phase checks remain unchanged. USB state preservation
checks snapshot the entire counter instead of a removed array. The adaptations
are retained separately and do not modify active tests or weaken public behavior
checks. Differential and sequential comparisons independently verify the old
renderer for reachable states.

Native results are from CH55xDuino 0.0.25, SDCC build.13407_4,
`--model-small --opt-code-size --no-xinit-opt --int-long-reent`, 24MHz and
148 USB DMA bytes. Final native sources were rebuilt after patch formatting;
their only difference from the fully tested copies is whitespace, checked
explicitly. The tested revision is the revision above plus candidate changes
in temporary trees. At the end of the initial investigation, the active checkout
had uncommitted investigation artifacts only. No hardware timing, LED capture, stack high-water measurement,
configurator/uploader/site validation or release validation is claimed.

## Applied Per-LED Optimization

On October 13, 2026, the user authorized applying the preferred candidate while
continuing to consider auto-sleep expansion. It is implemented in the active
`CH552_Universal_Macropad.ino` on the same branch and revision plus uncommitted
changes. The original host tests remain unchanged. No auto-sleep functionality,
format, configurator or release files were changed.

The applied implementation retains the measured six optimizations. Code comments
and formatting were cleaned up, and the temporary fixed-interval guard was
replaced with `RAINBOW_DRIFT_SLOT_MASK(slot)` for compile-time mask generation.
For the current base mask of three this emits exactly the measured mask bytes,
while retaining the original base-interval tuning. Final native builds still use
14,210/14,208 flash bytes, leaving 126/128 free, with 90/93 bytes of stack capacity
and unchanged PSEG/XSEG allocation. Both compiled HEX files are byte-for-byte
identical to the selected investigation candidate.

Application validation uses the actual applied source, with the original renderer
from the immutable investigation revision as the differential reference:

- Both native geometries pass at the real 14,336-byte limit and retain all normal
  memory-layout/startup checks.
- Complete unchanged host suites pass with preview enabled and disabled, covering
  both geometries.
- Both geometries pass the complete differential probe with preview enabled and
  disabled, including the render, gate and sequential-frame counts listed above.

The source checksum, native measurements and validation log paths are recorded
in [applied-results.json](rainbow-optimization-candidates/applied-results.json).
Builds, source snapshots and logs are under `/private/tmp/macropad-rainbow-applied/`.
No commits, release generation, uploads or hardware validation were performed.

## Artifacts and Reproduction

- [Preferred firmware patch](rainbow-optimization-candidates/per-led-counters.patch).
- [Frame-counter firmware patch](rainbow-optimization-candidates/derived-frame-counter.patch).
- [Frame-counter test adaptations](rainbow-optimization-candidates/derived-test-adaptations.patch).
- [Probe driver](build-rainbow-optimization-probes.py) and
  [differential C probe](rainbow-optimization-probe.c).
- Temporary maps, assembly, memory reports, HEX files, source snapshots and logs:
  `/private/tmp/macropad-rainbow-investigation/`. Final formatted native builds
  are under `final-review/`; full final validation logs are under
  `final-threshold/`. Patch checksums and the baseline sketch checksum are
  recorded in `results.json`.

The historical driver pins the original investigation revision for its source
archive, baseline renderer and internal test fixtures. It remains reproducible
after applying the optimization. Use a fresh output directory:

```sh
python3 protocol/build-rainbow-optimization-probes.py baseline \
  phase-cache+rainbow-hoist+drift-physical+timer-data+gate-due-threshold+ramp-reuse \
  phase-cache+rainbow-hoist+drift-derived+timer-data+gate-due-threshold+ramp-reuse \
  --limit 14336 --output /private/tmp/rainbow-recheck
```

Run the same cases with `--validate-only --output /private/tmp/rainbow-recheck`,
then again with `--no-preview`. This runs input regressions and the differential
probe. Run `python3 tests/run_host_tests.py` and its `--no-preview` form from
each candidate's copied `six/source/` directory for the complete firmware suites;
each full driver already tests both geometries. Validate the derived copy first
so its temporary internal-state fixtures are adapted.

For independent application to main, use only the relevant sketch changes and
remeasure against main's own baseline. They do not require auto-sleep, a format
transition, action renumbering, configurator changes or feature removal. Preserve
the existing geometry and policy constants, drift cadence and preview semantics.
Verify direct/bit allocation and memory layout on both pads. Deriving drift also
requires checking that every hue/drift writer can be represented as counter
increment or reset. Do not infer the same byte saving on a different revision.
