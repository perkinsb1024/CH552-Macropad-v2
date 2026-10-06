# Six-byte timer intervals and flash fit

The opt-in repository scheduler now implements the later
[eleven-bit variant](eleven-bit-timer-findings.md). The eight-bit results below
are historical measurements; the direct implementation build script now tests
eleven-bit timers.

Follow-up to [the initial layer investigation](layer-timed-actions-findings.md),
measured on 2026-10-05 against `60661c8`. Retained work is on
`experiment/layer-timers-fit`, uncommitted.

## Result

The six-byte, eight-bit interval experiment with optional layer scoping now fits
both boards without degrading or removing a feature. Armed next-input actions
survive layer transitions; scoped intervals reset at actual effective-layer
changes, including momentary and one-shot layers.

| Retained build | Six-key flash | Three-key flash | Free, six / three |
| --- | ---: | ---: | ---: |
| Optimized normal v9 firmware, existing five-byte timers | 14,142 | 14,138 | 194 / 198 |
| Opt-in six-byte, eight-bit, layer-scoped experiment | 14,292 | 14,290 | 44 / 46 |

Both were built at the normal 14,336-byte application limit. The experiment
recovers 216 bytes against the previous 14,508 / 14,506-byte prototype. Normal
v9 firmware recovers 188 bytes against 14,330 / 14,326. Savings are not perfectly
additive because the compiler allocates temporaries differently between builds.

No feature-degradation/removal choices are needed. Color preview, invalid-config
LED blinking, both bootloader entry paths, all action types, layers, chords,
lighting, scrolling, USB reports and configuration validation remain available.

## Global-only interval costs, before optimization

These are the requested six-byte records without any layer-specific validation,
countdown gating or layer-change hooks. They retain expiry/next-input actions,
consume, optional restart-on-input, four timers and independent fractional phase.
The eight-bit global probe repeats the earlier measurement rather than inferring
its size by subtracting a layer feature cost.

The first comparison spends the extra interval bits on resolution while retaining
the existing maximum duration of 8,388.608 s (2 h 19 min 48.608 s):

| Interval bits | Selectable step | Six-key flash | Three-key flash | Added flash on either board |
| --- | ---: | ---: | ---: | ---: |
| 8 | 32.768 s | 14,344 | 14,340 | 14 |
| 10 | 8.192 s | 14,430 | 14,426 | 100 |
| 12 | 2.048 s | 14,430 | 14,426 | 100 |
| 14 | 0.512 s | 14,412 | 14,408 | 82 |

Moving beyond eight bits requires a wider runtime age counter. The probes use
four internal 16-bit ages instead of four paged eight-bit ages, plus the separate
pending-next-input bytes introduced by the eight-bit prototype. This frees four
paged bytes but consumes additional internal RAM. Global eight-bit stack capacity
is 107 / 110 bytes; these wider-counter probes report 97 / 100.

The fine-clock step also changes to keep 256 fractional increments per selectable
interval unit. Counter wrap therefore imposes different maximum gaps between polls:

| Interval bits | Fine-clock quantum | Poll gap must remain below |
| --- | ---: | ---: |
| 8 | 128 ms | 32.768 s |
| 10 | 32 ms | 8.192 s |
| 12 | 8 ms | 2.048 s |
| 14 | 2 ms | 0.512 s |

These are limits of the measured compact clock representation, not new guarantees
about runtime latency. A production 14-bit design intended to tolerate longer
stalls would need a different clock representation and another size measurement.

The fourteen-bit build is smaller than ten/twelve because SDCC emits shorter
code for shifting `millis()` by one bit. That does not make fourteen-bit counters
intrinsically cheaper than ten-bit counters.

### Alternative: spend the bits on range

A second comparison keeps the eight-bit design's 32.768-second interval unit and
128 ms fine clock. This preserves its 32.768-second polling-wrap tolerance and
extends the maximum duration instead:

| Interval bits | Maximum duration | Six-key flash | Three-key flash | Added flash on either board |
| --- | ---: | ---: | ---: | ---: |
| 10 | 33,554.432 s, about 9 h 19 min | 14,420 | 14,416 | 90 |
| 12 | 134,217.728 s, about 37 h 17 min | 14,420 | 14,416 | 90 |
| 14 | 536,870.912 s, about 6 d 5 h | 14,420 | 14,416 | 90 |

All three use the same sixteen-bit operations; only the mask changes.

For the global probes, the low interval byte remains at offset 0. The low
2/4/6 bits of byte 5 carry the additional interval bits, and bits 6–7 retain
consume/restart. Eight-bit global records leave six other bits available.
Ten bits would still leave enough room for a three-bit layer selector in a
different packing; twelve and fourteen would not. The retained scoped eight-bit
layout remains the initial experiment's scope-in-bits-0–2 encoding.

## Retained optimizations

The most useful change is shortening USB control-transfer arithmetic while
retaining sixteen-bit host-request semantics. All current descriptors are under
256 bytes. Incoming lengths with a nonzero high byte become the sentinel `255`:

- Exact-length and zero-length requests still reject them.
- Descriptor/report reads still clamp to the actual descriptor size.
- Requests that return one or two bytes retain the same truncation behavior.
- Address assignment retains its existing behavior.

Both `SetupLen` and the local descriptor length can consequently be bytes.
Compile-time descriptor-size checks in `USBconstant.c` reject growth beyond this
representation. The HID payloads, descriptor bytes, endpoint geometry, critical
sections and host-visible responses are unchanged.

The following table shows incremental retained measurements for six-key
experimental firmware. The three-key savings are the same.

| Change | Incremental saving | Resulting flash |
| --- | ---: | ---: |
| Previous scoped eight-bit prototype | — | 14,508 |
| Byte-sized USB transfer lengths, with saturation | 126 | 14,382 |
| Calculate the byte timer clock from the existing low sixteen-bit time | 22 | 14,360 |
| Internal button state and bit-addressed bootloader permission | 60 | 14,300 |
| Place the volatile protocol mailbox flag in the remaining paged byte | 8 | 14,292 |

The low-word clock change applies to the new `>> 7` clock: only bits 7–14 are
used. It would be incorrect to apply it unchanged to v9's `>> 9` clock, which
also needs bit 16. The normal v9 path keeps its original full-width calculation.

Private raw/stable button states and debounce timestamps move from external RAM
to internal indirect RAM. Their values and timing are unchanged. Bootloader
permission is used only as a boolean, so a native bit replaces its byte. The
volatile protocol mailbox flag occupies the final available paged byte without
changing its ISR/main-loop handoff behavior.

Final paged RAM is 108 bytes, exactly 0x94–0xFF, on both boards. External RAM is
496 / 487 bytes. Static linker stack capacities are 86 / 89 bytes for normal v9
and 82 / 85 for the new experiment, compared with 111 / 114 initially. The
previous hardware study observed a 36-byte peak, but this changed firmware has
not had a new hardware stack measurement. No allocation crosses the USB DMA
reservation, page-zero boundary or physical external-RAM limit.

### Rejected alternatives

Moving upload state into internal or paged RAM made the prototype 10–18 bytes
larger. Moving USB queue scalars in the first combinations caused direct-RAM
allocation failures. A cached layer selector saved only six bytes for another
four internal bytes. A bytewise CRC formula was correct but 32 bytes larger.
Reworking capacity validation saved four bytes before failing direct-RAM
allocation. None of these changes was retained.

Moving a 32-byte protocol inbox into paged RAM saved 38 bytes, but required moving
36 bytes of action state into internal RAM to make room. Combining that with
button-state relocation reduced six-key stack capacity to 45 bytes. The retained
code simplification avoids that tradeoff and keeps substantially more stack room.

## Retained experimental code and compatibility

The opt-in scheduler is in `src/timed_actions_experiment.inc`, included by
`actions.c` only when `CONFIG_TIMED_LAYER_EXPERIMENT=1`. Its config validation,
six-byte record size and new clock path are guarded by the same flag. The flag
defaults to zero. Normal builds keep the existing v9 five-byte format and work
with the unchanged configurator.

The flag enables the complete scoped eight-bit candidate: all/global scope,
fresh intervals at layer transitions, eight-bit interval values, optional
input restart and consume, and next-input actions retained across layer changes.
Layer-generated timer actions do not consume a one-shot layer; a consumed wake
input also preserves it until an ordinary physical binding consumes it.

*Experimental images still advertise the unchanged configuration version and
use an incompatible timer layout. They are for measurement, not device flashing.*
A published format, migration and editor support remain separate work. No
config-v10 document, configurator change, release generation, upload or commit
was made in this investigation.

## Verification and reproduction

- Both retained modes and both boards build at the real 14,336-byte limit.
- The full normal firmware host suite passes: config, actions, protocol, USB,
  both physical-input variants and five build-layout tests.
- Targeted native experiment probes pass on both boards, including interval
  boundaries, independent phase, four selectors/timers, image/string bounds,
  scope validation, momentary/one-shot layers, brief leave/return transitions,
  repeated expiry, consume/restart, and pending actions across layer changes.
- All global width/range variants passed their boundary probes. The added
  high bits are tested individually and together at maximum period.
- The USB differential probe matched 38 request scenarios × 65,536 lengths
  (2,490,368 cases), including complete multi-packet descriptor transfers,
  packet bytes, endpoint status/length and configuration/reset effects. The
  comparison uses a separate 64-bit digest for each scenario. It supplements
  the permanent direct-assertion tests that exhaust all lengths for seven
  important request classes, including high-byte aliases.
- The timer probe also compares CRC against an independent bit-at-a-time
  reference on 1,000 deterministic images, checking exclusion of bytes 6–7.
- Linked startup retains external-RAM clearing and P2 page selection; paged and
  external memory guards pass. `git diff --check` passes.

Commands:

```sh
# Historical, pre-optimization global interval comparisons:
python3 protocol/build-global-interval-probes.py
python3 protocol/build-global-interval-probes.py --range

# Historical baseline and retained optimization comparisons:
python3 protocol/build-timer-fit-probes.py

# Current opt-in implementation, with the actual flash limit:
python3 protocol/build-native-layer-timer-experiment.py

# Current normal v9 behavior:
python3 tests/run_host_tests.py
```

Historical source generators now default to revision `60661c8`, making their
measurements reproducible after retaining optimizations. Override
`MACROPAD_PROBE_REVISION` to select a different revision, or `worktree` for
explicit source-generation experiments; those source-rewriting probes expect
the original five-byte implementation shape. The native build script copies the
current working tree and enables the experiment only in temporary settings.

Historical overflow probes use a relaxed 16 KiB limit solely to measure size.
The native script uses 14,336 bytes and fails on overflow. None invokes release
generation. Consolidated sources, `.hex`/`.mem`/`.map`/assembly, test logs and JSON
results are under `/private/tmp/macropad-six-byte-timer-results-yw5ym1s7/`.
Temporary artifacts can be removed by system cleanup; the scripts, tests and
retained source code provide reproduction. Hardware behavior and peak stack
usage still require device validation before a release.
