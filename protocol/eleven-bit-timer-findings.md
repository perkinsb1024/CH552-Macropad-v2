# Eleven-bit layer-scoped timer test builds

Both hardware variants fit the real 14,336-byte application limit with the
per-timer fractional counters retained. No feature degradation or removal was
needed. These measurements extend the [eight-bit investigation](six-byte-timer-intervals-and-fit.md).

The measured scheduler has been promoted to production v10 in
`src/timed_actions.inc`, with its high counter bytes in `src/actions.c` and the
16 ms clock in the main sketch. The fractional counters remain enabled. The
[configuration-v10 specification](config-v10.md) defines the finalized layout,
layer behavior and migration rules. The configurator now supports this format.
Production v10 builds retain the measurements below.
| Hardware | Flash bytes | Spare bytes | Paged RAM bytes | External RAM bytes | Available stack bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,294 | 42 | 108 | 496 | 75 |
| Three keys | 14,292 | 44 | 108 | 487 | 78 |

The previous optimized eight-bit images used 14,292 / 14,290 bytes. These
eleven-bit builds are only two bytes larger after the additional scheduler
optimizations below. That comparison includes both the wider counters and those
optimizations; widening the original scheduler alone costs substantially more.

## Stack-capacity breakdown

The available stack region decreased by 36 bytes on either board. The timer
changes account for 11 bytes of that reduction; the flash-saving RAM
optimizations account for the other 25 bytes.

| Stage | Six-key stack bytes | Three-key stack bytes | Reduction from preceding stage |
| --- | ---: | ---: | ---: |
| Original v9 | 111 | 114 | — |
| Optimized v9, original timers | 86 | 89 | 25 |
| Layered eight-bit timers | 82 | 85 | 4 |
| Layered eleven-bit timers | 75 | 78 | 7 |

The largest RAM-placement tradeoff moved 28 bytes of button/debounce state from
external RAM into internal RAM, which shares capacity with the stack. Other
allocation changes partially offset that cost. These figures are linker-reported
stack capacities, not measured runtime stack usage.

## Record layout and timing

The record remains six bytes, with ordinary two-byte expiry and next-input
actions. Its metadata uses every available bit:

| Offset | Meaning |
| --- | --- |
| 0 | Low eight bits of interval minus one |
| 1–2 | Expiry action |
| 3–4 | Next-input action; **None** remains allowed |
| 5 bits 0–2 | Global selector 0, or layer index plus one 1–7 |
| 5 bits 3–5 | High three bits of interval minus one |
| 5 bit 6 | Consume the first physical input after firing |
| 5 bit 7 | Restart interval on physical input |

Intervals are 1–2,048 units of 4.096 seconds, preserving the maximum duration of
8,388.608 seconds (2 h 19 min 48.608 s). Each timer retains its own fractional
byte: a carry after 256 fine ticks advances its interval counter. Fine ticks now
represent 16 ms, so restart alignment uses that quantum rather than a full
4.096-second unit. Actual firing can also be delayed by polling, and this does
not alter hardware clock accuracy.

Scoped timers reset their interval and fractional phase on actual effective
layer changes. Global timers keep counting. Already armed next-input actions
survive those changes and remain usable outside the timer's assigned layer,
including their consume flag. Momentary and one-shot layers retain the previously
tested behavior.

The byte fine clock wraps every 4.096 seconds. Poll gaps must remain below that
duration to avoid losing an entire wrap. The test builds retain the existing
compact-clock design; hardware timing under long blocking stalls was not tested.

## Optimizations and rejected removal

All successful measurements below retain the fractional counter and all timer
features. They also retain the earlier USB, button-state and protocol-state
optimizations.

| Cumulative implementation | Six-key flash | Three-key flash | Saving from preceding row |
| --- | ---: | ---: | ---: |
| Straightforward sixteen-bit runtime interval counter | 14,390 | 14,388 | — |
| Split low/high runtime bytes; high byte stored in the record's bit positions | 14,382 | 14,380 | 8 |
| Let SDCC allocate scheduler locals directly; keep persistent pending bytes in indirect RAM | 14,346 | 14,344 | 36 |
| Read each record's flags byte once per event and reuse it | 14,300 | 14,298 | 46 |
| Check the assigned layer inside the tick branch | 14,294 | 14,292 | 6 |

The final counter stores its low byte in paged RAM and its high three bits in an
indirect RAM byte. A low-byte wrap adds 8 to that high byte, allowing comparison
with record bits 3–5 without sixteen-bit shifting or counter arithmetic. The
four added high bytes account for four additional persistent RAM bytes compared
with the eight-bit experiment.

Separate comparison of the sixteen-bit counter's bytes did not save flash.
Moving pending bytes into paged RAM also grew code. Some more aggressive local
and state placements failed internal-RAM or page-zero layout checks and were
rejected.

A straightforward removal of the fractional counters was measured too. It
needed a coarser full-word clock and processing of elapsed coarse ticks, and
used 14,412 / 14,410 bytes: 22 more than the straightforward fractional version.
It did not fit. Further removal work was unnecessary once the complete version
fit. The final images preserve the fractional counters.

## Validation and artifacts

The final two images linked with the actual 14,336-byte ceiling and passed the
existing build-time RAM layout checks. Their host probes cover interval values
across every low/high counter boundary up to 2,048, all eight high-bit values
with all consume/restart combinations, repetition, fractional clock wraps,
independent reset phase, every sixth-byte metadata combination, scope validation,
all four timers, global/scoped behavior, effective layer changes and retained
armed next-input actions. Config CRC and string-pool checks also passed.

The normal host regression suite passed configuration, actions, protocol, USB,
both hardware input variants and five build-memory checks. No hardware upload
or physical timing test was performed.

Build and test the repository implementation directly with:

```sh
python3 protocol/build-native-layer-timer-experiment.py
```

The direct implementation builds reproduce the table above. Their source,
firmware, maps and probe logs are in:

`/var/folders/g4/ryjh4prx2h5c6hpmzmtypm400000gn/T/macropad-native-layer-timers-5y0qjlgl/`

Reproduce the original experimental comparisons with:

```sh
python3 protocol/build-eleven-bit-timer-probes.py
```

This comparison generator pins the pre-implementation eight-bit source revision
`0b3629e296924f6fea1a1d557f5fb20e7904dead`, so its source transformations remain
reproducible after the firmware implementation. For an overflowing measurement
rather than a usable build, for example:

```sh
python3 protocol/build-eleven-bit-timer-probes.py --measure reference split-age split-local-only
```

Final artifacts, including source snapshots, host probes, logs, maps and hex files:

`/private/tmp/macropad-eleven-bit-test-builds-5hitr2jh/`

- [Six-key firmware](/private/tmp/macropad-eleven-bit-test-builds-5hitr2jh/six-key.hex)
- [Three-key firmware](/private/tmp/macropad-eleven-bit-test-builds-5hitr2jh/three-key.hex)
- [Size results](/private/tmp/macropad-eleven-bit-test-builds-5hitr2jh/results.json)

The artifacts above are historical experiment builds: they advertise version 9
but use the experimental six-byte layout and require a matching test profile.
Current production test builds advertise version 10. The comparison generator
changes only temporary source copies; the direct build script uses the repository
implementation. Checked-in release files remain the published v9 images.

## v10 preparation validation

The production native builds use 14,294 bytes of flash on six-key pads and
14,292 on three-key pads, with 75/78 bytes of stack capacity. The full firmware
host suite passes on both variants. Configurator tests cover every sixth-byte
metadata combination, 11-bit boundaries, exact v9 interval migration, storage
overflow recovery, layer reordering/removal and scoped reachability. The frozen
v9 editor retains compatibility with the published firmware. The user confirmed the full v10 hardware suite passed, including the stack
sanity check with 39 bytes observed on the six-key pad. See the
[hardware checklist](v10-hardware-validation.md).
