# Test 1 — HID traffic, chords, strings and action queues

Profile: [6-key-test-1-profile.json](6-key-test-1-profile.json).
Six-key boards only. Keys 1–6 mean firmware inputs U1–U6, not their array indexes.
JSON layer indexes are zero-based; the tables use the editor's Layers 1 and 2.

Bootloader entry by a **3-second encoder-button hold** is enabled on every
layer. Use short encoder presses during normal workload steps. Download the
results before entering the bootloader; restarting the firmware resets the watermark.

## Prepare and read results

1. Export your existing profile. On this validation branch, use PlatformIO's
   **ch552 → Upload** task or run `pio run -t upload` from the repository root.
   This builds/uploads the diagnostic; six-key variant 0 and stack testing are
   already selected in `platformio.ini`. Hold the encoder button while connecting
   USB to enter bootloader mode, release it, then run Upload. The web uploader
   cannot select the custom HEX files in this directory.
2. From the repository root run
   `python3 -m http.server 8765 --bind 127.0.0.1`.
   Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome/Edge.
   Disconnect the configurator before connecting the reader.
3. Click **Connect**, select **Test 1**, and click **Save selected test profile to
   device**. The companion binary is verified against flash. Alternatively import
   this JSON and save using the v7 configurator, then disconnect it.
4. Power-cycle the board, reconnect, set label `test-1-startup`, and click
   **Read stack**. This baseline already includes initialization and enumeration.
5. Use the reader's typing target for letters/macros and a disposable document or
   drawing area for mouse actions. These bindings type text, click/drag, move the
   pointer, scroll and reduce system/media volume. Avoid holding pointer movement
   for long periods; release all inputs after each sequence.

## Bindings

| Input | Layer 1 | Layer 2 |
| --- | --- | --- |
| Key 1 | Hold A | Toggle left mouse button |
| Key 2 | Hold Shift+B | Right click |
| Key 3 | Type `Stack A! 09`, tab, `xy`, newline | Hold upward pointer movement |
| Key 4 | Left double-click | Consumer volume down |
| Key 5 | Hold left mouse button | Tap C |
| Key 6 | Hold rightward pointer movement | Type `Queue B? []{}` + newline |
| Encoder press | Next layer, wrapping | Next layer, wrapping |
| Clockwise / counterclockwise | Scroll −3 / +3 | Pointer right +4 / down +4 |
| Chord 1+2 | Type `Chord C!` + newline | Consumer volume down |
| Chord 3+4 | Shift+D tap | Scroll −7 |
| Chord 5+6 | Left double-click | E tap |

Chord window is 75 ms. A single key waits for that window to expire; wait at
least 100 ms before adding another key when you want overlapping single actions
instead of a chord. Layer 1 has variable-phase, extra-fast dim Rainbow; Layer 2
blinks Cyan by layer number.

## Workload

1. Label `test-1-singles`. With the reader idle, exercise every input on both
   layers 20 times. Hold the held bindings for 1–2 seconds. Toggle Layer 2 Key 1
   on and off (press twice); release held mouse buttons before switching apps.
   Read the stack after each layer.
2. Label `test-1-chords`. Repeat all three chords on each layer 30 times.
   Vary release order, release only one member briefly, and release both before
   repeating. Try second presses just inside and outside the 75 ms window.
   Read the stack.
3. Label `test-1-overlap`. On Layer 1, hold Key 1, wait 100 ms, then hold Key 2;
   repeatedly press Key 3 while turning the encoder. Repeat with Key 5 held and
   single/double clicks, and with Keys 5/6 pressed more than 100 ms apart.
   On Layer 2, repeatedly start the Key 6 string while rotating rapidly and
   pressing other single keys/chords. Repeat 30 sequences. Switch layers while
   a string is playing and while keyboard/mouse inputs are held; then release.
   This exercises playback cancellation, release reports and bounded queues.
4. Label `test-1-usb`. Click **Start USB read stress**, leave preview cycling
   unchecked, focus the typing target, and repeat the overlap/chord workload
   for at least 5 minutes. The reader interleaves full flash/active-image reads
   with HID reports. Enable preview cycling and repeat for another 2 minutes.
5. Click **Stop**, wait for it to finish, label `test-1-final`, and **Read stack**.
   Click **Download results CSV** before unplugging. Repeat after a fresh power
   cycle to vary interrupt timing; save the second run separately.

## Assess the readings

The six-key stack capacity should be **120 bytes**, starting at **0x88**.
Record the maximum observed usage and minimum untouched headroom across the run,
plus dropped button/rotation actions. Drops during deliberate queue saturation
are supported behavior and do not alone indicate stack overflow. Record hangs,
USB loss, unexpected resets or stuck outputs separately.

Reads retain previous peaks across layer changes and saves; power cycles reset
the firmware watermark. Zero headroom means the upper boundary was touched.
The scan adds no call frame, but the protocol request's normal frames are included.
An `0xA5` coincidence can undercount usage, so this is observed coverage, not proof
against all overflows. See [README.md](README.md) for interpretation and build hashes.
