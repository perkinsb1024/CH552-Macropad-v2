# Timed actions: second optimization investigation

Baseline: checkpoint `0961153`, six-key 15,139 bytes (803 over), three-key
15,135 bytes, SDCC build.13407_4. Preserve released features and retain full
seven-bit intervals, optional input reset and resume actions where possible.
Timed actions may use the existing tap/encoder-compatible action subset; held
actions are outside this pass. No release generation, upload or push.

## Plan

1. Revisit primary SDCC/CH552 documentation and inspect linked assembly, module
   sizes and calling conventions. Measure compiler switches separately.
2. Establish a repeatable temporary build/size harness and baseline snapshots.
   Record each candidate's incremental flash and RAM effects, including failures.
3. Optimize new configuration parsing and scheduler first: shared loops,
   record addressing, argument storage, repeated validation, and timer state.
4. Inspect larger existing modules for equivalent smaller C: memory-specific
   pointers, byte-width arithmetic, shared operations, lookup tables, branch
   ordering, unused linked routines and initialization. Preserve USB timing,
   bounds checks and physical action behavior.
5. Retain only measured improvements with valid RAM layout. Run host regressions
   after coherent changes and add meaningful coverage when an equivalence is
   subtle. Inspect target assembly where host tests cannot check code generation.
6. Build both hardware geometries at the normal 14,336-byte limit. If still over,
   measure low-impact optional feature simplifications in temporary copies and
   report their exact behavior and savings; do not silently remove features.
7. Update this report with sources, retained optimizations, rejected experiments,
   final size/RAM and remaining limitations. Keep experiments reproducible.

## Result

**Fits without removing an existing feature or narrowing the timer design.**
The retained six-key firmware is **14,255 / 14,336 bytes**, leaving **81 bytes**.
Three-key is **14,251 bytes**, leaving **85 bytes**. This saves **884 bytes**
against checkpoint `0961153` on both boards. These are ordinary temporary builds;
no release artifacts were generated and no hardware was flashed.

Retained: four independent timers, intervals 1–128 coarse ticks, optional reset
on every physical key press/completed encoder detent, periodic firing, optional
resume action on the next input, independent mouse-toggle ownership, and all
existing physical-input/LED/USB capabilities. The separate auto-sleep experiment
was already absent from the checkpoint, so it contributed no new savings here.

Timed actions still use the encoder-compatible subset: complete key taps and
other actions that do not require a held/released input lifecycle. A tap includes
both key down and key up; physical key-down activity resets an opted-in timer even
when that key has no binding. Timed holds remain outside this pass, as requested.
Format-7 editor support remains unimplemented; this result is a size-compliant,
host-tested firmware prototype, not a finished UI or hardware-tested release.

## Primary references and conclusions

- [SDCC Compiler User Guide](https://sdcc.sourceforge.net/doc/sdccman.pdf), sections
  3.5.1, 3.15 and 4.1: memory-specific pointers and the small model make selective
  `__pdata` placement preferable to changing the entire memory model. Sections
  3.3 and 4.1.4 describe startup options/modules. The installed compiler's actual
  assembly was checked because current documentation can differ from this
  older SDCC 4.2.2 build.13407 toolchain.
- [WCH CH552 datasheet, mirrored manufacturer PDF](https://hubtronics.in/docs/CH552DS1.PDF),
  sections 6 and 10: CH552 has 256 bytes of internal RAM and 1 KiB of xRAM; P2 is
  an internal page selector for `MOVX @R0/@R1`. The bootloader-preserving application
  limit remains 14 KiB. P2 resets to 0xFF, so selecting the correct page at startup
  is essential. The official WCH download page timed out during this investigation.
- SDCC's `--max-allocs-per-node` does not affect its mcs51 allocator; increasing it
  would not solve this problem. Return peephole optimization is already enabled.
  Global `--acall-ajmp` is unsuitable for a program spanning multiple 2-KiB pages.
  Inline-assembly peepholes were not enabled on cycle-sensitive WS2812 routines.

No compiler upgrade, bootloader-space borrowing, reduced code-limit checks,
assembly rewriting of application routines, or changed USB descriptors was needed.

## Measured retained optimizations

The rows are incremental builds in this order, using the same six-key geometry,
24 MHz configuration and normal 14,336-byte linker limit.

| Change | Saved bytes | Resulting flash | Free / over |
| --- | ---: | ---: | ---: |
| Checkpoint `0961153` | — | 15,139 | 803 over |
| Validate a string start by its preceding NUL instead of rescanning the pool | 24 | 15,115 | 779 over |
| Move private action state to page-zero `__pdata` | 706 | 14,409 | 73 over |
| Share timer traversal/dispatch between ticks and input events | 82 | 14,327 | 9 free |
| Move four LED setting bytes to `__pdata` | 36 | 14,291 | 45 free |
| Let startup clearing initialize two USB zero-valued globals | 2 | 14,289 | 47 free |
| Omit unused XINIT copying while explicitly retaining XRAM clearing | 34 | **14,255** | **81 free** |

### Paged runtime state

The main saving is addressing, not a smaller feature set. Action state formerly
required 16-bit DPTR setup and more register saving when accessing xRAM. The
selected private variables now use one-byte paged addresses and `MOVX @R0/@R1`.
`nextKeyboard` remains `__xdata` because the USB API takes an xdata pointer.
No public pointer ABI changed in this pass. LED settings share the same page.

On both boards, PSEG is **0x0094–0x00F9 (102 bytes)**, above the reserved USB DMA
region and wholly inside page zero. Six bytes remain in this page. The linked
startup clear routine explicitly selects **P2=0**, and the linked application,
USB and timer code do not change P2. The unused generic digital-I/O core object
contains P2 access but is not linked into this firmware. The normal build now
checks page bounds, USB/PSEG/XSEG overlap, physical xRAM limits and required
startup clearing before emitting the final `.hex` copy.

The six-key image allocates 102 paged bytes plus 538 ordinary external bytes.
The linker leaves a 20-byte gap before XSEG, so the total application xRAM span
is 660 bytes above the 148-byte USB reservation, with 216 bytes above the final
allocation. Three-key uses 102 + 529 allocated bytes and has 225 bytes above the
final allocation. Paged storage does not consume internal stack RAM, although
changed compiler temporaries reduce reported stack capacity from 128 to 122 bytes
on six-key and from 131 to 125 on three-key. These are capacities, not measured
worst-case stack usage.

### Shared timer path

`timedEvent()` walks records once for either kind of event. It computes the new
counter state and chooses no dispatch, expiry action or resume action, then uses
one common dispatch path. Tick detection/reset wrappers remain small. Timing,
input precedence, independent periods, queue bounds and one-shot behavior are
unchanged. Counter state is committed before dispatch; dispatched actions cannot
mutate the timer configuration or reenter the timer service.

### Startup optimization and rejected unsafe variant

Simply enabling `--no-xinit-opt` measured 14,219 bytes, but was **rejected**:
it removes both the XINIT copier and implicit external-RAM zeroing, including
P2 selection. Host tests alone cannot catch this target-startup error.

The retained version explicitly references `__mcs51_genXRAMCLEAR` in `src/main.c`,
causing SDCC to link its normal zeroing/page-setup code into startup. Only the
unused 34-byte XINIT copying routine is omitted. The build checks that no XINIT
or XISEG storage remains and that the clearing symbol is present. The linked
machine code for both geometries was inspected: it clears PSEG starting at 0x94,
sets P2 to zero, and clears the separate XSEG range. Ordinary internal-RAM startup
initialization is also retained.

## Concession variants: still unnecessary

All six builds below passed the normal linker and the new memory-layout checks.
The retained design continues to use four timers and the full option set.

| Variant | Flash | Free bytes | Paged bytes | Stack capacity |
| --- | ---: | ---: | ---: | ---: |
| Retained, six-key | 14,255 | 81 | 102 | 122 |
| Retained, three-key | 14,251 | 85 | 102 | 125 |
| All timers reset on input, six-key | 14,237 | 99 | 102 | 122 |
| All reset, 1–64 ticks, six-key | 14,249 | 87 | 102 | 122 |
| All reset, 1–64 ticks, no resume action, six-key | 14,181 | 155 | 102 | 122 |
| Seven timers, full options, six-key | 14,255 | 81 | 108 | 122 |

Seven timers consume the entire available first page. The six-bit interval still
adds validation rather than saving code. Removing resume actions now saves only
68 bytes relative to the compact variant because much of its implementation is
shared. There is no reason to remove released features to fit the retained design.

## Verification and reproduction

- Complete `python3 tests/run_host_tests.py` suite passes: configuration, actions,
  protocol, USB, and physical input/LED rendering for both boards.
- New string regression exhausts 128 NUL-placement patterns, each possible start
  and one out-of-pool offset, on both geometries (2,304 images). Existing CRC,
  timer records, invalid bindings and pool capacity coverage remains intact.
- Five new build-layout tests cover an exact page end, page crossing, wrong page,
  USB/external overlap, physical xRAM exhaustion and missing startup support.
- Configuration/action suites also pass for all-reset, compact, no-resume and
  seven-timer compile-time variants.
- `python3 protocol/build-timed-action-variants.py` reproduces all six successful
  size builds in temporary directories. The script now exits successfully because
  the variants fit, rather than returning the earlier expected flash-overflow error.
- Linked startup bytes were inspected for both physical variants; the check
  confirmed `MOV P2,#0` within the retained external-RAM clearing routine.
- `git diff --check` passes. No browser changes or hardware validation were made.

Keep `pio-platform/build_firmware.py` and `src/main.c` startup changes together.
The address-space declarations require the checked page-zero layout and startup
page selection. The changes are in the current `experiment/timed-actions` working
tree on top of the user's checkpoint; extra experiment branches were unnecessary.
The original [findings](timed-actions-findings.md) preserve the first-pass costs
and remaining UI/behavior limitations. This report supersedes their size outcome.

## Follow-up: fill the remaining six paged bytes

Starting from checkpoint `18fb0aa`, moved the six one-byte sketch variables
previously identified in four groups: `encoderState`, `encoderMovement`,
`layerIndicatorPhasesLeft`, `layerIndicatorDeadline`, `lastLayer`, and
`previewOptions`. Only their storage declarations changed from `__xdata` to
`__pdata`; the maximum timer count remains four. The linker places all paged
objects, so the newly moved variables do not necessarily occupy FA–FF themselves;
the entire linked paged allocation now spans 0x0094–0x00FF.

Fresh before/after temporary builds at the normal 14,336-byte limit measured:

| Hardware | Before flash | After flash | Saved | After free | Stack before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six-key | 14,255 | 14,231 | **24** | **105** | 122 / 122 |
| Three-key | 14,251 | 14,227 | **24** | **109** | 125 / 125 |

PSEG increases from 102 to 108 bytes. Ordinary XSEG decreases by six bytes
(538 → 532 on six-key, 529 → 523 on three-key), leaving the final RAM address
unchanged. Stack capacities are linker capacities, not measured peak usage.
The complete host regression suite and both boards' build/layout checks pass.
No hardware testing or release generation was performed.

This is an alternative use of the same six page slots as increasing the timer
limit to seven. The seven-timer alternative at `18fb0aa` used 14,255 flash bytes
on six-key and the same 122-byte stack capacity. Combining these six moves with
seven timers exceeds the current page-zero layout; the build guard rejects it.
Consequently, the earlier all-variant reproduction script's seven-timer case
requires the pre-follow-up sketch declarations until a choice is made. The
current candidate remains uncommitted for the user's comparison.

Before/after sources, ordinary firmware outputs and logs for this measurement
were written under `/private/tmp/macropad-page-fill-h4nw7q96/`; these temporary
files may be removed by system cleanup. `baseline` is a source snapshot of
`18fb0aa`. Each `baseline-0`, `baseline-1`, `candidate-0`, and `candidate-1`
folder contains its `firmware.mem` and `firmware.map`; corresponding `.log`
files capture compilation. Reproduce one build with:

```sh
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-page-fill-check 24000000 148 14336 0
```

Use variant `1` for three-key and a different temporary output directory.
