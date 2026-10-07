# Standalone three-key programmer

Install [build-standalone/ch552_programmer.uf2](build-standalone/ch552_programmer.uf2)
on the Waveshare RP2350-USB-A. This is the write-capable standalone build,
`0.2.2-standalone-3key`; the earlier read-only probes remain separate.
It embeds the existing `releases/ch552-macropad-3-key-30101c94.hex`.
No computer, Python process, or native USB enumeration is required during use.

This build replaces the macropad's application firmware. Use the three-key pad:
the CH552 bootloader identifies the MCU, not the number of physical keys.
The embedded release uses configuration format 10. Data Flash and boot
configuration are not deliberately written or erased by this routine.

## Install and use

1. Unplug the macropad from USB-A. Hold **BOOT**, connect the RP2350 to the
   computer, then release **BOOT** to enter its UF2 drive. Alternatively hold
   **BOOT**, press and release **RESET**, then release **BOOT**.
2. Copy `ch552_programmer.uf2` to that drive. It reboots into the programmer.
3. Power the RP2350 through USB-C from a power brick, or leave it on the computer
   for debugging. Wait for blinking blue. Keep USB-A empty until arming.
4. Press **BOOT** after the blue blink begins. When the LED turns solid cyan,
   plug in the macropad within 2000ms, using the insertion technique from the
   successful read-only trials.
5. Leave it connected while yellow. Green means application flash comparison
   and configuration readback passed, and the run-application command's OUT
   transfer completed. Red means the operation stopped on an error.
6. On green, unplug the macropad and connect it normally to check the firmware.
   For another attempt after either result, unplug the macropad, press **RESET**
   on the RP2350, and start again from blinking blue.

| LED | Meaning |
| --- | --- |
| Blinking blue | Ready, waiting for **BOOT**; PIO USB host stopped |
| Solid cyan | 2000ms window to plug in the macropad |
| Yellow | Enumeration, identification, programming, comparison, or reboot transfer |
| Red, latched | Error; unplug the macropad before resetting the adapter |
| Green, latched | Full comparison passed and reboot command sent |

One attempt runs per adapter boot. It does not automatically retry an erase or
resume a partial flash. Entry still depends on the unmodified board's resistor
and the known intermittent insertion behavior. **RESET** does not switch USB-A
VBUS, so always unplug the macropad before retrying. The original brownout
settings are retained, matching the early reconstruction; a power brick still
needs to supply both boards adequately.

## Routine and verification limits

Before enabling the ready indication, the RP2350 checks the embedded 14KiB
image's CRC32. The build-time converter checks Intel HEX checksums, record
lengths, EOF, overlaps, reset-vector data, application bounds, and the three-key
identity record. Unspecified bytes, including the final 44 bytes of this release,
are `FF`. It rejects a six-key image or records at/above the bootloader region.

After the insertion window, standard USB enumeration and exact-length descriptor
reads precede this target command sequence. Each subsequent command is separated
by 20ms with both USB stacks serviced throughout:

1. A1 identifies CH552 family `11`, device `52`.
2. A7 reads configuration, version, and ID. This POC accepts only bootloader
   2.5.0, the version identified in the successful hardware trial.
3. A3 sends the zero seed used by the web uploader; the returned key checksum
   must match the UID-derived XOR key before erasing.
4. A4 requests 14 application sectors, covering `0000..37FF`.
5. A5 writes the embedded image in aligned chunks of up to 56 bytes. Every
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
rejected while armed or busy. The physical **RESET** button still resets the
adapter immediately, so use it only after unplugging the pad and ending a trial.

Protocol 2 status reports `read_only: false`, current phase and offset, last
error, dropped logs, image filename/SHA-256, and configuration format. Large
formatting buffers and the 16KiB nonblocking log ring are static. Per-KiB progress
events replace per-packet success logs so a normal offline run fits the buffer.
Terminal errors include the rejected request and reply. Logs are in RAM and
disappear on adapter reset; they are not retained in flash.

## Build and tests

Use the same pinned SDK and PIO-USB revisions and complete Arm toolchain as
[usage.md](usage.md). From this directory:

```sh
cmake -S standalone -B build-standalone \
  -DPICO_SDK_PATH="$PWD/.deps/pico-sdk" \
  -DPICO_PIO_USB_PATH="$PWD/.deps/Pico-PIO-USB" \
  -DPICO_TOOLCHAIN_PATH=/path/to/arm-gnu-toolchain \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-standalone --parallel 4
python3 -m unittest discover -s tests -p 'test_*.py'
cc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I standalone -I firmware standalone/programmer.c firmware/probe_protocol.c \
  tests/test_programmer.c -o /tmp/ch552-standalone-test
/tmp/ch552-standalone-test
```

The build consumes the sole existing three-key HEX in `releases/`; it does not
generate releases. `embedded_image.h` and `embedded_image.json` are build outputs.
The JSON records source HEX and padded binary hashes, size, CRC, and format.
Saved read-only UF2s and the successful paced build are preserved.

The WS2812 LED uses GPIO16, PIO1 SM0, and no DMA. PIO USB retains PIO0 SM0/1/2
and DMA0. BOOT sampling follows Raspberry Pi's SRAM-based QSPI-CS method with
interrupts disabled, only while idle before starting the host; core1 and XIP DMA
are not used. The RP2350 stack reservation remains 4KiB. CH552 firmware source,
stack allocation, and checked-in release files are unchanged.
The adapted BOOT routine and SDK LED program use Raspberry Pi's
[BSD-3-Clause license](standalone/LICENSE.raspberrypi).

Build, parser/converter/monitor tests, and a simulated full flash passed. The
first hardware success on version 0.2.2 wrote and compared all 14336 bytes,
checked configuration readback, and delivered the reboot command, with a green
LED and zero dropped logs. Programming completed before the monitor was opened.
See `logs/standalone-20261007T225720-237621Z.jsonl` and [plan.md](plan.md).
The user subsequently confirmed that configuration stayed valid and a
power-brick-only trial passed, after roughly six failed attempts. Bootloader
entry remains intermittent; these successes do not establish repeatability.
