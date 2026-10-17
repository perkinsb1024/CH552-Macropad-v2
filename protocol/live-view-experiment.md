# Live View Telemetry Experiment

Branch: `experiment/v17-instant-auto-sleep-and-live-view-updates`.
Baseline: `780fcc7`. Fitted firmware checkpoint: `52d34c6`.
Saved configuration remains format 16; transport remains version 1.
**Enter Auto-Sleep** is deferred. Existing release files and frozen editors are preserved.

## Implemented Behavior

The visible viewer polls input/binding status every 50ms and runtime/timer state
every 250ms. Polls run serially, pause during this page's saves, and slow to 500ms
in the background. The ordinary configurator retains its 500ms status poll.
Firmware without the extension keeps the existing profile/layer viewer.

- Blue outlines show debounced physical keys, encoder-button holds and completed
  encoder detents. Independent clockwise/counterclockwise counters include wake
  input even when its binding is consumed.
- Green flashes show accepted binding dispatch, including short taps released
  between polls. Chords identify both keys. The latest action is decoded from its
  original bytes, with the effective layer at dispatch.
- Sleep state is independent of rendered brightness. The countdown uses the
  actual coarse age and 16ms fraction; disabled state is explicit.
- Lighting reports separate indicator/key policies, including **As Configured**,
  temporary effects, blink progress, color preview, rainbow phase spacing and
  speed overrides. Rendered RGB/hue/drift are not streamed.
- Layer state includes base, previous, armed one-shot return and pending chord key.
- User timers show remaining time, pause outside their scope, pending next-input
  action and consumption. All four user timer slots remain available.
- Playback includes action/macro busy flags and binding queue depth. Persistent
  mouse-button latches and dropped-action counts appear when nonzero.
- Active profile CRC changes reload the profile. Application/reset generation
  changes clear old activity. Disconnects or samples older than one second
  suppress live outlines and show stale-state messaging. An independent 100ms
  UI clock expires feedback while a request is stalled.

## Meaning and Limits

Accepted dispatch means an immediate action was dispatched or a queued binding
was accepted; it does not confirm output completion or host application receipt.
Full-queue rejection increments the existing drop count without reporting an
accepted binding. Physical wake can occur without the configured binding firing;
timer resume actions may run instead.

Counters retain activity, and the viewer shows the latest action plus the update
count when several bindings occur between polls. Full order is unavailable.
Eight-bit counters wrap modulo 256; exactly 256 unseen events can alias to no
change. After a gap longer than one second the host establishes a baseline instead
of replaying old pulses. A short consumed key press/release between polls may not
appear in the pressed bitmap; it does not falsely report binding execution.

The layer label is the effective layer at dispatch. Pending singles may execute
action bytes captured on an earlier layer. Macro invocation and immediate macro
steps use the dispatcher; individual keyboard/scroll playback micro-steps are not
an event history. Busy state is sampled, without percentage or completion receipt.
Timer expiry and resume share a source; action bytes identify which action ran.

Runtime and timer replies are separate snapshots. Countdown accuracy is bounded
by 16ms fractions, polling, foreground latency and oscillator error. Queue depth
is the binding queue, not the USB report queue. Persistent mouse buttons report
toggle/down latches rather than every host output currently held.

## Read-Only Wire Extension

Requests retain report ID 3, the existing 32-byte USB packet, `UM` header,
transport version 1, sequence byte and zero padding. Replies retain report ID 4,
status and up to 23 data bytes. All offsets below are relative to reply data.
New opcodes require offset and length zero and unused bytes zero; existing
malformed-request errors remain. No HID descriptor, saved profile, subscription,
or additional packet buffer is needed.

### Opcode 2: GET_STATUS

The six-byte legacy prefix is unchanged. A 23-byte reply advertises this
experimental extension; legacy six-byte replies have no telemetry.

| Data Bytes | Meaning |
| --- | --- |
| 0–5 | Flash-valid flag, effective layer, startup layer, upload state, saturated dropped button/rotation counts |
| 6 | Effective layer at latest accepted dispatch |
| 7 | Debounced physical pressed bitmap |
| 8–9 | Clockwise/counterclockwise detent counters |
| 10–18 | Nine accepted binding-source counters |
| 19 | Latest source identifier |
| 20–21 | Original dispatched action bytes |
| 22 | Accepted-dispatch sequence |

Physical key bits use input order, with the encoder button at the key count (6
or 3). Binding slots use keys 0–5, encoder button at its physical index, clockwise
7 and counterclockwise 8. Unused physical slots remain unused. Counters and the
sequence wrap modulo 256, survive layer/action resets, and are never cleared by
reads. Normal startup clearing initializes them; initial zero bytes are not an
event until the sequence changes.

Key sources have bit 7 clear: low nibble is the first input index, high nibble
is the chord partner index plus one or zero for a single. The encoder button
has no partner. Non-key sources are `0x87` clockwise, `0x88` counterclockwise,
`0x89 + i` runtime timer slot i, and `0x8E` immediate macro step. The built-in
sleep slot follows all configured user timers.

### Opcode 11: GET_LIVE

Returns 23 bytes; layer indices and policies are unsigned.

| Data Bytes | Meaning |
| --- | --- |
| 0–2 | Effective, base and previous layers |
| 3 | One-shot return layer; 255 means none |
| 4 | Current action first byte; zero means no current action |
| 5 | Macro next cursor; zero means no active macro cursor |
| 6 | Binding queue depth, 0–8 |
| 7–11 | Reserved, zero |
| 12 | Pending single input index plus one; zero means none |
| 13 | Persistent mouse-button mask |
| 14–15 | Rainbow spacing/speed selections, 0–3 |
| 16–17 | Indicator/key policy: **Off** 0, **Dim** 1, **Bright** 2, **As Configured** 3 |
| 18 | Preview/effect options; zero means normal configuration |
| 19 | Remaining 250ms indicator/effect phases |
| 20 | Reserved, zero |
| 21 | Application/reset generation, modulo 256 |
| 22 | Reserved, zero |

Options retain palette in bits 4–7, brightness in bit 0, temporary-effect marker
in bit 1 and indicator options in bits 2–3. Nonzero options with bit 1 clear are
a configurator color preview; bit 1 set means a temporary effect. These overlays
retain existing rendering precedence over brightness policies. Generation increments
when profile/input state is applied, including USB reconfiguration; it is not a
persistent reboot counter. Reconnect establishes a fresh baseline independently.

### Opcode 12: GET_TIMERS

Returns 17 bytes. User timers occupy slots 0 through count minus one; the built-in
sleep timer occupies slot count. The host ignores unused slots.

| Data Bytes | Meaning |
| --- | --- |
| 0–4 | Low coarse ages for five runtime slots |
| 5–9 | High age/pending bytes |
| 10–14 | Fine fractions |
| 15–16 | Active profile's stored CRC-16, little endian |

High-byte bit 0 means a next-input action is pending; bits 3–5 hold high coarse
age. Elapsed ticks are `age + ((high & 0x38) << 5) + fraction / 256`.
One tick is 4.096 seconds. Remaining time is configured interval minus elapsed,
clamped at zero. Sleep intervals are 220, 440, 879 or 1,758 ticks. The viewer shows
disabled/sleeping state explicitly rather than assuming a countdown is running.

## Fitting Results

| Hardware | Baseline Flash | Final Flash | Flash Free | Baseline Stack Reserve | Final Stack Reserve |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six Keys | 14,286 | 14,331 | 5 | 91 | 103 |
| Three Keys | 14,282 | 14,327 | 9 | 94 | 106 |

Both pass the real 14,336-byte application limit. Paged RAM remains 107 bytes.
Ordinary external RAM is 404/395 bytes; with USB DMA 148 and absolute
configuration/runtime 134, total external allocation is 793/784 bytes, up 32 per
board. Stack reserve increases 12 bytes per board. These are linker capacities,
not hardware high-water measurements.

The initial prototype used 14,874/14,870 bytes. Optimization recovered 543 bytes
per board versus that prototype. All telemetry states fit without cutting or
degrading existing features. See [candidate measurements](live-view-fit/candidate-results.json),
[firmware source hashes](live-view-fit/firmware-sources.json), and the local
`potential_optimizations.md` notebook. Candidate sources, relative patches,
assembly/maps/HEX and logs remain in `/private/tmp/macropad-live-v17/`.
Reduced-telemetry fallbacks were measured but were not adopted.

## Validation

The complete host runner passes with preview on and off: 27 C-suite executions,
eight layout tests and 19 bootloader tests per mode, including both geometries
and the added scanner/dispatch/protocol suite. Focused telemetry checks also pass
both geometries in both preview modes. Real-limit native builds pass paged,
external, absolute-image, startup and USB interrupt-parameter checks.

Viewer checks cover legacy fallback, string/macro action decoding, chord sources,
wrapped/bidirectional detents, consumed input, blocked/stale requests, profile CRC
reload and reset recovery. Six- and three-key simulator pages were inspected in
Chrome. Final shared deployment gate results are recorded with the final checkpoint.
Hardware validation remains pending; no firmware was flashed or released.

Final validation used revision `52d34c6` with uncommitted viewer/documentation
changes; [the validation manifest](live-view-fit/validation.json) records exact
viewer source hashes and native HEX hashes. The final commit contains those
validated sources. Committed firmware rebuilds are byte-identical to the fitted
measurements on both boards.

- Firmware: both complete host modes, both real-limit native links, and
  AddressSanitizer/UndefinedBehaviorSanitizer runs for configuration, protocol
  and live-state suites on both geometries pass.
- Configurator: all 758 tests across 64 files pass.
- Uploader: build and all 91 tests pass against existing published release files.
- Complete site: TypeScript and production build pass; all 14 frozen archives
  retain their verified checksums. The complete `npm run verify:deploy` gate passes.

The required browser-facing build has been produced. Hardware validation remains
pending; no release artifacts were generated, firmware flashed, or site published.
