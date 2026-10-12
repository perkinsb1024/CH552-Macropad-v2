# RP2350 Factory HID Command Scanner

Install [ch552-hid-scan.uf2](ch552-hid-scan.uf2) on the unmodified Waveshare
RP2350-USB-A. This is a separate program from the bootloader reader and firmware
updater. It searches the factory HID protocol for a bootloader-entry command,
then exports its findings on the read-only **CH552SCAN** drive. Completed and
failed runs are saved to RP2350 flash and survive reset or power loss.

The user authorized unknown-command probing with risk to factory settings and
application firmware. Skipping known writes does not make unknown commands safe.
This first pass varies only the first payload byte; it sends no two-byte sweep,
configuration-save sequence, or WCH bootloader programming command.

## Run a Scan

1. Leave USB-A empty. Hold **BOOT** while connecting RP2350 USB-C to the computer.
   Release **BOOT** when its boot drive appears, then copy `ch552-hid-scan.uf2`
   onto that drive. Wait for the solid blue LED.
2. Keep USB-A empty until starting the scan. Press **BOOT** once. The LED turns
   cyan for an 8000ms insertion window. Connect the unpowered factory macropad
   using a USB-A to USB-C data cable, preferably within the first 5000ms.
3. Keep both cables connected while the LED is yellow. Leave the macropad's keys
   and encoder alone, and keep other USB devices out of this connection. The
   scanner captures its factory descriptors, checks an initial reset control,
   and then probes automatically. Allow several minutes: approximately 6–8
   minutes per supported report ID is an estimate, not a hardware measurement.
4. Wait for green, amber, or red, and for **CH552SCAN** to appear. Copy all files
   to the computer; start with `REPORT.TXT` and `RESULTS.CSV`.
5. Results remain available after disconnecting and reconnecting the RP2350 to
   the computer. A blue LED after restart means idle; any mounted results are
   the last saved run. Another scan requires explicit **BOOT** arming.

For another attempt, unplug the macropad, press RP2350 **RESET**, wait for blue,
then repeat step 2. The scanner allows one host initialization and one scan per
adapter boot. RP2350 reset does not switch target VBUS; the target must be
unplugged to power-cycle it.

The USB-C connection can supply both power and results access. A power-brick run
can be moved to the computer after the terminal LED because results are saved
to flash. If `SAVEERR.TXT` is present, this run exists only in RAM: copy its
files before reset or power removal. A failed save retains the previous valid
flash snapshot when one exists.

## LED Status

All colors are solid.

| Color | Meaning |
| --- | --- |
| Blue | Idle. Any mounted results are from the previous saved run. |
| Cyan | Insert the unpowered target during the 8000ms window. |
| Yellow | Enumerating, scanning, checking identity, or saving findings. |
| Green | Factory mode was observed, then CH552 bootloader identity was confirmed after a probe; findings saved. |
| Amber | The supported first-byte sweep completed; no confirmed bootloader transition; findings saved. |
| Red | Scan stopped on an error, bootloader appeared before probing, or saving failed. Inspect the files. |

An optional CDC console accepts newline-terminated `arm`, `status`, `stop`, and
`help`. `stop` ends an active scan and saves partial findings. **BOOT** is sampled
only while idle; pressing it during scanning does not stop the scan. **RESET**
interrupts a run immediately and loses its unsaved progress.

## Probe Scope and Framing

The target must enumerate as `1189:8890`, with HID interface 1, matching the
recovered Windows **MINI KeyBoard V02.1.1** configurator. Other identities or
interfaces stop the scan and produce diagnostics. A vendor Output report must
be present in the captured HID descriptor; its payload must be byte-aligned and
contain 1–64 bytes. Unsupported, truncated, ambiguous, or oversized descriptors
stop the scan. No speculative report length or report ID is used.

Descriptor-supported report IDs are searched in the factory program's preference
order: 3, 0, then 2. Only vendor Data Output reports are eligible; keyboard LED
and Feature reports are excluded. Every eligible ID gets the first-byte sweep
before proceeding to the next one. ID 0 means an unnumbered report; a descriptor
mixing unnumbered and numbered Output reports is rejected.

For each report, payload byte 0 varies from `00` through `FF`, in ascending
order. Every remaining payload byte is zero. These first bytes are skipped:

| Hex Bytes | Evidence for Skipping |
| --- | --- |
| `01`–`12` | Configuration selectors for twelve keys and two knobs, traced in the Windows executable. |
| `A1` | Selects the configuration layer. |
| `AA` | Prefix for the known key and LED save commands. |
| `B0` | LED configuration selector. |

This produces 235 candidates per eligible report ID. Zero is included because
the factory application sends a zero-filled report during report-ID probing.
The skip list covers the first byte even if the all-zero tail would normally
make the corresponding configuration packet invalid.

When interface 1 provides interrupt OUT, the scanner sends there. Otherwise it
uses HID Output **SET_REPORT** on control endpoint 0, addressed to interface 1.
For numbered reports, the on-wire report begins with its report ID; the
following byte is the candidate. The control request also carries that ID in
`wValue`, following HID report framing. An unnumbered report has no leading ID
byte. The descriptor determines payload size, excluding that prefix.

## Entry Detection and Attribution

The new startup sequence holds USB D+ and D− low during insertion using the PIO
host's bus-reset API, with no host frames scheduled. This counters the fixed R13
pull-up while the target powers on, to try to obtain factory application mode.
After 8000ms it releases the lines and starts host frames/enumeration. This
sequence is software-tested but has not been tried on hardware. If the device
starts in bootloader mode anyway, no candidate is sent and no hit is claimed.

Before sending candidates, the scanner performs one forced re-enumeration and
requires the same factory HID descriptor afterward. This tests whether reset
alone changes mode under the initial conditions.

Each candidate gets one application-level submission. On completion, the
scanner observes for 1000ms, then closes the old host session and requests
re-enumeration, including a USB bus reset. A 2000ms transfer timeout also leads
to an identity check, with delivery recorded as uncertain. USB transport retries
remain those of the pinned libraries. Application reports are not replayed.

Explicit re-enumeration is necessary because R13 can hide a physical disconnect.
A disconnect, stall, timeout, or host-write success is not treated as entry.
The scanner continues only after seeing the factory identity and same HID
report descriptor. A WCH
`4348:55E0` or `1A86:55E0` bulk interface triggers an A1 identity read; only a valid
CH552 `52 11` reply confirms the bootloader. No erase, program, comparison, key
setup, configuration-write, or application-start command is sent to the bootloader.
Enumeration has a 10000ms deadline. Unexpected identities, descriptor changes,
invalid bootloader replies, and later USB failures stop the scan with diagnostics.

Green records a transition after a particular probe and the subsequent USB
reset. It does not prove causation from that one command in isolation. The
target is not power-cycled between candidates, so earlier commands may leave
state that affects later ones. A hit needs a separate controlled replay; a
negative sweep does not exclude commands requiring different arguments, report
types, IDs, timing, or state.

## Saved Files

| File | Contents |
| --- | --- |
| `REPORT.TXT` | JSON outcome, baseline and bootloader confirmation, last command/report ID, transport counts, scope and timing. |
| `RESULTS.CSV` | One row per attempted candidate: adapter timestamp, report ID, first byte, payload length, USB result, actual transmitted bytes, and observed mode or terminal error. |
| `TRACE.TXT` | JSON-lines baseline descriptors, bounded input reports/error diagnostics, bootloader evidence, and terminal outcome. |
| `USBDEV.BIN`, `USBCFG.BIN`, `HIDRPT.BIN` | Factory descriptors captured before probing, when those reads succeeded. |
| `LASTOUT.BIN` | Exact last attempted report, including the nonzero report-ID prefix. |
| `A1.BIN` | Raw bootloader identification reply, including a received invalid reply. |
| `SAVE.TXT` | Flash snapshot interpretation. |
| `SAVEERR.TXT` | Present only when this run failed to save; copy RAM files immediately. |

USB result `0` means transport success; compare `actual_bytes` with payload
length plus the nonzero report-ID prefix. It does not prove the firmware
understood the report. Result `-1` or byte count `-1` means no completion was
observed. `factory` means factory mode was confirmed after that candidate;
it does not mean the command had no other effect. The scanner records all
attempted candidates in CSV. Trace capture limits input reports and repeated
error diagnostics to 32 each; `dropped_trace_events` reports further trace
buffer overflow independently of CSV findings.

The 64KiB FAT12 disk is read-only to the computer. Completed/failed runs commit
to alternate 68KiB flash slots at the top of the RP2350's physical 2MiB flash.
The disk and header have CRC32 checks; the commit header is written last.
Only the linker's application region is reduced; physical flash size stays
2MiB. The old snapshot remains valid during a save. Restoration validates both
CRCs and chooses the newest valid snapshot.

Progress is in RAM until the run ends or `stop` is processed. An adapter
brownout/reset during scanning loses that progress and may expose the previous
run's results after reboot. These slots are specific to the scanner; changing
back to another RP2350 program, its storage operations, or erasing the chip can
overwrite them. Copy findings to the computer for long-term storage.

## Build and Validation

The reader-derived board, descriptor, bootloader-parser and FAT helpers were
copied from this branch's `tools/rp2350-passthrough/firmware/` on 2026-10-11.
The original reader and packaged programmer remain separate. The recovered
factory executable selectors were checked against its full decoded IL under
`/private/tmp/macropad-factory-analysis/`, matching source executable inventory
SHA-256 `4ae53d3a40921e4f57444c489fa1b38fe91a2e907feda17630450fc97a7cd7b1`
at historical revision `c53c6be28131f6304648c836de9bac357d4d8bba`. This scan does
not execute the Windows program.

Dependencies use the reader's pinned Pico SDK 2.3.1, TinyUSB and Pico-PIO-USB
revisions. From the repository root:

```sh
python3 tools/rp2350-passthrough/prepare_deps.py
cmake -S tools/rp2350-hid-scan/firmware -B tools/rp2350-hid-scan/build \
  -DPICO_SDK_PATH="$PWD/tools/rp2350-passthrough/.deps/pico-sdk" \
  -DPICO_PIO_USB_PATH="$PWD/tools/rp2350-passthrough/.deps/Pico-PIO-USB" \
  -DPICO_TOOLCHAIN_PATH=/path/to/arm-gnu-toolchain \
  -DCMAKE_BUILD_TYPE=Release
cmake --build tools/rp2350-hid-scan/build -j 8
python3 tools/rp2350-hid-scan/tests/run.py
```

Tests require a native C compiler with AddressSanitizer and UndefinedBehaviorSanitizer;
the disk decoder currently uses the reader's independent Python FAT decoder.
Build identification, hashes and measured resources are in
[validation.md](validation.md) and [build-manifest.json](build-manifest.json).
No connected hardware was accessed during implementation or software validation.
