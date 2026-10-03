# Consume wake input and temporary LED effects

## Updated decision: finalize in-progress v7 with longer ticks

The user confirmed v7 was never published. The selected implementation now uses
v7, with bits 0–5 storing `ticks - 1`, bit 6 consuming wake input, and bit 7
restarting on input. No tail byte is reserved; all 128 configuration bytes remain
available. Superseded local v8/v9 experiments are rejected. Released v6 profiles
remain accepted with no timers.

Only the timed-action clock changed: both initialization and polling now use
`millis() >> 17`. One tick is 131.072 seconds; 64 ticks is 8,388.608 seconds
(139.81 minutes). LED, USB, debounce and other millisecond consumers are unchanged.
Shared uptime alignment remains: first firing may be up to 131.072 seconds early,
while subsequent repetitions use the full interval. Earlier local v7 timer bytes
were superseded. The v7 editor, codecs, JSON, simulator, v6 migration, bundled
profiles and protocol documentation are now implemented; hardware validation
remains pending. See [config-v7.md](config-v7.md).

| Variant | Flash used | Flash free | Stack capacity |
| --- | ---: | ---: | ---: |
| Six keys | 14,165 | 171 | 121 |
| Three keys | 14,161 | 175 | 124 |

Both builds pass the 14,336-byte limit. This saves 30 bytes versus the previously
selected 128-tick implementation, or 8 versus the earlier 64-tick prototype.
Paged RAM remains 108 bytes; external RAM remains 526/517 bytes (six/three).
Both temporary hardware builds and ordinary `pio run` passed. Host suites passed
with color preview enabled and disabled; all 251 web regressions passed.
Host regressions cover the new clock boundaries, repeated firing, the complete
64-tick interval, consumption and LED effects. These are software checks, not a
hardware timing measurement.

Reproduce with `python3 protocol/build-alert-variants.py v7-long-ticks 14336`
and `python3 tests/run_host_tests.py` (also `--no-preview`). Temporary measurements
are in `/private/tmp/macropad-v7-long-ticks/range64/build-0` and `build-1`.
The helper now builds only the selected format; comparison variants remain
preserved in the historical experiment branches below.

## Historical investigation (before the updated decision)

The remaining sections record the original comparison; references to selected
v9, legacy v7 timing, and four comparison builds describe that earlier checkpoint.


Both high-priority features are implemented in firmware and fit both CH552
variants. No existing feature was removed. This is an experimental firmware
checkpoint: editor controls, JSON/binary encoding, migration, and final protocol
documentation for the new experimental format remain follow-up work.

## Preserved checkpoints

| Branch | Checkpoint | Contents |
| --- | --- | --- |
| `experiment/timed-actions` | `168fbca` | User's original committed baseline, including the timer UI |
| `experiment/timed-wake-consume` | `38971cd` | Independently preserved wake-consumption implementation and both timer encodings |
| `experiment/timed-led-alerts` | `bda2124` | First complete combined implementation, before the final optimizations |
| `experiment/timed-alerts-optimize` | `87ba42c` | Optimized combined implementation, 64-tick default |
| `experiment/timed-alerts-128` | Current branch | Optimized combined implementation, 128-tick default and final test/report updates |

The initial combined build intentionally exceeds the device's limit; it is a
preserved implementation/measurement checkpoint, not a firmware to upload.
The final variants were built with the real 14,336-byte limit. Checked-in release
HEX files were preserved; no release generation, hardware upload, or push was
performed.

## Flash and RAM

| Build | Six-key flash | Six-key free / over | Three-key flash | Three-key free / over |
| --- | ---: | ---: | ---: | ---: |
| Original four-timer baseline | 14,231 | 105 free | 14,227 | 109 free |
| Consume only: 64 ticks | 14,333 | 3 free | 14,329 | 7 free |
| Consume only: 128 ticks | 14,355 | 19 over | 14,351 | 15 over |
| Initial combined: 64 ticks | 14,547 | 211 over | 14,545 | 209 over |
| Initial combined: 128 ticks | 14,569 | 233 over | 14,567 | 231 over |
| **Final combined: 64 ticks** | **14,173** | **163 free** | **14,169** | **167 free** |
| **Final combined: 128 ticks** | **14,191** | **145 free** | **14,187** | **149 free** |

The selected 128-tick result leaves **40 more flash bytes free than the original
baseline**, while adding both features. The 64-tick alternative saves another
18 flash bytes and avoids reserving a profile byte.

| Memory | Baseline six / three | Final 64-tick six / three | Final 128-tick six / three |
| --- | --- | --- | --- |
| Paged xRAM | 108 / 108 bytes | 108 / 108 | 108 / 108 |
| Ordinary xRAM | 532 / 523 bytes | 526 / 517 | 526 / 517 |
| Stack capacity | 122 / 125 bytes | 121 / 124 | 120 / 123 |

Page-zero storage remains exactly `0x94–0xFF` above USB DMA. A new shared
interval/release-mask scratch byte uses the slot freed by moving `lastLayer`
to `__idata`. `lastMouse` and `rainbowChanged` also move to `__idata` to maintain
valid internal allocation. The six USB/protocol boolean flags formerly in
xRAM now use native bit-addressable RAM. The final 128-tick build allocates 29
bits (four physical bytes) to bit storage, including compiler temporaries.
Stack capacity is the linker's reserved space, not a measured peak-use result;
hardware validation is still pending.

## Optimizations retained

Incremental six-key measurements with the 64-tick encoding:

| Change | Flash after change | Saved |
| --- | ---: | ---: |
| Initial combined implementation | 14,547 | — |
| Native bits for USB busy/config-waiting/config-turn flags | 14,499 | 48 |
| Native bit argument and return for shared timer event handling | 14,483 | 16 |
| Cache UI-preview identity in a native bit | 14,459 | 24 |
| Native bits for config-valid/flash-valid/reset-pending flags | 14,401 | 58 |
| Native bit returns for boolean helpers | 14,173 | 228 |
| **Total** | | **374** |

`src/firmware_types.h` defines `FW_BIT` as SDCC `__bit`, with a byte fallback for
host tests. Boolean APIs and their declarations consistently use that type:
validation, storage writes, protocol receive, USB report queueing, chord lookup,
and private action helpers. This allows callers to branch on the carry flag
instead of converting a returned byte into a boolean. Native bits differ from
C `_Bool`: the latter did not put these globals into bit-addressable RAM with
this compiler.

The generated assembly was inspected for critical USB functions: SDCC saves
the bit return while restoring the prior interrupt-enable state (`rlc a`,
`pop psw`, `mov ea,c`, `rrc a`). All project callers were rebuilt with the matching
declarations. USB descriptors, transport packets, timing core, and WS2812
cycle-sensitive assembly were not altered.

Attempts to move seven USB metadata bytes wholesale into `__idata`, or to use
C `_Bool` for the USB flags, caused internal allocation failures and were not
retained. Same-page short calls/jumps were assessed but not implemented: native
bit changes recovered enough space without build/link relaxation machinery.

## Consume wake behavior and encoding

The timer runs its expiry action normally. After it has fired, the next
debounced key press, encoder-button press, or completed encoder detent runs all
armed resume actions once. If any armed timer requests consumption, that one
physical event's ordinary action is suppressed. Other armed timers still
resume, regardless of their consume flag. Consuming also works with a `None`
resume action.

No binding or chord state is created for a consumed press; its release is
ignored by the action engine. Existing held inputs and pending singles remain
owned by their original actions. A second distinct event works normally.
Debouncing, LED key feedback, timer reset-on-input, and the encoder bootloader
shortcut remain active. Input release alone and partial encoder movement do
not trigger timer resume/consumption. Consumption does not consume an armed
one-shot layer through the skipped physical binding.

Both alternatives retain four timers and five bytes per timer, with the existing
action/resume pairs:

- **Selected: 128 ticks, experimental v9.** Interval byte retains bits 0–6 as
  `ticks - 1` and bit 7 as reset-on-input. Byte 127 stores consume flags for
  timer slots 0–3 in bits 0–3; bits 4–7 must be zero. Layer/chord/timer/string
  records must end at or before byte 126. Consume bits for unused timer slots
  are harmless and ignored. This reserves **one byte total**, not one per timer.
- **Alternative: 64 ticks, experimental v8.** Bits 0–5 store `ticks - 1`, bit 6
  means consume wake input, and bit 7 means reset-on-input. All 128 profile bytes
  remain available to the ordinary records and string pool.

Both variants explicitly accept old v6/v7 images. Legacy v7 bit 6 remains part
of its 1–128 interval, never a consume flag, and its full 128-byte storage budget
remains valid. The alternatives reject each other's experimental version to
avoid interpreting the same bytes with different semantics. A full old v7
image can still run unchanged, but needs one byte freed before conversion to v9.
CRC still covers the same 128-byte image, including the consume-mask byte.

Maximum nominal duration is about 69.9 minutes for 64 ticks or 139.8 minutes
for 128 ticks. Shared 65.536-second boundaries and potentially early first
expiry remain unchanged.

## Temporary LED effect behavior and encoding

The normal LED Control action remains two bytes. Its low action nibble is `0xF`,
its upper nibble selects palette index 0–15, and its second byte is:

| LED command | Behavior | Palette nibble |
| --- | --- | --- |
| `0x80` | Clear temporary effect / As configured | Must be 0 |
| `0x81` | Bright always-on effect | 0–14: swatches; 15: rainbow |
| `0x82–0x89` | Bright blink 1–8 times | 0–14: swatches; 15: rainbow |

These commands can be bound to ordinary inputs, chords, encoder rotations,
timer expiry, and timer resume. No layer is allocated or selected by the effect.
The entire palette/mode space is covered by validator and rendering tests.

The existing alternate indicator option byte is shared with UI color preview.
Bit 1 marks a persistent effect; its mode/color/brightness reuse the layer option
layout. Blink effects reuse the existing phase counter and 250ms deadline.
Rainbow animation activates even when the actual layer has no rainbow indicator.
Effects use current rainbow speed/phase settings and force their selected
brightness even if the underlying indicator brightness policy is off/dim.
Existing commands use Bright; firmware now also supports Dim using command bit
`0x10` (`91`–`99`). The editor exposes Full Brightness / Dim and a single Blink
choice with a 1–8 count slider. JSON stores optional `brightness: "dim"`, with
Bright as the default when omitted. Both brightnesses
reuse the existing effect-state byte and color renderer.

- Always-on survives ordinary key/encoder activity until replaced, explicitly
  cleared, or an actual layer switch/config application occurs. Reselecting the
  same layer does not cancel it.
- Blinks automatically clear the overlay and resume normal indication when
  their complete light/dark sequence finishes. A blink is 250ms light and 250ms
  dark. Clearing or completing an effect returns to normal steady-state rendering
  without restarting the layer's configured blink/timed indication.
- Pressed-key feedback overrides always-on effects, but blink phases take
  precedence, matching existing layer-indicator behavior.
- As configured removes the overlay and reveals the existing underlying runtime
  brightness policies; it does not overwrite saved configuration or reset other
  LED overrides. Existing brightness/phase/speed commands continue to modify
  those underlying policies.
- UI color preview replaces an active effect cleanly. A timer effect similarly
  replaces UI preview. These modes share storage rather than stacking.

Example with the selected v9 layout: timer expiry `[0xFF, 0x81]` enables bright
rainbow; resume `[0x0F, 0x80]` restores normal indication. Set that timer's bit
in byte 127 to consume the wake event.

## Verification and reproduction

Passed:

- Firmware host suites: config, actions, protocol, USB, and real sketch/input
  tests for both physical variants, plus five memory-layout tests.
- The suites with both timer encodings, and with UI preview disabled for each
  encoding while retaining temporary effects.
- 251 web regression tests, including the actual firmware validator accepting
  existing v6/v7 profiles.
- All four final hardware builds with the actual 14,336-byte limit, plus ordinary
  `pio run` on the selected six-key configuration.
- Generated critical-return assembly inspection and page-zero/xRAM layout checks.

New regressions cover consumed held-key lifecycles, pending chord partners,
multiple timer resumes, `None` resume actions, legacy long intervals, actual
debouncing, complete/partial encoder movement, bootloader hold, every effect
swatch and blink count, rainbow activation, key-feedback priority, replacement,
config/preview cancellation, same/other-layer selection, and timer alert/resume.
These are software tests; no connected-device behavior was tested in this task.

Reproduce current builds in temporary copies:

```sh
python3 protocol/build-alert-variants.py reproduce-alerts 14336
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --consume-inline
python3 tests/run_host_tests.py --no-preview
python3 tests/run_host_tests.py --consume-inline --no-preview
```

The build helper preserves source copies, logs, `.mem`/`.map` reports and HEX
outputs under `/private/tmp/macropad-reproduce-alerts/`. Final measured outputs
from this task are under `/private/tmp/macropad-final-alerts/`. These are temporary
build outputs, not checked-in releases. For the ordinary PlatformIO output use
`.pio/build/ch552/firmware.hex` on the selected branch.

Before configuring the new features through the browser, update the editor for
the selected experimental format, its mask/capacity, and its LED commands. The
existing v7 editor does not yet support those additions or advertise v9 support.
