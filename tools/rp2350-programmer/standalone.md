# Standalone macropad programmer

Install [build-storage/ch552_programmer.uf2](build-storage/ch552_programmer.uf2)
on the Waveshare RP2350-USB-A. Version `0.3.2-standalone` exposes a USB-C
firmware drive and accepts either three-key or six-key macropad HEX files.
The RP2350 build does not embed or depend on a macropad release. Load a new HEX
to change the firmware it installs; rebuilding the programmer is unnecessary.
The earlier read-only probes and embedded three-key build remain separate.

This replaces the connected macropad's application firmware. Select the HEX
for the physical pad yourself: the CH552 bootloader identifies the MCU, not
the number of keys. Data Flash and boot configuration are not deliberately
written or erased by the programming routine.

## Install and load firmware

1. Leave USB-A empty. Hold **BOOT**, connect USB-C to the computer, then release
   **BOOT** to enter the RP2350's UF2 drive. Alternatively hold **BOOT**, press
   and release **RESET**, then release **BOOT**.
2. Copy `ch552_programmer.uf2` to that drive. The adapter reboots and presents
   the **MACROPAD** firmware drive and a serial diagnostics interface.
3. Copy one macropad `.hex` file to the top level of **MACROPAD**. Long filenames
   are accepted; serial diagnostics display the filesystem's short filename.
   Remove any previous HEX first. Hidden/system files, AppleDouble metadata,
   subdirectories, and files with other extensions are ignored. Multiple visible
   top-level HEX files are rejected instead of choosing one arbitrarily.
4. Wait for blinking green. Blue indicates copying and saving; blinking green
   means the full HEX passed validation and its disk snapshot was saved to flash. A new
   adapter initially has an empty drive and blinks orange. Invalid firmware
   blinks red; replace it with a valid HEX and wait for blinking green.
5. Eject **MACROPAD** before unplugging USB-C. A flush/eject request waits for
   outstanding firmware saves to finish. The saved firmware survives resets
   and power loss, so subsequent use can be powered by a USB-C power brick.

The drive is a 256KiB FAT12 volume with fixed geometry. Do not reformat it.
Load files only before arming; after **BOOT**, the drive becomes read-only until
reset. A firmware copy changes the LED to blinking blue, prevents arming, and starts a
new save after 1500ms without changed disk writes. File-copy timing varies;
wait for blinking green rather than treating completion of the computer's copy dialog as
confirmation that saving has finished.

Routine computer writes to timestamps, hidden files, or unrelated allocation
entries do not change the selected firmware. These metadata changes stay in RAM
until the next firmware save and do not interrupt the green ready indication or
block **BOOT**. A change to the selected HEX's name, contents, or validity, or
adding another visible HEX, triggers blue and blocks arming until saving finishes.
FAT consistency checks cover the selected file's chain; an unrelated hidden file's
FAT update cannot make an unchanged saved firmware temporarily invalid.

The last 520KiB of the board's 2MiB flash is reserved for two disk snapshots.
A CRC-protected commit header is written only after a complete snapshot has
been written and checked. Interrupted saves recover the previous committed
snapshot, or an empty drive if none exists. After interrupted copying, inspect
and replace the file as needed. Both valid and invalid disk contents can be
saved; invalid contents never arm the programmer. A storage write/check failure
blinks red and requires resetting the adapter. Normal programmer UF2 updates
leave this reserved region alone; a full-chip erase removes the saved files.

## Program a macropad

1. Power the adapter through USB-C. Keep USB-A empty until arming and wait for
   blinking green.
2. Press **BOOT**. When the LED turns solid cyan, plug in the macropad within
   2000ms, using the insertion technique from the successful read-only trials.
3. Leave it connected while yellow. Green means application flash comparison
   and configuration readback passed, and the run-application command's OUT
   transfer completed. Solid red means programming stopped on an error.
4. On green, unplug the macropad and connect it normally to check the firmware.
   For another attempt after either result, unplug the macropad, press **RESET**
   on the RP2350, and start again from blinking green.

| LED | Meaning |
| --- | --- |
| Blinking orange | No HEX; cannot arm |
| Blinking red | Invalid disk/HEX, multiple HEX files, or storage failure; cannot arm |
| Blinking blue | Copy/save in progress; cannot arm |
| Blinking green | Valid firmware saved; waiting for **BOOT**; PIO USB host stopped |
| Solid cyan | 2000ms window to plug in the macropad |
| Yellow | Enumeration, identification, programming, comparison, or reboot transfer |
| Red, latched | Programming error; unplug the macropad before resetting the adapter |
| Green, latched | Full comparison passed and reboot command sent |

One attempt runs per adapter boot. It does not automatically retry an erase or
resume a partial flash. Entry still depends on the unmodified board's resistor
and the known intermittent insertion behavior. **RESET** does not switch USB-A
VBUS, so always unplug the macropad before retrying. The original brownout
settings are retained, matching the early reconstruction; a power brick still
needs to supply both boards adequately.

## Routine and verification limits

Before enabling the green ready indication, the RP2350 validates the complete
HEX: record checksums and lengths, EOF, overlaps, data at the reset vector,
application bounds, FAT allocation chains, and exactly one macropad identity
record (`UMAC`, identity version 1, configuration-format byte, variant byte
0 for six keys or 1 for three keys). Both pad variants are accepted. The
configuration-format byte is reported without requiring the programmer to
understand that configuration format. Unspecified application bytes are `FF`.
All data records must fit below `0x3800`; bootloader-region records are rejected.
On arming, the 14KiB RAM image is CRC-checked again and disk writes are blocked.

After the insertion window, standard USB enumeration and exact-length descriptor
reads precede this target command sequence. Each subsequent command is separated
by 20ms with both USB stacks serviced throughout:

1. A1 identifies CH552 family `11`, device `52`.
2. A7 reads configuration, version, and ID. This POC accepts only bootloader
   2.5.0, the version identified in the successful hardware trial.
3. A3 sends the zero seed used by the web uploader; the returned key checksum
   must match the UID-derived XOR key before erasing.
4. A4 requests 14 application sectors, covering `0000..37FF`.
5. A5 writes the loaded image in aligned chunks of up to 56 bytes. Every
   response must echo the command and return a zero two-byte result.
6. A6 supplies every image byte again for the bootloader to compare against
   flash, including erased gaps and the tail, with strict result validation.
7. A7 reads configuration again. Configuration words and UID must match the
   pre-erase snapshot, and the bootloader version must still be 2.5.0.
8. A2 `01 00 01` requests the application to run; no IN response is expected.

The USB ISP command set provides code-flash comparison, not code-flash download.
There is no raw application readback file or independent host-side flash hash.
The readable Data Flash command is a different memory space. A6 is the supported
way to verify the programmed application; logs explicitly report
`raw_code_readback: false`. See the
[WCH ISP protocol implementation](https://github.com/ch32-rs/wchisp/blob/master/src/protocol.rs)
and the local `webUploader` A6 verification loop (including its verification fix).
Green confirms comparison and delivery of the reboot command, not observation
of the new application's USB enumeration.

No A8 configuration write, Data Flash command, bootloader write, or arbitrary
packet command is exposed. Unsupported identity/version, incomplete replies,
key mismatch, erase/write/compare error, configuration change, removal, or
timeout stops the sequence. After an error following erase, the application
may be incomplete; re-enter bootloader and retry a complete flash. The bootloader
region is excluded from image addresses.

## Optional computer diagnostics

The native serial port supplies buffered NDJSON events and status, but it does
not gate the operation. With USB-A empty, start the monitor, then use **BOOT**:

```sh
python3 host/probe.py --list
python3 host/monitor.py --port /dev/cu.usbmodemYOUR_RP2350
```

The monitor captures to `logs/standalone-*.jsonl`, sends only `status`, and waits
up to 120s by default (`--timeout` changes this). It reports success only after
programming completes, or from the latched completed status when opened later.
Stopping the monitor does not stop the standalone programmer. The serial path
may change because this build uses a distinct development PID.

`host/probe.py` intentionally rejects this write-capable adapter. Its `--reset`
flow is for read-only probe firmware. For this build the console supports
`status`, `info`, `help`, `reset`, and `bootsel`; reset/bootsel requests are
rejected while armed or busy, or while storage is pending. The physical
**RESET** button still resets the adapter immediately, so use it only after unplugging the pad and ending a trial.

Protocol 2 status reports `read_only: false`, current phase and offset, last
error, dropped logs, image short filename/CRC32, key count, configuration format,
image validation status/error, and storage-pending flag. Large formatting buffers and the 16KiB nonblocking log ring are static. Per-KiB progress
events replace per-packet success logs so a normal offline run fits the buffer.
Terminal errors include the rejected request and reply. Logs are in RAM and
disappear on adapter reset; they are not retained in flash.

## Build and tests

Use the same pinned SDK and PIO-USB revisions and complete Arm toolchain as
[usage.md](usage.md). From this directory:

```sh
cmake -S standalone -B build-storage \
  -DPICO_SDK_PATH="$PWD/.deps/pico-sdk" \
  -DPICO_PIO_USB_PATH="$PWD/.deps/Pico-PIO-USB" \
  -DPICO_TOOLCHAIN_PATH=/path/to/arm-gnu-toolchain \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-storage --parallel 4
python3 -m unittest discover -s tests -p 'test_*.py'
cc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I standalone -I firmware standalone/programmer.c firmware/probe_protocol.c \
  tests/test_programmer.c -o /tmp/ch552-standalone-test
/tmp/ch552-standalone-test
```

The build does not consume or modify `releases/`. Python test discovery also
builds and runs the native FAT/HEX and snapshot tests against both checked-in
release HEX files. The snapshot tests simulate power loss after every erase,
page write, and commit, interrupted/restarted saves, and corruption fallback.
Session tests run the actual USB callbacks with simulated flash: mount metadata
keeps firmware ready without extra saves, real firmware changes block arming,
flush commits the new selection, and storage failures prevent programming.
Saved read-only UF2s and the earlier standalone build are preserved.

The WS2812 LED uses GPIO16, PIO1 SM0, and no DMA. PIO USB retains PIO0 SM0/1/2
and DMA0. BOOT sampling follows Raspberry Pi's SRAM-based QSPI-CS method with
interrupts disabled, only while idle before starting the host; core1 and XIP DMA
are not used. The RP2350 stack reservation remains 4KiB. CH552 firmware source,
stack allocation, and checked-in release files are unchanged.
The adapted BOOT routine and SDK LED program use Raspberry Pi's
[BSD-3-Clause license](standalone/LICENSE.raspberrypi).

Version 0.3.2 builds and its native FAT/HEX/snapshot tests pass against both
checked-in pad releases. USB mass-storage copying, ejection, power cycling,
and programming with this version still require hardware validation on macOS
and Windows. The existing programming sequence was hardware-validated on the
previous embedded three-key version 0.2.2: all 14336 bytes compared, configuration
readback passed, the reboot command was sent, and a power-brick trial passed.
See `logs/standalone-20261007T225720-237621Z.jsonl` and [plan.md](plan.md).
Bootloader entry remains intermittent; those trials do not establish repeatability.

Version 0.3.1 fixes the first-save stall in 0.3.0. The reserved storage region now
reduces only the linker's application region; the SDK retains the physical 2MiB
chip size needed to erase and program that storage. Compile-time checks verify
both boundaries. Version 0.3.0 incorrectly reduced the SDK's physical flash size,
causing its bounds assertion to stop execution at the first storage erase.
