# V12 Fault Investigation Tools

These tools prepare firmware comparisons and collect host evidence for the
unexpected bootloader/error-LED investigation. The parameter overlap is a
confirmed defect; it is not a confirmed cause of either original incident.

## Step By Step

This runs the automated checks, builds both diagnostic pairs, and tests one
physical pad with the overlap retained and then corrected. Run from the
repository root in the same terminal. Run commands one at a time; if a command
fails or the pad behaves unexpectedly, stop and preserve the logs before
continuing. The two ten-minute monitoring runs per diagnostic make the hardware
portion take about 42 minutes, plus building, flashing and manual setup.

### 1. Prepare the Pad and Terminal

Install the [native firmware toolchain](../../README.md#how-to-compile-the-firmware)
if needed. While normal firmware is still installed, export your current profile,
then import and save `tools/investigation/reproduction-six-key.json` using the
current configurator. For a three-key pad, use an explicitly adapted three-key
profile instead. The test profile must contain no **Type text** actions,
including inside macros. Close the configurator and other pad connections.
Connect only the pad being tested.

Set `pad_keys=3` instead of `6` below if testing the three-key pad. The run
directory and all log filenames are generated for you:

```sh
pad_keys=6
run_dir=$(mktemp -d /private/tmp/macropad-investigation-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX)
artifact_dir="$run_dir/firmware"
python3 -m venv /private/tmp/macropad-investigation-venv
investigation_python=/private/tmp/macropad-investigation-venv/bin/python
"$investigation_python" -m pip install -r tools/investigation/requirements.txt
```

### 2. Run Automated Checks and Build the Firmware

These checks do not open or flash the pad. Continue only if all commands succeed
and the builder prints its verified manifest path.

```sh
python3 -m unittest discover -s tools/investigation -p 'test_*.py'
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview --no-text --define=INVESTIGATION_DIAGNOSTICS=1 --define=INVESTIGATION_BUILD_ID=1 --define=INVESTIGATION_OVERLAP_FIX=0
python3 tests/run_host_tests.py --no-preview --no-text --define=INVESTIGATION_DIAGNOSTICS=1 --define=INVESTIGATION_BUILD_ID=2 --define=INVESTIGATION_OVERLAP_FIX=1
python3 tools/investigation/build_firmware.py --output "$artifact_dir"
```

### 3. Flash the Overlap-Retained Diagnostic

Run the upload command. When it starts waiting, unplug the pad, hold the encoder
button, reconnect USB, and release the button within ten seconds. Wait for a
successful upload before continuing. If it times out, repeat this command and
the bootloader-entry steps.

```sh
python3 "$artifact_dir/target_builder.py" upload "$artifact_dir/source" "$artifact_dir/${pad_keys}-key-diagnostic-overlap-no-text" 3
mkdir "$run_dir/overlap"
```

### 4. Test the Overlap-Retained Diagnostic

The commands below run in order: initial capture, ten minutes of passive idle
observation, ten minutes of active monitoring, HID **GET_REPORT** stress,
USB **SET_IDLE**/**GET_IDLE**/**GET_REPORT** stress, and a final capture.
Leave the pad idle during passive monitoring. During active monitoring and
both stress runs, repeat the physical key/encoder workload associated with the
incident, using a harmless host application. Use the same workload when testing
the corrected firmware. Each stress run lasts roughly twenty seconds plus USB
request time. Note LED behavior and unexpected actions separately.

```sh
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/before.jsonl" capture
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/passive.jsonl" monitor --passive --duration 600
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/active.jsonl" monitor --duration 600
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/get-report.jsonl" exercise --backend hid --count 1000
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/idle-report.jsonl" exercise --backend usb --count 1000
"$investigation_python" tools/investigation/host.py --log "$run_dir/overlap/after.jsonl" capture
```

If active monitoring reports invalid configuration, it captures the images and
stops: do not proceed to stress tests or reflash. If you notice an error LED or
other unexpected behavior during passive monitoring, record the LEDs and
responsiveness before opening a connection; use the next capture only after
recording those observations. Preserve that evidence before continuing.

macOS may reject the USB stress command because its HID driver owns the
interface. If that is the only failure, retain the error log, record that
**SET_IDLE** was not tested, and continue to the final capture. Do not treat an
access failure as a successful USB stress run.

### 5. Flash and Test the Overlap-Corrected Diagnostic

Repeat the same encoder bootloader-entry steps when this uploader starts
waiting, then run the same test sequence with separate logs:

```sh
python3 "$artifact_dir/target_builder.py" upload "$artifact_dir/source" "$artifact_dir/${pad_keys}-key-diagnostic-fixed-no-text" 3
mkdir "$run_dir/fixed"
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/before.jsonl" capture
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/passive.jsonl" monitor --passive --duration 600
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/active.jsonl" monitor --duration 600
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/get-report.jsonl" exercise --backend hid --count 1000
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/idle-report.jsonl" exercise --backend usb --count 1000
"$investigation_python" tools/investigation/host.py --log "$run_dir/fixed/after.jsonl" capture
```

Apply the same stop conditions and USB-access exception as in Step 4. If using
the browser instead of the native upload commands, follow
[Flashing Diagnostic Firmware](#flashing-diagnostic-firmware); the second upload
can use **Enter bootloader via HID**.

### 6. Keep the Results

Print the location containing both sets of logs, the firmware and its manifest:

```sh
printf 'Investigation results: %s\n' "$run_dir"
```

Copy that directory out of `/private/tmp/` for long-term retention, along with
your workload notes and LED observations. A clean run does not rule out the
original fault. To test the other physical pad, start again at Step 1 with its
key count and adapted profile; this creates a fresh result directory.

## Firmware Variants

Run from the repository root:

```sh
python3 tools/investigation/build_firmware.py
```

The builder retains an artifact directory outside the repository and prints
its path. It never uploads, generates releases or writes checked-in release
files. By default, each run creates a unique directory in `/private/tmp/` named
`macropad-fault-YYYYMMDDTHHMMSSZ-SUFFIX`, using a UTC timestamp and a random suffix.
`--output /private/tmp/NAME` selects a location instead; that directory must be
empty or not yet exist. Copy artifacts elsewhere if long-term retention is needed.

The manifest identifies the selected HEX files and their SHA-256 checksums.
It includes source/tool snapshots, compiler version, revision/dirty-state
information, flags, failed size attempts and successful measurements.
Only entries in `selectedImages` are the matched diagnostic comparison pair.
Failed full-feature attempts are retained for size analysis and are not
flashable application images.

| Diagnostic | Build ID | USB Parameter Storage |
| --- | ---: | --- |
| Overlap Retained | 1 | Original internal-RAM overlay |
| Overlap Corrected | 2 | Four dedicated external-RAM bytes |

Both diagnostics disable live color preview and **Type text**, in the approved
feature-cut order. Macros, pauses/repeats, mouse actions, held scrolling,
chords, timers, LED-control actions, rainbow lighting and bootloader recovery
remain enabled. Stack watermark instrumentation is disabled. The normal
configuration version and ordinary status/info replies are unchanged.

Profiles containing **Type text**, including text inside a macro, are rejected
by these reduced builds. A previously saved profile containing it will produce
the normal invalid-config indication at startup. Export the current profile
and load the original incident profile with normal firmware before installing
a reduced diagnostic. `reproduction-six-key.json` preserves that original
six-key profile; `reproduction-six-key.bin` is its reconstructed encoding,
not a device readback. CRC is `0x753C`; SHA-256 is
`092eafbe8dddf27445472bad7fee362bda9841f0dd688e8aa40447f6af9404e1`.
A three-key pad requires an explicitly adapted three-key profile.

All investigation switches default off; **Type text** defaults on. Building
the project normally preserves the original production behavior and defect.
The corrected full-feature build is measured but currently exceeds the
14,336-byte application limit. The comparison diagnostics are the usable
corrected artifacts; this is not a production-release fix.

## Flashing Diagnostic Firmware

Use the native macOS uploader with the CH55xDuino 0.0.25 toolchain installed as
described in the [firmware setup instructions](../../README.md#how-to-compile-the-firmware).
Run the commands below from the repository root. Close the configurator and
investigation host tools, and connect only the pad being flashed. First export
its profile and prepare a profile without **Type text**, as described above.

Set `artifact_dir` to the directory printed by the investigation builder:

```sh
artifact_dir='/private/tmp/macropad-fault-REPLACE-WITH-YOUR-RUN'
```

Check that `manifest.json` has `verified` set to `true`, and select the matching
physical key count from `selectedImages`. The current reduced diagnostics use
the following directories, each containing `firmware.hex`:

| Physical Pad | Overlap Retained (Build ID 1) | Overlap Corrected (Build ID 2) |
| --- | --- | --- |
| Six Keys | `6-key-diagnostic-overlap-no-text` | `6-key-diagnostic-fixed-no-text` |
| Three Keys | `3-key-diagnostic-overlap-no-text` | `3-key-diagnostic-fixed-no-text` |

For example, flash the six-key overlap-retained diagnostic:

```sh
python3 "$artifact_dir/target_builder.py" upload "$artifact_dir/source" "$artifact_dir/6-key-diagnostic-overlap-no-text" 3
```

When the uploader begins waiting, unplug the pad, hold the encoder button,
reconnect USB, then release the button. The uploader waits up to ten seconds;
if it times out, repeat the command and bootloader-entry steps. Wait for a
successful upload before starting monitoring or capture. If encoder entry is
unavailable, follow the [hardware bootloader instructions](../../README.md#first-upload-enter-the-bootloader-via-hardware).

After testing the retained overlap, flash its corrected counterpart and repeat
the same workload. For the six-key pad:

```sh
python3 "$artifact_dir/target_builder.py" upload "$artifact_dir/source" "$artifact_dir/6-key-diagnostic-fixed-no-text" 3
```

For a three-key pad, substitute the corresponding `3-key-...` directory in
both commands. The final `3` is the USB boot configuration, not the key count;
keep it unchanged for both pads. These commands upload the existing HEX without
rebuilding. Do not use `pio run -t upload` for this comparison: it builds and
uploads the ordinary project firmware instead.

Alternatively, open the [browser firmware installer](../../webUploader/README.md#use)
in desktop Chrome or Edge over HTTPS or localhost. Select the correct physical
variant and drop the selected diagnostic `firmware.hex` into the local-file
area. Confirm the variant before installing. The installer validates the HEX
and application boundary before allowing installation.

After installing a diagnostic supporting opcode `0x72`, **Enter bootloader via HID**
can request bootloader entry without holding the encoder. Close configurator
and host-tool connections first, select the running pad in the HID picker,
then click **Connect bootloader** once the command is acknowledged. Older
diagnostic builds require encoder or hardware bootloader entry for this first
update.

### Diagnostic Bootloader Command

Opcode `0x72` uses the same HID configuration transport as `0x71`, with zero
offset, length, reserved byte and request data. It is enabled only when
`INVESTIGATION_DIAGNOSTICS=1`; normal builds return bad-opcode status. Malformed
requests are rejected by the normal protocol validation. A valid request gets
an OK reply with zero payload, then enters the existing bootloader path from
the main loop after the reply is queued. Entry releases held actions, drains
pending reports for up to 100ms and switches to the bootloader USB identity.
The command works with an invalid profile and does not write saved configuration.
A USB reset before the acknowledgement is queued cancels the request. The
read-only host investigation tool does not send this command.

## Read-Only Diagnostic Protocol

Opcode `0x71` uses the normal configuration transport with zero offset, length
and request data. Normal builds reject it. Its 11-byte payload is:

| Offset | Encoding |
| --- | --- |
| 0–1 | ASCII `FD` |
| 2 | Schema 1 |
| 3 | Physical variant: 0 six keys, 1 three keys |
| 4 | Investigation build ID: 1 original overlap, 2 corrected |
| 5 | Cached saved-flash validity, 0 or 1 |
| 6 | Active-configuration validity, 0 or 1 |
| 7–10 | Unsigned 32-bit application `millis()` value, little endian |

Values are copied into the existing reply buffer when requested. No diagnostic
RAM counters, persistent history, reset-source capture or flash logging are
added. Uptime starts with application initialization, wraps after about 49.7
days and continues across ordinary USB bus resets. Flags are cached validity
results, not fresh CRC checks. The snapshot does not capture every other runtime
variable or prove the LED renderer is intact.

## Host Setup

Python 3.11 was used for verification. Install dependencies in an isolated
environment; no system driver installation is required:

```sh
python3 -m venv /private/tmp/macropad-investigation-venv
/private/tmp/macropad-investigation-venv/bin/python -m pip install -r tools/investigation/requirements.txt
```

The verified macOS environment contains HIDAPI 0.15.0, PyUSB 1.3.1 and
libusb-package 1.0.30.0. The latter supplies a libusb backend without Homebrew.
Only imports/API availability and backend loading were checked locally;
no attached pad was opened or exercised during implementation.

The installed HIDAPI wheel defaults to exclusive device opens. The tool
explicitly selects and verifies shared access through its macOS API before
opening anything, preserving normal keyboard/mouse handling. It stops if that
API is unavailable or shared mode cannot be confirmed. This configuration
was checked without opening an attached device. macOS may still require Input
Monitoring permission for HID access.

Use unique log filenames: tools refuse to overwrite existing evidence. If
multiple pads are connected, use `--serial SERIAL` before the subcommand.
Close configurator/stack-reader connections before active monitoring or capture.
Logs contain raw configuration replies and optional profile images, which can
include stored text. Keyboard reports from ordinary typing and the contents of
keyboard `GET_REPORT` responses are not logged.

## Monitor and Capture

Observe enumeration without opening the device or sending requests:

```sh
/private/tmp/macropad-investigation-venv/bin/python tools/investigation/host.py --log /private/tmp/pad-passive.jsonl monitor --passive
```

Read uptime and both validity flags once per second, reconnecting after device
reappearance or transport errors:

```sh
/private/tmp/macropad-investigation-venv/bin/python tools/investigation/host.py --log /private/tmp/pad-active.jsonl monitor
```

`--duration 600` limits a run to approximately ten minutes; Ctrl-C ends an
unlimited run. Both monitor modes show an in-place elapsed-time progress bar
in an interactive terminal, for example `4:56 [#########           ] 10:00`.
It updates at the polling interval (one second by default); USB requests can
delay an update. Unlimited runs show elapsed time without a target. Progress
uses standard error, is hidden when that stream is redirected, and is not
written to the JSONL evidence log. Log timestamps use UTC and a host monotonic clock. On an invalid
flag, the tool logs the state, attempts to capture both images, and stops so
automatic reconnects do not further disturb the evidence. Partial captures
and errors remain in the log if the device stops replying.

Take one diagnostic/image capture on demand:

```sh
/private/tmp/macropad-investigation-venv/bin/python tools/investigation/host.py --log /private/tmp/pad-capture.jsonl capture
```

Image reads are sequential, not atomic. Capture LEDs and responsiveness before
opening a connection: opening/reconnecting can affect USB timing or runtime
state. A transport timeout is logged separately from observed disappearance.

Passive monitoring polls HID enumeration at the chosen interval. Short
disconnects can be missed, bootloader USB identities are not tracked, and a bus
reset need not appear as disappearance. Active monitoring changes USB traffic.
Run passive/no-reader idle tests separately from active capture runs.

Uptime comparisons account for 32-bit wrap and elapsed host time, with a 2,000ms
tolerance. A mismatch is labeled `possible-restart-or-clock-discontinuity`;
it is not an exact reboot count or proof of a reset cause. Small/very early
restarts can fall within tolerance; gaps of at least one uptime period are
ambiguous. Firmware build/board changes are classified separately. Matching
uptime does not prove that every intervening runtime state was correct.

## Controlled USB Class Requests

First test the existing overlap, then repeat the same workload on its corrected
counterpart. Original format-12 firmware without the new diagnostic is also
accepted by the HID exercise path. Default traffic uses mouse report 2, so
movement is not replayed. Use a harmless host application when exercising
bindings that generate input.

Native HIDAPI issues input `GET_REPORT` requests:

```sh
/private/tmp/macropad-investigation-venv/bin/python tools/investigation/host.py --log /private/tmp/pad-get-report.jsonl exercise --backend hid --count 1000
```

The optional libusb path issues `SET_IDLE`, confirms the rate using `GET_IDLE`,
then issues `GET_REPORT`:

```sh
/private/tmp/macropad-investigation-venv/bin/python tools/investigation/host.py --log /private/tmp/pad-idle-report.jsonl exercise --backend usb --count 1000
```

It uses report 2, rate zero and 20ms between iterations by default. On exit it
attempts to restore and confirm the original rate. `--rate` uses units of 4ms.
USB loss, a killed process or an access failure can prevent restoration; the
log records successful restoration or the error. This is transient HID policy,
not a saved-profile write.

macOS may deny libusb interface access while its HID driver owns the interface.
The tool does not detach a driver, seize a device, change USB configuration,
reset the pad or retry through destructive operations. An access failure means
that `SET_IDLE` testing was not performed. HIDAPI alone covers `GET_REPORT`;
another host with suitable USB permissions may be needed for `SET_IDLE`.

Successful replies establish request handling, not the timing of preemption
against a foreground action. Record unexpected actions, LED behavior and
workload separately. A clean stress run cannot rule out the original overlap.
Neither stress path saves profiles or flashes firmware.

## Verification

```sh
python3 -m unittest discover -s tools/investigation -p 'test_*.py'
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview --no-text --define=INVESTIGATION_DIAGNOSTICS=1 --define=INVESTIGATION_BUILD_ID=1 --define=INVESTIGATION_OVERLAP_FIX=0
python3 tests/run_host_tests.py --no-preview --no-text --define=INVESTIGATION_DIAGNOSTICS=1 --define=INVESTIGATION_BUILD_ID=2 --define=INVESTIGATION_OVERLAP_FIX=1
```

The reduced suite runs USB, input, macro, protocol and text-rejection checks,
including validation of the original reproduction image. Full suites retain
text coverage. The builder checks HEX/listing agreement, RAM layout and actual
parameter-store/read fragments: all 65,536 foreground-argument/idle-rate pairs
and both `GET_REPORT` output selectors. It also rejects remaining overlaid
allocations in the USB/helper modules of the corrected build. These checks
are not a whole-device emulator or hardware validation.

Implementation references: [SDCC overlay requirements](https://sdcc.sourceforge.net/doc/sdccman.pdf),
[HIDAPI](https://github.com/libusb/hidapi), and
[PyUSB control transfers](https://github.com/pyusb/pyusb/blob/master/usb/core.py).
