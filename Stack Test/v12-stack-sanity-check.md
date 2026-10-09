# V12 Stack Sanity Check

This diagnostic measures observed stack use with the existing v12 profile. The
only disabled feature is the configurator's live color preview, as approved for
this test. Key LEDs, layer indicators, rainbow effects, LED actions, timers,
chords, text, macros, mouse actions, scrolling and bootloader entry remain enabled.
No firmware optimization was introduced to fit the diagnostic.

## Install and Read

The verified artifacts for this run are in
[/private/tmp/macropad-v12-stack-6xsnuen7](/private/tmp/macropad-v12-stack-6xsnuen7).
Temporary files may be removed by the operating system; copy the directory if
you need to retain it long term. Normal PlatformIO settings remain unchanged.

1. Hold the encoder button while connecting USB to enter bootloader mode, then
   release it. From the repository root, upload the six-key image:

   ```sh
   python3 "Stack Test/upload-stack-firmware.py" 6 /private/tmp/macropad-v12-stack-6xsnuen7
   ```

   Use `3` for a three-key pad. The helper checks the manifest and HEX checksum,
   then uploads the selected diagnostic without rebuilding. It does not issue
   a profile erase or save. Retain the existing six-key profile for the reported
   incident; a three-key pad requires its own compatible profile.

2. Start a local reader server from the repository root:

   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1
   ```

   Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome or Edge.
   Close the configurator's device connection, then click **Connect**. The reader
   identifies format 12 and the diagnostic schema, and reads one sample.

3. Record this startup baseline. For the first idle test, restart the pad and
   leave it untouched with the reader and configurator disconnected. After
   several minutes, connect the reader and click **Read stack**. Leave the pad
   powered between readings: its watermark survives ordinary USB bus resets and
   runtime reapplication, but a firmware restart resets it. A USB reconnect alone
   cannot establish whether a full restart occurred.

4. In a separate run, exercise the supplied profile: fast encoder rotation in
   both directions on both layers, held scrolling, **Mouse toggle**, and the
   repeated consumer macro. Release all controls, then leave the pad idle again.
   Record workload, duration, layer and any unexpected behavior in the
   **Run / stage label** field before each sample. **Monitor once per second**
   is optional; use it in a separate run because polling changes USB timing.

5. Click **Download results JSON** before unplugging. It includes timestamped
   samples and raw request/reply packets. **Capture flash and active bytes** adds
   both 128-byte images and a status sample without saving or repairing anything.
   During a recurrence, record the LED pattern and responsiveness before opening
   a connection: USB reconfiguration can reapply runtime state.

The supplied six-key JSON, its encoded 128-byte image, all image bytes and a
validation record are retained in the artifact directory. The reconstructed
image has CRC `0x753C` and SHA-256
`092eafbe8dddf27445472bad7fee362bda9841f0dd688e8aa40447f6af9404e1`.
The actual firmware validator accepts it for six keys and rejects it for three.
This is an encoding of the supplied JSON, not a readback of device flash.

## Build Measurements

The normal six-key HEX matches the existing `.pio/build/ch552/firmware.hex`
byte for byte. Both variants were built with SDCC 4.2.2 build.13407_4, 24 MHz,
148 USB DMA bytes and the actual 14,336-byte application limit.

| Variant | Production Flash | Preview-Off Control | Diagnostic Flash | Diagnostic Spare | Stack Base | Stack Capacity |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Six keys | 14,332 | 14,214 | 14,300 | 36 | `0xB3` | 77 |
| Three keys | 14,328 | 14,210 | 14,296 | 40 | `0xB0` | 80 |

Disabling live color preview saves 118 bytes. The diagnostic adds 86 bytes to
that control build and allocates no RAM. Stack capacity, paged RAM (95 bytes),
ordinary external RAM (371/362 bytes) and the absolute active image at
`0x300–0x37F` match production. The initial full-feature six-key diagnostic
required 14,424 bytes and was rejected by the linker; it was not uploaded.

## How the Measurement Works

At the very start of `main()`, inline assembly disables interrupts and fills
internal RAM above SP with `0xA5`. C startup reaches `main()` by jump with SP at
the linker stack base minus one, so there are no live frames to overwrite.
This includes subsequent `init()`, `setup()`, enumeration, workload and USB/timer
interrupts. It excludes earlier C initialization and the ROM bootloader.

Diagnostic opcode `0x70` takes zero offset, length and data. It uses the existing
transport validation and replies with six bytes: `53 57 01`, physical variant
(`0` six keys, `1` three keys), linker stack base, highest non-pattern address.
Normal firmware rejects this opcode. Standard status and info replies retain
their normal layouts, so the configurator remains compatible.

The inline scan searches downward from `0xFF`, briefly masks interrupts and
restores their prior state. It adds no calls, pushes or persistent storage.
The existing path `main → loop → protocolPoll → processRequest` has ten live
stack bytes at the scan, before interrupt contributions: three two-byte return
addresses plus four saved register bytes. This is part of the observed usage;
it is not subtracted. Other request/interrupt paths may have used more stack
before the sample.

Observed use is `highest - base + 1`; untouched headroom is `255 - highest`.
The reader retains the greatest sampled usage for each connection, and downloaded
results include previous connections. Pattern collisions can undercount, and an
overflow that wraps the eight-bit stack pointer may destroy evidence. Zero
headroom, a reset, USB loss, stuck output or another unexpected state should be
recorded as a fault. A comfortable watermark is a sanity check, not proof of
worst-case safety or a diagnosis of the reported incidents.

## Verification and Rebuilding

Both variants passed instruction-level checks of the actual linked fill and
scan for every possible watermark position, with interrupts initially on and
off. The checks verify bounds, preservation of allocated/live RAM, SP and EA,
and writes only to the two diagnostic reply bytes. They compare all RAM areas,
workload-module assembly and USB interrupt-wrapper assembly against controls
built with the same feature settings. Firmware host suites pass with color
preview enabled and disabled. The read-only reader's eight tests pass, including
unsupported firmware, reply matching, timeouts and complete image capture.
Initial six-key hardware readings are recorded in
[V12 Six-Key Investigation Results](v12-six-key-results.md): 32 bytes at baseline
and 35 bytes after rapid toggle inputs. During the subsequent three-key workload,
the volume HUD cleared after queue drain and direct toggle remained responsive;
the macro-based toggle was delayed or dropped, consistent with queue handling.
A stack reading for that workload remains to be collected.
Subsequent extensive testing, including a broader sample profile preserved in
the results document, still never exceeded 35 bytes. The user also reported
`identical=true` when comparing captured flash and active bytes.

Reproduce the firmware builds into a new retained temporary directory:

```sh
python3 "Stack Test/build-stack-firmware.py" --no-preview
node --test "Stack Test/reader.test.mjs"
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
```

The builder prints the artifact directory and retains source/tool snapshots,
normal/control/diagnostic build outputs, assembly/listings, HEX/map/memory files,
logs, source hashes and a verified manifest. Use that directory in the upload
command. The reproduction-profile artifacts described above were prepared
separately for this run from the JSON in `INVESTIGATION_PLAN.md`.
