# Mac Factory HID Scanner

A command-line tool for the factory `1189:8890` pad, connected directly to the
Mac. Run commands from the repository root. The launcher uses the PlatformIO
Python environment; override it with `MAC_HID_SCAN_PYTHON` if needed.

## Commands

```sh
# Read USB identity and validate interface 1 without sending a command.
tools/mac-hid-scan/run inspect

# Default targeted comparison: 2A, 2B, 2C with all remaining bytes zero.
tools/mac-hid-scan/run probe

# Repeat 2B three times, observing each for at least 3000ms.
tools/mac-hid-scan/run probe --payload 2B --repeat 3 --observe 3

# Use control SET_REPORT instead of interrupt OUT.
tools/mac-hid-scan/run probe --payload 2B --transport control

# Repeat the RP2350's first-byte scope on the Mac.
tools/mac-hid-scan/run first

# Explicit two-byte packet or a second-byte sweep under a fixed prefix.
tools/mac-hid-scan/run probe --payload '2B 5A'
tools/mac-hid-scan/run second --prefix 2B
```

Hex payloads exclude the HID report ID. The tool adds report ID `03` and pads the
payload to 64 bytes. By default it blocks first bytes `01`–`12`, `A1`, `AA`, and
`B0`, matching the earlier known-write exclusions. `--include-known` explicitly
allows those prefixes. Unknown commands retain the settings/application risk
accepted for this investigation.

Each run creates a timestamped directory under `tools/mac-hid-scan/output/`.
`events.jsonl` records the exact packet before transmission, flushes it to disk,
then records transfer completion and USB observations. `summary.json` records
the terminal outcome. `--output <new-directory>` chooses the destination;
existing directories are never overwritten. The terminal shows concise progress,
including an **ARMED** banner and reconnect instructions for startup runs.
Add `--json` to print the original JSON events instead. Full JSON logs are saved
in either mode.

**Ctrl+C** cancels the run, saves the summary and any buffered burst transfer
records, and exits with status 130. An interrupted native write may have uncertain
delivery; cancellation during a native USB call can wait for its bounded timeout.
The CLI temporarily enables terminal newline processing and **Ctrl+C** signal
handling, including when a serial session has left the terminal in raw mode,
then restores the previous terminal settings on exit.

## Transport and Interpretation

On the tested Mac, HIDAPI enumerates the factory keyboard/mouse interfaces but
not vendor interface 1. This tool therefore uses PyUSB and bundled libusb. It
claims only interface 1, checks its HID class, interrupt OUT endpoint `02` with
64-byte maximum packets, and exact 36-byte report descriptor from the factory
capture before every write. It does not detach keyboard drivers, set the USB
configuration, or force a USB reset. A worker process bounds native execution;
libusb transfers have a 2000ms timeout and the worker has a default 5000ms limit.

A full 65-byte transfer is USB-level completion, not firmware acknowledgement.
The Mac USB registry is polled approximately every 100ms plus inspection time,
using the target port's location to distinguish factory identity from a changed
or missing device. Each observation lasts at least 1000ms unless a change is
seen. Any disappearance, changed identity, incomplete transfer, or WCH identity
stops further probes. Every run includes an observation baseline without a probe.

WCH `4348:55E0` or `1A86:55E0` at the target port is logged as a bootloader lead,
not confirmed CH552 bootloader protocol. No A1 bulk exchange, erase, programming,
or application-start operation is implemented. A WCH identity elsewhere also
stops the run rather than attributing it to the target. Already connected WCH
devices prevent starting a probe run.

Unlike the RP2350 procedure, this tool does not force re-enumeration after each
probe. Repeated packets are not isolated by power cycles, and earlier commands
may affect later ones. Negative results are limited to the tested packets,
observation windows, transport, and state. They do not exclude delayed effects,
brief transitions between registry polls, or effects requiring a subsequent
reset or power cycle.

## Dependencies and Tests

Dependencies are isolated in the checkout:

```sh
"$HOME/.platformio/penv/bin/python" -m pip install --target .pio/mac-hid-scan \
  -r tools/mac-hid-scan/requirements.txt
"$HOME/.platformio/penv/bin/python" -m unittest discover -s tools/mac-hid-scan -v
```

The packet framing and transfer semantics follow the
[HIDAPI API reference](https://libusb.info/hidapi/group__API.html) and the
[libusb synchronous transfer reference](https://libusb.sourceforge.io/api-1.0/group__libusb__syncio.html).

## Two-Byte and Startup Tests

```sh
# The 21 proposals, including configuration prefixes.
tools/mac-hid-scan/run proposals --include-known

# All 256 AA subcommands, including AA A1 and AA AA.
tools/mac-hid-scan/run second --prefix AA --include-known

# Arm with the pad connected, then manually unplug/reconnect on the same port.
tools/mac-hid-scan/run startup --payload 'AA 55' --include-known --observe 3
```

Startup mode preloads the USB backend and waits for observed absence followed by
reconnection. It polls libusb every 10ms plus enumeration time. The exact packet
intent is saved before waiting; it validates the freshly visible interface and
sends one packet without the ordinary baseline delay or launching a per-packet
worker. Native transfers retain their 2000ms timeout. The usual external worker
execution limit applies to normal sweeps, not startup mode. Startup's connection
wait defaults to 120 seconds; `--connect-timeout` changes it.

`detection_to_write_ms` measures the delay from the first successful libusb
enumeration to the start of the command transfer. This is not an electrical
power-on timestamp. USB enumeration itself takes time, and a startup-only
handler may stop accepting commands before the Mac can access the device.
The observed approximately 1000ms blue key-LED sequence is a timing hypothesis;
it does not establish a bootloader-entry window. Startup mode requires one
packet per manual replug to keep attribution clear.

## Rapid Startup Bursts

Measured on this Mac/pad: 62 full 65-byte interrupt reports completed within
1000ms, with steady report spacing around 16ms. The measured guarded burst
stopped at 988.075ms with no incomplete transfer. This is USB-level completion,
not proof that application firmware processed every command.

```sh
# Measure a burst on the already running pad.
tools/mac-hid-scan/run burst --burst-seconds 1

# Arm the first startup range: 60 eligible commands.
tools/mac-hid-scan/run startup-burst --start-byte 00 --end-byte 4D --burst-seconds 1

# On subsequent fresh connections, cover the remaining ranges.
tools/mac-hid-scan/run startup-burst --start-byte 4E --end-byte 89 --burst-seconds 1
tools/mac-hid-scan/run startup-burst --start-byte 8A --end-byte C8 --burst-seconds 1
tools/mac-hid-scan/run startup-burst --start-byte C9 --end-byte FF --burst-seconds 1
```

Run each startup command with the pad already connected; after **ARMED**,
unplug for about 2 seconds and reconnect on the same port. Leave it connected
until **FINISHED** or **STOPPED**. The four ranges contain 60, 60, 60, and 55 candidates after
the existing known-prefix exclusions. Together they cover all 235 candidates.
Always verify `completed_writes` against `planned`; a slower startup or transfer
failure can leave a range incomplete. Full 235-candidate transmission at the
measured rate would require roughly 3800ms, exceeding a hypothesized 1000ms window.

Packet lists are built and flushed to disk before transmission. Inside the
burst there are no per-packet pauses, identity checks, stdout, or disk writes;
transfer timing is buffered in RAM and saved afterward. The loop stops on a
failed/short transfer or before starting a report with less than 25ms remaining
in its time budget. A short timeout may still leave delivery uncertain. In
startup mode the budget starts at first libusb visibility and includes interface
validation, not electrical power-on or preceding USB enumeration time.

The tool performs one USB registry identity check after the burst. `--settle`
defaults to 0.5 seconds before that check, allowing a little time for
re-enumeration without delaying the burst itself. `--settle 0` requests an
immediate check. This single check can miss transient or later transitions.
A hit would implicate the burst as a whole; isolating a packet would require
further smaller-range trials. WCH identity remains a lead, not A1-confirmed
CH552 bootloader protocol.

`--payload` and `--repeat` can instead construct repeated explicit packets for
burst measurements. Default bursts skip `01`–`12`, `A1`, `AA`, and `B0`;
`--include-known` explicitly includes them. The normal-running burst path has
hardware validation; the fresh-connection burst path is software-tested and
awaits a hardware trial.
