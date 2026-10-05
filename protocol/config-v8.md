# Macropad configuration image, version 8

Version 8 adds Consumer Hold and held scrolling, and improves timed-action
precision. The image remains **128 bytes**; action records remain **two bytes**,
and timed-action records remain **five bytes**. Geometry, palette, CRC, header
fields, chord identifiers, string-pool layout and other action encodings follow
[format v7](config-v7.md), with the changes below taking precedence.

## Version and migration

Header byte 2 is `8`. GET_INFO advertises configuration format 8; HID transport
remains version 1. Firmware accepts only v8. It leaves older DataFlash readable
and unchanged, but physical inputs and timers remain inactive until a valid v8
profile is saved. A firmware update alone does not migrate or erase a profile.

The current configurator reads binary formats 2–8, JSON versions 1–8 and older
drafts, then writes v8. It decodes each legacy action using its source version;
in particular, old type-9 records remain **Type Text**, never Consumer Hold.
Keys, encoder bindings, chords and both timer slots are migrated. Existing media
actions remain taps; existing scroll actions remain taps with their signed step
unchanged. Strings, timer intervals/flags, layer settings and editor metadata are
preserved. The v8 draft namespace can recover v7 drafts without overwriting them.

Use the frozen format-v7 editor for v7 firmware. The active editor closes
connections to legacy firmware and offers its matching frozen editor rather
than attempting a v8 write. Before updating hardware, export a JSON/raw backup;
after updating, import or read the old profile and explicitly Save to device.
The simulator models v8-only validation and the same inactive legacy-flash state.

## Changed action records

| Action | First byte | Second byte |
| --- | --- | --- |
| Nothing | `0x00` | `0x00` |
| Type Text | `0x10` | Offset of a complete NUL-terminated string in the shared pool |
| Consumer Tap | `0x08 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| Consumer Hold | `0x09 \| ((usage >> 8) << 4)` | `usage & 0xFF` |
| Scroll Tap | `0x07` | Signed wheel step, -127–127 |
| Scroll Hold | `0x47` | Signed wheel step, -127–127 |

Type Text shares low-nibble type 0 with Nothing: auxiliary 0 is Nothing and must
have parameter 0; auxiliary 1 is Type Text. Other auxiliary values reject. Empty
text still requires a valid pool offset pointing at a NUL byte.

Consumer Hold occupies low-nibble type 9, directly after Consumer Tap (type 8).
Both retain nonzero 12-bit HID Consumer Page usages `0x001`–`0xFFF`. Hold is
allowed on keys, encoder press and chords, but rejects on wheel rotation and on
both timer action slots. It adds no configuration bytes.

Scroll Hold uses auxiliary bit 2 (`0x40` in the first byte). Only auxiliary values
0 and 4 are accepted in the merged firmware. Acceleration bits remain reserved
and reject. Hold rejects on rotation and both timer action slots. -128 rejects;
zero is a firmware no-op, although the editor asks for a nonzero step.

All other type numbers match v7. A full first byte of `0x10` for Type Text is not
a new low-nibble action number.

## Consumer ownership and release

The most recent consumer action wins, consistently for hold-over-hold and
tap-over-hold. Previous still-held usages are **not restored**. A newer tap
interrupts a hold, sends a fresh press/release, and leaves the consumer released.
Releasing an older superseded input does not release a newer owner's hold.
Consumer outputs use a shared latest-wins pending lane; an older queued tap
cannot later replace a newer pending hold. Reports already accepted by the USB
transport retain their order.

Keyboard and consumer holds retain the binding chosen at press time across
layer changes, until physical release. Releasing either chord member ends a
chord hold. A brief press still asserts and releases under USB backpressure;
releases retry until accepted. Configuration clearing releases consumer output.
USB report-generation changes reassert the winning hold. Sustained usages use
host/application repeat behavior; firmware does not synthesize repeated taps.

## Held scrolling

Initial press sends one configured step. Holding a key, chord or encoder button
repeats that step when action playback and the USB transport are idle, with at
least 8 ms between repeat opportunities. Each step plays as individual signed
unit wheel reports, so large steps can take longer and delay later actions.
Release stops future repeats; already accepted steps finish. Multiple eligible
held scroll bindings are visited in input-index order, matching pointer holds.
Bindings survive layer changes until release. There is no scroll acceleration in
the merged build.

## Timed-action precision

Interval encoding remains 1–64 coarse ticks, each 131.072 seconds, with a maximum
of 8,388.608 seconds (2 h 19 min 48.608 s). Five-byte records, four-timer limit,
reset/resume/consume flags and due-timer-before-input ordering are unchanged.

The shared clock now samples `millis() >> 9` (512 ms). Each timer has an additional
eight-bit fractional age. Add elapsed fine ticks and carry into its coarse age
on overflow, after **256 increments**, not on reaching 255. Resetting a timer
zeros its own fraction, giving it an independent phase from its last restart.
Inputs that do not reset it preserve the fraction. Periodic firing preserves
phase; configured input/configuration resets clear it.

Dispatch quantization is less than 512 ms early instead of nearly 131.072 s.
For a one-tick interval, normal due time is greater than 130.560 s and at most
131.072 s after reset, before polling/USB playback delay and oscillator error.
This improves precision without adding finer selectable durations. The editor
shows nominal durations and this narrower range on hover.

Elapsed fine ticks account for skipped boundaries and wrap, provided polling
gaps stay below 131.072 s. This is a clock representation constraint; normal loop
polling is much faster. USB backlog can delay host-visible output separately.

## Builds and measurements

The default `experiment/v8-merged` build includes all three features and preserves
device color preview, animated rainbow and existing indicators/error blinking.
Six-key flash: **14,325 / 14,336 bytes**, three-key: **14,323 / 14,336 bytes**.
New persistent RAM: four fractional timer bytes plus three consumer-state bytes.
Held scrolling reuses existing state. See [experiment measurements](v8-experiment-results.md).

The isolated `experiment/v8-scroll-acceleration` branch includes Off/Slow/Fast and
held scrolling but omits color preview and rainbow animation. It remains a v7
experimental extension and must use its own configurator. Its accelerated
profiles reject in the merged v8 firmware. See [test instructions](v8-scroll-experiment.md).
Checked-in release firmware remains v7; no v8 release has been generated.
