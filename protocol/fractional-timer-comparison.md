# Eleven-bit timers with and without fractional phase

Decision: retain the fractional counters. Removing them increases flash use,
and preserving the current stack capacity is a priority for subsequent work.

Measured from checkpoint `b40b1aa` on both hardware variants with
`CONFIG_TIMED_LAYER_EXPERIMENT=1`. The eleven-bit interval encoding, layer
scoping, layer-change resets and preserved armed next-input actions are retained
in both versions. The comparison changes temporary source copies only.

## Results

All quantities are bytes.

| Pad | Per-timer fractional counter | Flash | Spare flash | Internal RAM occupied | Paged RAM | Other external RAM | Available stack |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six keys | Present | 14,294 | 42 | 180 | 108 | 496 | 75 |
| Six keys | Removed | 14,302 | 34 | 176 | 108 | 496 | 79 |
| Three keys | Present | 14,292 | 44 | 177 | 108 | 487 | 78 |
| Three keys | Removed | 14,300 | 36 | 173 | 108 | 487 | 82 |

Internal occupancy is counted from SDCC's RAM layout, including register banks,
bit storage and overlaid locals, excluding unused holes and the stack region.
The fixed 148-byte USB DMA reservation is additional to the paged/other external
columns and is unchanged. Available stack is the linker's reserved capacity,
not a measured runtime peak or guaranteed runtime margin.

Removal saves four internal bytes, enlarges the stack region by four bytes and
uses eight additional flash bytes on either board. Paged and other external RAM
are unchanged. Both versions fit the actual 14,336-byte application limit.

## Implementation and timing tradeoff

The retained version uses `millis()` bits 4–11 for a 16 ms fine clock and one
fractional byte per timer. After 256 fine ticks, a timer's interval age advances
by one 4.096-second unit.

The removal variant deletes `timedFraction[4]`, its carry check and its reset
writes. It counts a shared 4.096-second clock directly, using `millis()` bits
12–19. The poll loop processes every elapsed coarse tick so delays do not discard
partial progress or skipped expiries. Its eight-bit clock wraps every 1,048.576
seconds; polling must occur before an entire wrap elapses.

Starting or resetting a timer now aligns it with the shared coarse clock. The
first expiry can be approximately 4.096 seconds early, rather than approximately
16 ms, before accounting for polling/queue delays and oscillator accuracy.
Uninterrupted repetitions retain the selected period. Interval resolution and
maximum duration remain 4.096 seconds and 8,388.608 seconds in both versions.

The wider clock extraction and coarse-tick catch-up loop offset the code saved
by deleting fractional tracking. A direct `clock >> 12` build used 14,320 /
14,318 bytes, an increase of 26. Narrowing the intermediate expression to
`(uint16_t)(clock >> 8) >> 4` produces the same clock byte and lowers that increase
to eight bytes, as shown above. An alternative that combined the two clock
fragments generated a smaller flash estimate but failed internal-RAM allocation;
it was rejected and is not a usable build.

## Validation and reproduction

Both final pairs passed the targeted host probes and actual-limit firmware
builds, including startup and RAM layout checks. The probes cover interval
boundaries through 2,048, high bits and both flags, all metadata combinations,
scope validation, phase/reset behavior, global/scoped timers, momentary and
one-shot layers, and pending-input preservation. Additional removal checks
exercise multiple elapsed coarse ticks, clock-byte wrap, and an expiry that
changes layer during catch-up. Equivalent clock extraction expressions were
checked against the direct shift on one million deterministic samples.

No hardware upload or runtime stack-peak measurement was performed. Repository
firmware, configuration version, configurator and release files are unchanged.
Only this report and the reproduction script are new; no commit was made.

```sh
python3 protocol/build-fractional-timer-comparison.py
```

The default builds compare the current repository implementation with the
optimized coarse-clock variant, in temporary directories. To measure the direct
full-word shift separately:

```sh
python3 protocol/build-fractional-timer-comparison.py coarse-full-shift
```

Final artifacts contain source snapshots, hex files, memory maps, logs and probes:

`/private/tmp/macropad-fractional-comparison-cynnjdyj/`

- [Results](/private/tmp/macropad-fractional-comparison-cynnjdyj/results.json)
- [Six-key variant without fractional counters](/private/tmp/macropad-fractional-comparison-cynnjdyj/coarse-narrow-shift-0/build/firmware.hex)
- [Three-key variant without fractional counters](/private/tmp/macropad-fractional-comparison-cynnjdyj/coarse-narrow-shift-1/build/firmware.hex)

These remain experimental six-byte configuration images; existing v9
configurator timer records are incompatible with them.
