# Timed actions investigation findings

## Outcome

The scheduler, optional reset-on-input, and explicit resume actions work in host
tests, but this implementation is substantially over the firmware limit. The
retained four-timer prototype uses **15,139 bytes on six-key boards: 803 bytes over**
the normal 14,336-byte limit. This already excludes release-dependent timer actions
and editor support. No existing release features were removed to make room.

The earlier experimental LED sleep was replaced as authorized. Its committed
source remains at `2709c23`; it is not part of this scheduler prototype. Working
files remain on `experiment/timed-actions`, uncommitted. Nothing was pushed, no
release-generation command was used, and `releases/` was preserved.

The plan was saved in [timed-actions-plan.md](timed-actions-plan.md) before firmware
implementation. Code, measurements, tests and reproduction instructions are
retained so this is not merely a speculative estimate. This is **not** a complete
or flashable implementation of the requested feature.

## Implemented trigger and resume behavior

- Profile-wide independent timers, four by default. An interval byte represents
  1–128 ticks of 65.536 seconds; bit 7 requests reset on physical input.
- Periodic firing every interval. Timers with reset enabled restart on debounced
  button presses (including the encoder pushbutton) and completed detents in
  either direction. No-op bindings count. Releases, partial detents and USB
  traffic do not reset them.
- Each timer has an ordinary action and an optional resume action, represented
  as None when unused. The resume action runs once on the first physical input
  after that timer fired, before the physical input's own binding. This works
  independently of whether its interval resets on input.
- Timers due on a frame execute before scanning physical inputs, so a coincident
  input can resume lighting and apply its own action last. A host regression
  explicitly covers the timer boundary and debounce deadline in the same frame.
- Timer actions use existing LED dispatch and HID playback. Existing queue bounds
  and overflow reporting remain in effect; arbitrary repeated HID actions cannot
  accumulate an unbounded backlog. Timers currently share button-priority queue
  accounting, so congestion is reflected in the button-drop counter. Independent
  timed mouse toggles have separate latch slots rather than sharing an encoder's.
- Timers do not consume an armed physical one-shot layer. Relative timed layer
  actions resolve against the effective active layer. Deliberately assigning a
  new one-shot layer action can arm/replace a one-shot normally.
- Configuration application and USB reset clear timer state. The coarse clock is
  sampled from the existing full 32-bit `millis()` result. An 8-bit coarse clock
  wrap is handled by observing changes rather than comparing increasing values.
  Long gaps between polls produce one observed tick, not a burst of catch-up
  actions; normal polling must continue more often than once per 65.536 seconds.

The first interval after application/input is aligned to the shared clock, so
its duration has up to one tick of quantization. A one-tick inactivity action can
fire shortly after an input near a boundary; it is not a guaranteed minimum
65.536-second idle interval. Exact independent deadlines would require additional
state or logic. Subsequent uninterrupted periods have the selected tick count.

### LED wake example

Assign the timed action **Set common brightness preset: Layers off, keys dim**.
Assign its resume action **Set both brightnesses: As configured**. The timer
applies the dark preset; the next physical input restores configured brightness.
If that key itself sets brightness, its action takes precedence over restoration.
Real renderer host tests cover this ordering on both physical variants.

This does **not** exactly reproduce always-on-only auto-sleep: a generic preset
also changes blink/timed indicator brightness. Nor does it remember arbitrary
prior brightness overrides; resume runs the specifically configured action.
Exact previous-state restoration or always-on-only suppression would require
additional semantics. It must not be presented as automatically available.

### Repeating mouse movement

Mouse X/Y steps can use timed dispatch. A lone repeated positive step causes
drift; a jiggle needs opposing movements, for example two simultaneous timers
with +1 and -1 X actions. Both actions depend on ordinary queue capacity. The
65.536-second minimum quantum may be too slow for some host inactivity policies.
No physical mouse movement or host keep-awake behavior was tested.

## Configuration prototype

Structural changes use **format 7**, with existing format 6 still accepted by
the updated firmware. Older firmware rejects format 7 instead of interpreting
timer records as chords/strings. Existing action and layer encodings remain.

| Field | Prototype encoding |
| --- | --- |
| Header byte 3 bits 0–5 | Existing layer count/startup layer |
| Header byte 3 bits 6–7 | Timer-count low two bits |
| Header byte 4 bit 7 | Timer-count high bit |
| Header byte 4 bits 0–6 | String-pool length |
| Timer position | After layers and chords, before strings |
| Timer record byte 0 | `(ticks - 1)`, bits 0–6; input-reset flag, bit 7 |
| Timer record bytes 1–2 | Existing two-byte action |
| Timer record bytes 3–4 | Existing two-byte resume action |

Each retained timer costs five profile bytes, so four use twenty of the fixed
128-byte image. This reduces the remaining space for layers/chords/strings only
when timers are present. String bounds/offsets include the timer region. Invalid
counts, oversized images, malformed actions and release-dependent bindings are
rejected. Format 6 reserved bits do not become timer counts.

The seven-timer variant uses all representable counts but is not an unlimited
design; the image's capacity is still the ultimate constraint. The no-resume
variant uses three-byte records. These are **experimental layouts**, not mutually
interchangeable despite sharing provisional format number 7. A shipping format
would require selecting one stable layout and updating its versioned editor.

## Measured variants

Toolchain: CH55xDuino 0.0.25 / SDCC build.13407_4, size optimization, preview enabled,
normal linker limit. All final variants have a valid RAM layout and fail only the
flash-size check. Early exploratory builds also had direct-RAM allocation errors;
they were corrected before the measurements below.

| Variant | Flash bytes | Over 14,336 | xRAM used / 876 | Stack capacity |
| --- | ---: | ---: | ---: | ---: |
| Working toggle, six-key baseline | 14,325 | Fits, 11 free | 628 | 125 |
| Committed LED sleep, six-key | 14,377 | 41 | 628 | 124 |
| Retained timed actions, six-key | 15,139 | **803** | 642 | 128 |
| Retained timed actions, three-key | 15,135 | **799** | 633 | 131 |
| All timers reset on input, six-key | 15,121 | 785 | 642 | 128 |
| All reset + 1–64 ticks, six-key | 15,133 | 797 | 642 | 128 |
| All reset + 1–64, no resume action, six-key | 14,989 | 653 | 642 | 128 |
| Seven timers, full flags/resume, six-key | 15,139 | 803 | 648 | 128 |

Six bits represent **1–64**, not 1–65. Narrowing the range did not save a counter
byte; stricter rejection of bit 6 added 12 flash bytes. Removing per-timer reset
choice saved 18 bytes. Removing resume actions saved 144 bytes compared with the
compact variant, but loses automatic LED wake restoration. A cap of four instead
of seven saves six xRAM bytes and no flash in this implementation.

The retained code grows by 814 bytes over working toggle firmware. Padded SDCC
CSEG module differences account for it: sketch/input integration +56, configuration
parsing/validation/string addressing +350, action dispatch/scheduler +408. Thus
the timer counter alone is not responsible for most of the cost.

Stack figures describe linker capacity, not measured worst-case usage. Recursive
call/interrupt depth and hardware behavior would still need validation before
shipping even a size-compliant implementation.

## RAM and optimizations

The scheduler uses four byte counters and one shared clock byte. Each counter's
high bit remembers whether the timer fired, avoiding a separate resume-state
bitmask; its low seven bits track elapsed ticks. No action records are copied to
runtime RAM. Four extra mouse-toggle latch slots preserve independent ownership.
The total measured xRAM increase over working toggle is fourteen bytes, including
compiler temporaries and state moved out of scarce direct RAM.

Retained changes reuse action validation, HID playback, LED control, and layer
dispatch. `consumerReleasePending`, `layerSelectionPending`, `clicksLeft`, timer
offset temporaries, and a string argument were placed in xRAM to resolve direct
RAM/overlay allocation pressure. All original physical action regressions pass.

Caching timer count/start was measured and discarded: it increased flash by
12 bytes and used two additional xRAM bytes in the measured implementation.
Packing resume state was retained. Ordinary hardware geometry is still resolved
at compile time, and color preview remains enabled. No existing release feature
was disabled to fit a variant.

## Scope still missing

The probe supports rotation-compatible timer actions: key taps, mouse
click/double-click/toggle, scrolling, non-held pointer steps, consumer/string
actions, layer selection/relative selection, LED controls, and None. **Key holds,
mouse holds, held pointer movement and momentary layers are rejected for timers**,
while remaining fully supported on physical bindings. Supporting them honestly
requires virtual input/release lifecycles; silently treating holds as taps would
not satisfy “any action.” This probe's substantial overflow precedes that work.

Editor controls, binary/JSON format-7 codecs, capacity accounting, imports/drafts,
comparison/undo support, compatibility/archive routing, and browser tests are
not implemented. The current format-6 editor cannot configure this firmware.
Per the saved plan, that work was deferred after the lower-bound probe proved far
from the available space. No polished UI is being claimed for an unflashable build.

Further architecture work would need to recover roughly 800 bytes before adding
those missing firmware semantics. These measurements establish the cost of this
implementation, not a proof that every possible design is impossible.

## Verification and reproduction

The complete host suite passes on the retained sources, including both physical
input/rendering variants. New tests cover count/bounds validation, string offsets,
v6 acceptance, interval endpoints, independent reset behavior, repeating expiry,
coarse-clock wrap, resume once, simultaneous timers, one-shot preservation, queue
overflow safety, lighting restoration and same-frame input precedence. Existing
physical holds/chords/macros/USB/protocol tests pass. Configuration/action host
suites also passed for all-reset, compact, no-resume and seven-timer builds.
No hardware was flashed. Browser code was not changed or claimed verified for v7.

Run the retained regression suite:

```sh
python3 tests/run_host_tests.py
```

Reproduce all six size variants without editing the working tree or releases:

```sh
python3 protocol/build-timed-action-variants.py
```

The script copies current firmware sources to fresh temporary directories,
preserves existing build flags, adds the flags below, captures logs, prints
`firmware.mem`, and returns nonzero when linker checks fail. It does not increase
the code limit, generate releases, or upload hardware.

| Variant | Additional flags |
| --- | --- |
| Retained | None |
| All reset | `-DCONFIG_TIMED_ALL_RESET=1` |
| Compact | Previous flag plus `-DCONFIG_TIMED_INTERVAL_MASK=63` |
| No resume | Compact flags plus `-DCONFIG_TIMED_RESUME=0` |
| Seven timers | `-DCONFIG_TIMED_MAX=7` |

Final investigation artifacts were measured under `/private/tmp/macropad-timed/`;
system cleanup may remove them. The reproducible script and these measurements
remain in the repository. No extra Git branches were needed for compile-time
variants; all variant definitions are retained in the current experimentation branch.
