# v10 stack sanity check

One workload profile covers the v10 stack sanity check. The reader automatically
chooses its six-key or three-key encoding; there is no sequence of separate test
profiles. Export your current configuration before replacing it.

## Setup and short run

1. Enter bootloader mode by holding the encoder button while connecting USB,
   then release it. From the repository root, upload the already-verified
   diagnostic matching your board:

   ```sh
   python3 "Stack Test/upload-stack-firmware.py" 6
   ```

   Use `3` instead of `6` for a three-key pad. This verifies the HEX checksum and
   uploads that diagnostic directly; normal PlatformIO builds remain normal v10
   firmware. The bundled web uploader installs published v9 and cannot select
   these diagnostic images.
2. Start the reader server from the repository root:

   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1
   ```

   Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome or Edge.
   Disconnect the configurator before connecting the reader; use this reader to
   save the test profile because diagnostic status replies include extra bytes.
3. Click **Connect**, then **Save sanity profile to device**. The reader verifies
   all 128 saved bytes and retries **COMMIT** without another flash write. Unplug
   and reconnect USB to start a fresh run after saving. Reconnect the reader and
   click **Read stack** for the boot/USB baseline.
4. Focus **Typing target**. Mash keys, combinations and holds, turn the wheel
   rapidly in both directions, and click it to cycle through the layers. Spend
   about 20 seconds per layer, including **Layer 2** for its scoped timer. Pause
   input for 15 seconds once to fire the inactivity timer, then mash again to
   exercise its next-input action.
5. Click **Start USB read stress** and repeat a brief pass through the layers.
   The reader focuses **Typing target** automatically. Optionally enable **Cycle
   LED previews during USB read stress** for part of this pass. Click **Stop**,
   then **Exercise rejected uploads** and **Read stack**. Rejected uploads check
   CRC/config validation and confirm that the saved flash remains unchanged.
6. Click **Download results CSV** before unplugging. Record the greatest observed
   usage and smallest untouched headroom, board variant and any fault. Restore
   normal v10 firmware and your backed-up profile after testing.

The watermark persists through saves, layer changes and reader reconnections;
MCU restarts/power cycles reset it. **Run / stage label** labels samples without
resetting the watermark. Separate restarted runs must be compared separately.

## Mash profile

Encoder presses use **Relative layer** +1 on every layer. Long-press bootloader
entry is disabled in this profile so ordinary mashing cannot enter it; bootloader
entry by holding the encoder during power-on remains available. All timers have
**Consume this input** off, so encoder presses still execute their binding.

Keyboard actions send only A–D, plain text `T!a ` plus a newline, and Shift where
needed. There is no Tab, Escape, Ctrl, Alt, Command, browser shortcut or browser
back mouse button. There are no pointer moves or mouse clicks that could steal
focus. Consumer actions adjust host volume, including held volume-down.

Wheel rotation sends scroll steps of +127/-127. Odd-numbered layers use vertical
scroll; even-numbered layers use horizontal scroll. Key bindings also exercise
large held scroll in both axes/directions. While **Typing target** has focus,
the reader cancels the browser's wheel default behavior so the received scroll
reports do not scroll the page or invoke horizontal navigation.

| Timer | Scope | Interval | Expiry | Next input |
| --- | --- | --- | --- | --- |
| 1 | **All layers** | 4.096 s | Relative rainbow phase spacing +1 | Relative rainbow speed +1 |
| 2 | **Layer 2** | 8.192 s | **Set all LEDs**, **Always on**, **Rainbow** | Restore the effect **As configured** |
| 3 | **All layers**, input restart enabled | 12.288 s without input | **Set all LEDs**, **Blink** 8 times, **Blue** | **Restore all configured LED settings** |

Actual layer transitions restart timer 2; its armed follow-up survives leaving
**Layer 2**. Timers 1 and 3 are global. Hold a layer-changing key, release it,
and exercise the one-shot bindings to cover momentary and one-shot transitions.

| Six-key layer | Key 1 | Key 2 | Key 3 | Key 4 | Key 5 | Key 6 |
| --- | --- | --- | --- | --- | --- | --- |
| **Layer 1** | Hold A | Tap Shift+B | Text | Hold vertical +127 | Vertical -127 | Hold volume down |
| **Layer 2** | Hold **Layer 4** | One-shot relative +1 | **Rainbow** blink 8 | Hold horizontal +127 | Horizontal -127 | Volume up |
| **Layer 3** | Select **Layer 1** | Rainbow phase +1 | Toggle brightness preset | Hold volume down | Hold vertical -127 | Text |
| **Layer 4** | Hold Shift+C | Restore LEDs | **Blue** always on | Hold horizontal -127 | Tap D | **Nothing** |

On three-key pads, six layers hold the first eighteen key assignments above in
order, three per layer. The scoped timer still runs on **Layer 2**. On both pads,
Key 1 + Key 2 is a global text chord. Six-key pads also have a local Key 1 + Key 3
one-shot **Layer 4** chord on **Layer 1**. Storage is 127/128 bytes on six-key pads
and 126/128 on three-key pads. Both variants use the same text string pool.

This is a sanity workload rather than a repeat of the exhaustive v7 matrix.
Mouse-click/pointer paths and dangerous modifier combinations are omitted for
safe browser mashing. Timer consumption and the longest 11-bit durations already
have automated coverage; these short timers exercise the live scheduler and
layer-reset/pending-input paths.

## Measurement and build checks

| Variant | Normal flash | Diagnostic flash | Diagnostic spare | Stack base | Capacity |
| --- | ---: | ---: | ---: | --- | ---: |
| Six-key | 14,294 | 14,332 | 4 | `0xB5` | 75 |
| Three-key | 14,292 | 14,330 | 6 | `0xB2` | 78 |

The diagnostic costs 38 flash bytes and no additional RAM. It fills the unused
stack with `0xA5` at the start of `main()`, after C initialization and before
`init()` enables interrupts. The existing **GET_STATUS** opcode 2 retains its
first six bytes and appends two diagnostic bytes: linker stack base and highest
non-pattern address. Normal firmware continues to return six bytes. The old
v7 diagnostic opcode 10 is not used.

Inline filling/scanning adds no call frames. Scanning briefly masks interrupts
and restores their previous state. The linked machine-code checks execute every
possible watermark position with interrupts initially enabled and disabled.
They also compare all RAM allocations, workload assembly and USB interrupt
assembly against normal v10 builds. Both variants retain their normal 75/78-byte
stack capacities and 108-byte paged RAM allocations; external RAM remains
496/487 bytes respectively. `firmware-build.json` records HEX/map/memory hashes.

Observed usage is `highest - start + 1`; untouched space is `255 - highest`.
The diagnostic includes startup, enumeration, workload interrupts and the
existing status-request stack frames. It excludes the preceding C startup and
ROM bootloader. Pattern collisions can undercount, so retain the maximum observed
usage/minimum headroom. Zero untouched bytes, a hang, reset, stuck output or USB
loss should be recorded as a fault; watermark testing cannot prove all paths or
reliably detect an overflow that wraps the 8-bit stack pointer.

Rebuild/check from the repository root:

```sh
node "Stack Test/build-test-images.mjs"
python3 "Stack Test/build-stack-firmware.py"
node --test "Stack Test/reader.test.mjs"
python3 tests/run_host_tests.py
```

The builder uses temporary normal/diagnostic source copies at the actual flash
limit, validates the linked diagnostic and both profile images with the real
firmware parser, and saves diagnostic artifacts here. It does not generate
release files or upload a board. `ENABLE_STACK_TEST=1` enables instrumentation;
the default project configuration does not define it.
