# Test 3 — four timers, resume actions, configuration saves and recovery

Profile: [6-key-test-3-profile.json](6-key-test-3-profile.json).
Six-key boards only. Keys 1–6 are firmware inputs U1–U6. Layers below are
one-based; JSON layer indexes are zero-based.

## Prepare and read results

1. Export your existing profile. On this validation branch, use PlatformIO's
   **ch552 → Upload** task or run `pio run -t upload` from the repository root.
   This builds/uploads the diagnostic; six-key variant 0 and stack testing are
   already selected in `platformio.ini`. Hold the encoder button while connecting
   USB to enter bootloader mode, release it, then run Upload. The web uploader
   cannot select the custom HEX files in this directory.
2. Run `python3 -m http.server 8765 --bind 127.0.0.1` from the repository root.
   Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome/Edge.
   Disconnect the configurator, **Connect**, select **Test 3**, and click
   **Save selected test profile to device**. Or import this JSON and save using
   the v7 configurator, disconnect it, and connect this reader.
3. Power-cycle, reconnect, label `test-3-startup`, and click **Read stack**.
   Focus the reader's typing target for text tests; use a disposable drawing
   area for mouse clicks. Bindings type, click/scroll/move the pointer and reduce
   system/media volume.
4. Use **Monitor once per second** during timer waits and **Read stack** after
   stopping each stage. Download the CSV before unplugging/resetting/reflashing.

## Bindings and timers

| Input | Layer 1 | Layer 2 |
| --- | --- | --- |
| Key 1 | Type `Timer T!` + newline | Shift+G tap |
| Key 2 | Bright Rainbow always on | Restore temporary effect |
| Key 3 | One-shot Layer 2 | Previous persistent layer |
| Key 4 | F tap | Consumer volume down |
| Key 5 | Left double-click | Pointer right +3 |
| Key 6 | Toggle both-off preset | Restore all LED settings |
| Encoder press | Next layer, wrapping | Next layer, wrapping |
| Clockwise / counterclockwise | Scroll −2 / +2 | Pointer up −3 / down +3 |

Global chords: **1+2** types `Chord U?` + newline, **3+4** starts dim Rainbow
blink 8, **5+6** returns to Layer 1. Chord window is 75 ms; separate presses by
at least 100 ms for overlapping single actions.

All four timers use one tick: **131.072 seconds**. They run on shared uptime
boundaries, so the first firing can be sooner; later firings repeat every tick.
Saves/reset restart ages. Timer-generated layer changes/effects can replace
earlier visuals in the same loop, so final LEDs alone cannot demonstrate that
every timer ran.

| Timer | Reset on physical input | Consume next physical input | Expiry | Next-input action |
| --- | --- | --- | --- | --- |
| 1 | No | No | Dim Rainbow blink 8 | Restore temporary effect |
| 2 | No | No | Type `Timer T!` + newline | One-shot previous layer |
| 3 | Yes | No | Relative layer +1 | Restore all LED settings |
| 4 | Yes | Yes | Both-off preset | Both as configured preset |

After all four expire, the next press/detent runs their next-input actions in
order and is consumed because Timer 4 requests consumption. Its normal binding
does not run. The following input works normally. Timer 2's one-shot can remain
armed for that following input. All four timers apply across layers.

## Workload

1. Label `test-3-all-expire`. Start **Monitor once per second**, focus the typing
   target, and leave physical inputs idle for **at least 140 seconds**. At the
   first shared tick, all four expiry paths run; the final preset turns LEDs off.
   Timer 2's text should play. Press a key or rotate one detent to run all four
   resume paths. That first event is consumed; try another event to exercise the
   normal binding/remaining one-shot. Repeat three full idle/expiry/resume rounds.
   Stop and read the stack.
2. Label `test-3-overlap`. Run **Start USB read stress** with preview cycling off.
   Repeat chords, strings and encoder bursts across both layers for 5 minutes.
   Timers 1/2 keep expiring during input; Timers 3/4 reset on physical input.
   Periodically arm the Layer 1 Key 3 one-shot just before a tick and press a key
   just after it. Press several inputs around the boundary to exercise timer
   resume dispatch followed by physical/chord/layer dispatch. Enable previews
   and repeat for another 2 minutes. Stop and read the stack.
3. Label `test-3-saves`. With monitoring/stress stopped, save Test 1, then Test 3,
   five times each, alternating to force changed DataFlash bytes. Each save
   verifies flash and tests an idempotent repeated commit. During a few saves,
   keep a key pressed or rotate the encoder. Release everything afterward and
   confirm outputs clear and inputs work again. Read after each save. Saving
   retains the watermark but resets timers/layers/action queues.
4. Label `test-3-rejections`. Click **Exercise rejected uploads**. It stages an
   image with wrong declared CRC (expect `BAD_CRC = 7`), then invalid magic with
   correct CRC (expect `BAD_CONFIG = 6`), aborts both, and checks flash unchanged.
   Repeat five times, then save Test 3 once more and run an idle expiry/resume
   round. Record any error or failure to recover.
5. Label `test-3-final`, **Read stack**, and download the CSV. Then power-cycle
   three times, reconnecting and taking a separately labeled startup sample each
   time. These are fresh runs, not continuation of the preceding peak. If you can
   trigger a USB bus reset while preserving board power, sample immediately
   afterward as well; simply closing/reopening HID is not a USB bus reset.
6. Optional: test invalid-saved-profile startup using the explicit erase-config
   procedure in [README.md](README.md). Export/download first; it clears flash
   and reflashes the diagnostic, starting a new run. Read the error-mode result,
   exercise preview, save Test 3, and read the recovered state. Do not create this
   condition by interrupting a save.

## Assess the readings

Expect capacity **120 bytes** and base **0x88**. Record maximum usage/minimum
headroom for each continuous powered run, especially expiry, resume and saves.
The status log reports flash validity, layer and dropped-action counts; a full
queue may legitimately drop actions. Note hangs, resets, stuck outputs or USB
loss independently of the last successful reading.

Zero headroom means the upper boundary was touched. Reads include the existing
protocol frames and interrupt history, while the scan itself adds no frames.
Pattern coincidences and untested paths limit the conclusion; a positive margin
is useful evidence, not a guarantee. Build hashes and detailed limits are in
[README.md](README.md).
