# RP2350 read-only proof of concept

For the write-capable build that runs from a power brick with on-board button
and RGB status, see [standalone.md](standalone.md). The instructions below are
for the separate read-only probe.

This prototype targets an unmodified Waveshare RP2350-USB-A. It exposes a native
USB serial console and starts a PIO USB host on GPIO12/D+ and GPIO13/D− only after
an explicit command. R13 remains installed. No soldering, pad modification, or
automatic power switch is involved.

The target-facing application requests are limited to `A1` identification and
`A7` configuration/version/ID reads. The USB host also sends the standard control
requests required to reset, enumerate, address, configure, and read descriptors.
There is no erase, flash write, configuration write, verification, run-application,
or arbitrary bulk-packet command in this build.

The first hardware capture enumerated the WCH bootloader through the stock board,
then failed on an additional oversized configuration-descriptor read. Firmware
0.1.1 reads the nine-byte header followed by the exact advertised descriptor length.
A later paced reconstruction completed CH552 identification (bootloader 2.5.0),
but repeatable bootloader entry remains unvalidated. A failed strict reply validation is a reason to inspect the raw
capture, not to assume the pad is faulty.

## Build

Use CMake, make, Python 3, and a complete Arm GNU bare-metal toolchain with newlib
and Cortex-M33 support. A compiler executable alone is insufficient: an error
about missing `-lc` or `-lg` means the C runtime is missing. Set `PICO_TOOLCHAIN_PATH`
to the complete toolchain directory if the compiler on PATH is incomplete.

From this directory:

```sh
python3 prepare_deps.py
cmake --fresh -S firmware -B build \
  -DPICO_SDK_PATH="$PWD/.deps/pico-sdk" \
  -DPICO_PIO_USB_PATH="$PWD/.deps/Pico-PIO-USB" \
  -DPICO_TOOLCHAIN_PATH=/path/to/arm-gnu-toolchain \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 4
```

`prepare_deps.py` downloads only source dependencies and preserves existing
checkouts with unexpected revisions. The SDK also downloads/builds picotool to
produce the UF2; its build disables libusb support. These commands do not open or
flash any connected device. The output is `build/ch552_probe.uf2`.

The current locally built UF2 is [build-arm/ch552_probe.uf2](build-arm/ch552_probe.uf2)
(version 0.1.6).
That separate build directory used the complete compiler after the original
`build/` attempt found an incomplete compiler on PATH. `--fresh` clears the CMake
cache when selecting a different toolchain. Generated artifacts are ignored by Git.

Pinned source revisions:

| Dependency | Revision |
| --- | --- |
| Pico SDK | `079c6f39023649b154152db30f1d781e884879bc` (2.3.1) |
| TinyUSB, SDK submodule | `86ad6e56c1700e85f1c5678607a762cfe3aa2f47` |
| Pico-PIO-USB | `5a37a66dc5d3fbe0ef3cdbeda923a757440f984f` |

The firmware uses a 120MHz system clock, PIO0 state machines 0/1/2, and DMA
channel 0 through the upstream defaults. Native USB and host-task work run on
core0; the PIO host's repeating timer handles bus scheduling. Enumeration delay
hooks continue servicing the computer-facing USB connection. The RP2350 core0
stack is reserved at 4KiB, fitting its dedicated scratch bank; large formatting
buffers use static RAM. This does not change CH552 firmware or its stack allocation.

## Install on the RP2350

The first build to complete identification is
[0.1.1 reconstructed with a 20ms gap before A7](build-reconstructed-0.1.1-paced/output/ch552_probe.uf2).
It reports `0.1.1-reconstructed-paced` and adds an `info_wait` event after the
accepted A1 reply. USB service continues during the gap. Bulk-IN tracing,
2000ms transfer deadlines, early startup, and read-only request bytes match
bustrace. The preceding trial returned 1999 NAKs and no A7 data or receive errors;
the gap tests a timing hypothesis. Use the same setup and `--delay-ms 1000`.

For the preceding A7 timeout investigation, use
[0.1.1 reconstructed with bulk-IN tracing](build-reconstructed-0.1.1-bustrace/output/ch552_probe.uf2).
It reports `0.1.1-reconstructed-bustrace` and retains the early startup path,
corrected reply parser, and 2000ms transfer timeout. An isolated PIO-USB copy
counts polls, matching packets, data-toggle mismatches, NAKs (not ready), stalls,
and receive errors for bulk IN `0x82`. `bulk_in_trace` and
`bulk_in_first_packet` events report the counters and first received data packet
for each read, including a packet rejected for a toggle mismatch. Counters reset
at each bulk-IN submission. No target requests, ACK/PID handling, or retry rules
are changed, but instrumentation can affect timing. Keep the hub/cable/insertion
sequence and 1000ms window unchanged and share the complete capture.

The uninstrumented identification build is
[0.1.1 reconstructed with corrected reply parsing](build-reconstructed-0.1.1-replyfix/output/ch552_probe.uf2).
It reports `0.1.1-reconstructed-replyfix`. Its `main.c` is identical to the
0.1.1 reconstruction; only read-reply parsing and version metadata differ.
Captures contain both `A1 9F 02 00 52 11` and `A1 9D 02 00 52 11`.
The parser does not interpret the varying second byte as a success/failure code
for A1/A7; it validates command, payload lengths, and command-specific fields.
A1 still requires exact six-byte framing and CH552 chip/family identity. A7 still
requires sufficient declared/received data and the requested field mask. The
superseded `0.1.1-reconstructed-detectfix` whitelisted only `00`/`9F` for A1 and
rejected the second real reply. The current corrected build retains the
early startup path without brownout overrides or later GPIO/reset diagnostics.
Keep the current hub/cable topology and 1000ms insertion window for comparison.

For comparison with the first hardware trial, locally rebuilt historical behavior
is available as [0.1.0-reconstructed](build-reconstructed-0.1.0/output/ch552_probe.uf2)
and [0.1.1-reconstructed](build-reconstructed-0.1.1/output/ch552_probe.uf2).
The original binaries were not found; these are reconstructions, not archived
original UF2s. The first successful WCH enumeration was 0.1.0, followed by a
descriptor-read failure. Both reconstructed builds omit the later brownout
override and GPIO/reset diagnostics. The 0.1.0 reconstruction uses the original
512-byte configuration request; 0.1.1 uses the corrected header/exact-length
sequence. Current host Python supports both. See [plan.md](plan.md) for provenance.

1. Leave the macropad disconnected from the RP2350.
2. Hold the Waveshare board's **BOOT** button while connecting its USB-C port to
   the computer. Release it when the RP2350 boot drive appears.
3. Copy `build/ch552_probe.uf2` to that drive. This installs firmware on the
   RP2350, not the CH552 macropad.
4. Wait for the RP2350 to reconnect as a USB serial device.

The prototype uses development VID/PID `CAFE:4052`, product string
`RP2350 CH552 read-only probe`, and a board-unique serial string. This VID/PID is
for local testing, not a product allocation.

## First hardware trial

The host tool uses Python's standard library on macOS/Linux; no package install
is required. Its `--list` operation only lists matching serial paths and never
opens them. Choose the RP2350's port explicitly; close other serial consoles first.

From this directory:

```sh
python3 host/probe.py --list
python3 host/probe.py --port /dev/cu.usbmodemYOUR_RP2350 --delay-ms 5000
```

For repeated trials, unplug the macropad and add `--reset` to reboot the RP2350
before arming, replacing the adapter's reset-button press:

```sh
python3 host/probe.py --port /dev/cu.usbmodemYOUR_RP2350 --reset --delay-ms 1000
```

The script checks adapter identity before sending the existing `reset` command,
waits for serial disconnection, and retries the same selected port for up to 15s.
It pauses 1000ms after disconnection before reopening and reports each attempt
and the transition to reading status. The JSONL capture records both phases.
It checks identity and clean idle status again before arming. A changed boot ID
is also required when both statuses provide one. If the serial path changes,
use `--list` and select the new path explicitly. No firmware update is required.
`--reset --status` reboots and reads status without arming. Reset affects only
the RP2350 and does not power-cycle the macropad; keep USB-A empty until prompted.
For investigating spontaneous resets, use `--status` without `--reset` to preserve
the adapter's original reset diagnostics.

1. Start with the RP2350 powered through USB-C and its USB-A port empty.
2. Run the capture command. It first asks for adapter status and rejects an
   unexpected adapter, an already-started host, or an already-armed probe.
3. After the tool prints the insertion instruction, plug the macropad into USB-A
   before the 5000ms countdown ends. The stock resistor supplies the D+ pull-up.
4. At the deadline, the PIO host starts. Its initial line-state check can detect
   an existing full-speed idle state; TinyUSB then performs bus reset/enumeration.
   This does not require an observed new D+ rising edge.
5. Inspect the output and preserve the timestamped JSONL file under `logs/`.
   An `identified` event contains the CH552 bootloader version and chip ID. Raw
   device/configuration descriptors, endpoint details, requests, and replies are
   also recorded.
6. Unplug the pad and reconnect it normally to the computer to check its original
   application behavior.

The insertion delay accepts 0..30000ms. A shorter window may help if the bootloader
times out before enumeration. For `--delay-ms 0`, insert the pad just before
starting the capture. The configured enumeration timeout is 10000ms; individual
descriptor/bulk transfers time out after 2000ms. The actual bootloader timeout
is not yet measured.

Each adapter boot permits one host initialization/probe. The selected PIO host
does not provide a proven complete resource teardown/reinitialization path.
For another attempt, unplug the macropad first and rerun with `--reset`, or press
the RP2350's **RESET** button and wait for its serial port before rerunning. Resetting the
RP2350 does not power-cycle a macropad left plugged into its USB-A port.

### Diagnose insertion-related serial loss

Firmware 0.1.6 adds passive `dp_level` and `dm_level` digital input snapshots to
`status`, `armed`, and `host_start` (before PIO initialization). This build uses
0.903V with detection enabled to match the operator's 0.1.4 hub trials. These
reads do not enable internal pulls or drive either data pin. Start with USB-A
empty and use `--status`: the stock D+ pull-up should yield `dp_level: 1`.
A low reading calls the assumed pull-up condition into question. A high reading
does not establish voltage margin at the CH552, contact ordering, or absence of
brief insertion transients. D− may float before host startup. These are snapshots,
not a continuous trace; readings after host startup may sample USB traffic.

Firmware 0.1.5 was built as the separately requested threshold experiment: startup
sets VSEL 9 (nominal 0.860V) with brownout detection enabled. This is reapplied on
each application boot; it does not program OTP or change the CH552 firmware.
After installation with USB-A empty, run `--status` first and verify version
0.1.5, `bod_enabled: true`, `bod_vsel: 9`, and `bod_threshold_mv: 860`. Then
repeat the 5000ms insertion trial. If serial disconnects, capture `--status`
after it reappears, before manually resetting the adapter. Surviving the trial
would not by itself validate power reliability for flashing.

Firmware 0.1.4 set VSEL 10 (0.903V); a post-insertion capture still confirmed
a brownout at that setting. Its UF2 is preserved locally as
[build-arm/ch552_probe-0.1.4.uf2](build-arm/ch552_probe-0.1.4.uf2) for comparison.

The prior readback-only UF2 is preserved locally as
[build-arm/ch552_probe-0.1.3.uf2](build-arm/ch552_probe-0.1.3.uf2). Reinstall it
with the target unplugged to return to the previous startup behavior, then check
`--status` to confirm the actual threshold.

Firmware 0.1.3 also reads the current brownout register on every status request:
`bod_raw`, `bod_enabled`, `bod_vsel`, and `bod_threshold_mv`. The threshold is
the nominal core-supply threshold in millivolts (for example, 946 means 0.946V),
not a measured voltage. Reserved VSEL encodings yield `null` for the threshold.
This diagnostic leaves brownout detection and its threshold unchanged. Use
`--status` with the target unplugged to inspect the setting without probing.

Firmware 0.1.2 adds a random per-boot `boot_id`, the raw RP2350 `reset_raw`
register snapshot, and `reset_brownout`, `reset_power_on`, `reset_run_pin`, and
`reset_watchdog` flags to `status`. These describe the adapter's most recent
chip reset, not the CH552. They are diagnostic evidence, not voltage measurements;
an unset brownout flag does not rule out a power interruption.

The ordinary capture records these fields before arming. If insertion disconnects
the Mac's serial port and the port reappears, leave the adapter powered and read
status before pressing any reset button:

```sh
python3 host/probe.py --port /dev/cu.usbmodemYOUR_RP2350 --status
```

This sends only `status` and works even after a failed/used probe. It does not
initialize the host or send target requests; an already-running host continues
its existing activity. Compare `boot_id` with the original capture: a changed ID
indicates application startup occurred again. An unchanged ID with advancing
`ms` points toward a USB-only reconnection. Compare reset flags as well, and keep
both JSONL files. A subsequent manual reset replaces the evidence we need.

Opening the serial console can begin in the middle of an existing log line.
The Python reader permits one malformed initial JSON line, records its bytes as
a `host_event` named `discarded_initial_fragment`, and resumes at the next newline
without extending the response deadline. Subsequent malformed lines still fail
the capture, and adapter identity validation remains required before arming.

Also capture an empty-port control trial. R13 can make an empty port look attached,
but it must never produce a successful CH552 identification. After initial success,
repeat ten insertion/probe cycles and record board markings, pad variant, cable,
power source, insertion timing, and any failures alongside the logs.

## Serial console commands

Any serial terminal can send newline-terminated ASCII commands at 115200 baud.
Baud rate is nominal for USB CDC. Responses/logs are newline-delimited JSON,
protocol version 1. This is an identification console, not the future binary
upload bridge described in [the plan](plan.md).

| Command | Behavior |
| --- | --- |
| `help` | List commands |
| `status` or `info` | Report version, board, state, host-start status, and lost-log count |
| `arm` | Start a 5000ms insertion window |
| `arm 1000` | Use a specified delay in milliseconds |
| `probe` | Start hosting immediately, after manual insertion |
| `cancel` | Cancel the countdown or invalidate an active probe |
| `reset` | Reboot the RP2350; unplug the target before sending this |
| `bootsel` | Reboot the RP2350 into its UF2 loader |

Cancelling a probe does not stop USB bus activity or switch target power. Closing
the host tool also does not cancel an armed probe. To end a trial, unplug the pad.
Terminal states ignore late transfer completions and do not send further
application requests. R13 can mask physical disconnects; transfer failures and
timeouts invalidate the attempt rather than retrying target application commands.
The PIO host may still issue standard enumeration retries or SOF packets.

Logging uses a bounded nonblocking queue so a slow console does not stall USB
service. `status` reports `dropped_logs`; a nonzero count means the capture is
incomplete. The host tool creates a new capture file and does not overwrite an
existing one. Chip IDs are included in captures.

## Local checks

From this directory, use a desktop C compiler for the portable parser tests:

```sh
cc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I firmware firmware/probe_protocol.c tests/test_protocol.c \
  -o /tmp/ch552-rp2350-protocol-test
/tmp/ch552-rp2350-protocol-test
python3 -m unittest discover -s tests -p 'test_host.py' -v
```

The C checks cover truncated/malformed endpoint descriptors and bootloader replies,
wrong chip identities, and rejection of every application command except `A1` and
`A7`. The Python checks use simulated serial ports created with `pty`, not hardware,
to exercise split/coalesced messages, timestamped logging, adapter preflight,
terminal failures, and refusal to accept identification without the arm/start
sequence. Hardware timing, fixed-pull-up compatibility, and single-core USB
scheduling remain to be tested on the board.
