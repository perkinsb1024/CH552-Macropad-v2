# Test 2 — layer history, momentary/one-shot layers and LED paths

Profile: [6-key-test-2-profile.json](6-key-test-2-profile.json).
Six-key boards only. Keys 1–6 are firmware inputs U1–U6. Layer numbers below are
one-based; previous layer is one remembered persistent layer, not a history stack.

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
2. Run `python3 -m http.server 8765 --bind 127.0.0.1` from the repository root.
   Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome/Edge.
   Disconnect the configurator, click **Connect**, select **Test 2**, and click
   **Save selected test profile to device**. Or import this JSON and save in the
   v7 configurator, disconnect it, and connect the reader.
3. Power-cycle, reconnect, label `test-2-startup`, and click **Read stack**.
   These bindings change layers/LEDs without typing or moving the mouse.
4. Use **Read stack** between stages and **Download results CSV** before any
   power cycle. A baseline after restarting includes initialization/enumeration.

## Bindings

| Input | Layer 1: base | Layer 2: policies | Layer 3: one-shot effects | Layer 4: history |
| --- | --- | --- | --- | --- |
| Key 1 | Momentary Layer 2 | Cycle both brightnesses +1 | Variable phase | One-shot previous |
| Key 2 | One-shot Layer 3 | Key brightness −1 | Extra-fast speed | One-shot relative −2 |
| Key 3 | Set Layer 4 | Indicator brightness +1 | Red blink once | Relative layer −3 |
| Key 4 | Dim Rainbow blink 8 | Bright Rainbow always on | Cyan blink 4 | Both dim preset |
| Key 5 | Toggle both-off preset | Restore temporary effect | Dim Rainbow always on | Restore all LED settings |
| Key 6 | Restore all LED settings | Previous persistent layer | Previous persistent layer | Previous persistent layer |
| Encoder press | Next layer | Previous relative layer | Next layer | Next layer |
| Clockwise | Phase +1 | Preset +1 | Speed +1 | Indicator as configured |
| Counterclockwise | Speed +1 | Preset −1 | Phase −1 | Keys as configured |

Global chords on every layer:

| Chord | Action |
| --- | --- |
| 4+5 | Bright Rainbow blink 8 |
| 2+6 | Return to Layer 1 |
| 3+5 | One-shot previous layer |

Chord window is 75 ms. For overlapping singles, separate initial presses by at
least 100 ms. Layer 1 shows dim variable-phase extra-fast Rainbow; Layers 2 and
4 blink by layer number; Layer 3 uses a timed Green indicator. **Restore all LED
settings** restores phase/speed/brightness policies; **Restore temporary effect**
restores the configured visual effect. Layer changes clear a temporary effect.

## Workload

1. Label `test-2-leds`. Hold Layer 1 Key 1 to visit Layer 2, wait 100 ms, then
   exercise its brightness/preset/effect keys and encoder directions. Release
   Key 1 to return. Repeat 30 times; include dim/off/as-configured policy states.
   Read the stack.
2. Label `test-2-one-shot`. On Layer 1 tap Key 2, wait 100 ms, then press one
   Layer 3 effect key. It executes once and returns. Repeat for all six keys and
   encoder directions. Arm a one-shot and then press a global chord within the
   chord window, varying release order. Repeat 30 sequences and read the stack.
3. Label `test-2-history`. From Layer 1 select Layer 4 with Key 3. Exercise
   previous, one-shot previous and relative one-shot actions, following each
   one-shot with another LED action or rotation. Use chord 2+6 to return to Layer 1
   if necessary. Repeat 30 sequences, cycling all four layers with encoder press.
4. Label `test-2-nested`. On Layer 1 arm one-shot Layer 3 with Key 2, wait 100 ms,
   then press Layer 3 Key 6 (previous). Also hold Layer 1 Key 1 (momentary Layer 2),
   wait 100 ms, run a global layer-changing chord, and release the held key last.
   Vary overlapping presses, release order, and whether a single is still pending
   in its chord window during a layer change. This exercises pending resolution
   during layer changes, one-shot restoration and held-layer priority.
   Repeat for 5 minutes and read the stack.
5. Label `test-2-effects`. Start dim/bright Rainbow effects and let all eight
   blinks finish; switch layers midway through effects; restore policies
   while an effect runs. Test with the reader idle first, then with **Start USB
   read stress** for 5 minutes. Enable preview cycling for another 2 minutes
   while repeatedly holding/chording/rotating. Preview commands share visual
   storage with temporary effects, so replacement/cancellation is expected.
6. Click **Stop**, wait, and **Read stack** with label `test-2-final`.
   Download the CSV. Repeat the most demanding sequences after a power cycle
   with a separate run label to vary interrupt timing.

## Assess the readings

Expect **120 bytes capacity** and base **0x88**. Record the largest usage and
smallest untouched headroom plus any wrong-layer behavior, hangs, USB loss or
resets. Layer/save operations retain the watermark; firmware restart resets it.
Zero untouched bytes means the top was touched. The scan adds no stack frame;
the surrounding protocol request and previously observed interrupts are included.
Pattern coincidences can undercount, so keep the largest reading seen and use
the result as workload evidence. See [README.md](README.md) for hashes and limits.
