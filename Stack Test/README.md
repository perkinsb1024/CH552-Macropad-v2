# v7 stack watermark validation

This is temporary diagnostic firmware. No firmware features were removed.
The new code fills unused internal stack RAM with `0xA5` at the beginning of
`main()`, after C runtime initialization but before `init()` enables interrupts.
It uses indirect addressing and adds no internal/external RAM allocations.
It captures `init()`, `setup()`, USB enumeration and application/interrupt activity.
The preceding C runtime clear/static-initialization phase and the ROM bootloader
are outside the measurement.

## Firmware and setup

1. Export your current profile from the v7 configurator before replacing it.
2. Use PlatformIO's **Upload** task for environment **ch552** on this validation
   branch, or run `pio run -t upload` from the repository root. The task builds
   the diagnostic when needed and uploads `.pio/build/ch552/firmware.hex`.
   `platformio.ini` enables `ENABLE_STACK_TEST=1` and currently selects six-key
   hardware (`board_build.physical_variant = 0`). For a three-key board, set that
   variant to `1` before uploading. The supplied profiles are **six-key** only.
3. Enter bootloader mode by holding the encoder button while connecting USB,
   then release it and run Upload. The uploader waits up to 10 seconds for the
   bootloader. After upload, reconnect USB if the board does not restart itself.
   The HEX files in this directory are retained diagnostic artifacts; the
   project's web uploader accepts only bundled published firmware and cannot
   select these custom HEX files.
4. From the repository root, start the reader's local server:

   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1
   ```

5. Open <http://localhost:8765/Stack%20Test/read-stack.html> in Chrome or Edge.
   Close/disconnect the configurator's device connection first; these programs
   must not send concurrent configuration requests to the same device.
6. Click **Connect**, select the matching test, and click
   **Save selected test profile to device**. This uploads its checked `.bin`
   image, verifies all 128 flash bytes, and tests a repeated commit acknowledgment.
   You can instead import the corresponding `.json` in the configurator and save
   it there, then disconnect the editor and reconnect the reader.
7. Unplug/replug the board after saving each profile to begin a fresh per-profile
   run. Reconnect the reader and read a baseline, then follow that test's guide.

## Reading and recording results

**Read stack** displays bytes used, untouched bytes, and total capacity. Each
read also retrieves the current layer, flash-valid flag, and dropped-action
counts. **Monitor once per second** records regular samples. **Start USB read
stress** repeatedly reads all flash and active-image bytes while collecting
stack/status samples. Its optional preview checkbox cycles bright and dim
Rainbow, dim Cyan, dim Red and cancellation. Physical input cancels preview
as in normal firmware. The reader's preview commands can replace temporary
effects, so test effects both with the checkbox off and on.

Click **Stop** and wait for the operation to finish before saving or changing
reader modes. Set the **Run / stage label** before each stage. Click
**Download results CSV** to retain readings; label changes do not reset the
watermark. Record the HEX's SHA-256 from `firmware-build.json`, board type,
profile, test duration, and any observed faults alongside the CSV.

The watermark lasts until firmware restart. Saving, clearing action queues,
changing layers, and closing/reopening either application retain it. Unplugging,
resetting/reflashing the MCU, or entering the bootloader and restarting the
application reset it. Download results **before** a power cycle. A USB bus reset
with board power maintained retains the watermark; ordinary unplug/replug does
not. Samples after separate restarts represent separate runs; compare their
maximum observed usage/minimum untouched bytes rather than combining them as
one cumulative watermark.

## Interpretation and limitations

| Variant | Normal flash | Diagnostic flash | Diagnostic free | Stack base | Capacity |
| --- | ---: | ---: | ---: | --- | ---: |
| Six-key | 14,263 | 14,317 | 19 | `0x88` | 120 |
| Three-key | 14,259 | 14,313 | 23 | `0x85` | 123 |

Both variants add 54 flash bytes. Stack, internal RAM, page-zero RAM and external
RAM allocations match the corresponding normal builds. The generated assembly
for the sketch, action engine, config/storage, HID/USB, timer implementation and
LED driver matches baseline assembly; the USB interrupt wrapper is also unchanged.
Return addresses change with code placement, so their byte values differ.

The highest address whose byte differs from `0xA5` is the observed watermark.
For example, six-key base `0x88`, highest touched `0xBF`: 56 bytes used and
64 untouched. It includes stack frames from the diagnostic request's existing
protocol processing; the inline scan adds no frames of its own. Interrupts are
masked briefly during the scan and then restored to their original state.
Interrupt use from the rest of the run remains visible in RAM. Run the workloads
with the reader idle as well as polling, then sample, to vary timing.

Zero untouched bytes means the upper boundary was touched: stop and retain the
results. Actual overflow can wrap the 8-bit stack pointer and corrupt RAM/control
flow before any result is available. A hang, reset, loss of USB, stuck output or
unexpected behavior should be recorded even if the preceding reading looked good.

This is an observed-use test, not proof of every execution path or an overflow
detector. Saved data can coincidentally equal `0xA5`, so a reading may undercount
or occasionally decrease; retain the greatest usage/minimum headroom seen across
samples. No extra boundary canary or persistent peak variable is allocated.
Interpret any remaining margin alongside assembly/call-depth review. No numeric
release pass threshold has been established here.

## Optional invalid-saved-profile startup

**Exercise rejected uploads** tests invalid CRC and invalid configuration without
writing either to flash. It does not exercise booting with invalid saved flash.
For that separate case, after exporting your current profile and all results,
run `pio run -t erase-config` with the six-key diagnostic built in
`.pio/build/ch552/firmware.hex`. This deliberately clears the stored profile and
restores that diagnostic image. Reconnect, confirm flash-valid is zero and one
red LED blinks, read the startup result, preview colors, then save a test profile
and read again. Erasure/reflash starts a new run. Do not interrupt a flash save
to try to create corruption.

## Rebuilding and checking

### Diagnostic transport

Diagnostic builds accept HID transport v1 opcode **10** (`GET_STACK`) with offset,
length and data all zero. The report IDs/signature/sequence handling are unchanged:
Output report 3 carries a 31-byte request payload beginning
`55 4D 01 0A <sequence> 00 00 00`; remaining bytes are zero. Input report 4
replies with status zero and data length three:

| Data byte | Meaning |
| --- | --- |
| 0 | `0xA5`, diagnostic identifier and fill pattern |
| 1 | Linker's `__start__stack` address |
| 2 | Highest non-pattern address, or stack start minus one if untouched |

Capacity is `256 - start`, observed usage is `highest - start + 1`, and untouched
headroom is `255 - highest`. The command is read-only; it cannot reset the watermark
or change flash. Normal builds reject it with `BAD_OPCODE = 2`. `GET_INFO` and
`GET_STATUS` retain their normal layouts. Full transport details are in
[hid-v1.md](../protocol/hid-v1.md).

### Developer checks

From the repository root:

```sh
node "Stack Test/build-test-images.mjs"
python3 "Stack Test/build-stack-firmware.py"
node --test "Stack Test/reader.test.mjs"
python3 tests/run_host_tests.py
```

The image generator uses the editor's importer, encoder, decoder and capacity
rules. The firmware builder uses temporary build directories, validates the
linked fill/scan machine code for every possible peak with interrupts initially
on/off, and checks the three profile binaries using the firmware's C validator.
It copies diagnostic HEX, map and memory files into this directory and records
hashes in `firmware-build.json`. It does not generate release files or flash a board.

For a retained build, run `python3 tests/stack_test_firmware.py BUILD_DIRECTORY`.
Its optional `--baseline NORMAL_BUILD_DIRECTORY` checks RAM allocations and
unchanged workload/interrupt assembly against the normal build.
To build normal firmware instead, remove the validation `build_flags` line from
`platformio.ini` and rebuild. Keep diagnostic and normal HEX files clearly identified.
