# RP2350 USB programmer experiment

Recorded 2026-10-07. Read-only hardware trials completed CH552 identification on
bootloader 2.5.0. The user then requested proceeding directly to standalone
programming. The write-capable `standalone/` implementation completed its first hardware
program/compare/config-readback/run-command trial on version 0.2.2. The user
subsequently confirmed valid macropad configuration and power-brick-only success;
bootloader entry remains intermittent.
See [standalone.md](standalone.md) for the current build and operating sequence.
The chronological read-only trial notes below remain as provenance.

## Proof-of-concept implementation

The initial read-only implementation is in `firmware/`, with build and trial
instructions in [usage.md](usage.md). It supports one explicit, delayed host start
per RP2350 reset and sends only `A1` identification and `A7` information reads
after validating the target's USB identity and bulk interface. It captures raw
descriptors and replies and does not implement flashing.

The first host tool, `host/probe.py`, uses Python's standard library on macOS/Linux
to avoid adding a serial dependency for identification trials. This is a small
newline-delimited JSON console, rather than the Node.js binary upload bridge
proposed below. The choice does not settle the later uploader language or framing.
Portable C parser tests and simulated POSIX serial-port tests accompany it.

Source inspection found that the selected PIO host checks the initial line state,
so an existing D+ high level can start its ordinary enumeration path. The first
implementation uses that behavior without a forced-attach patch. The fixed R13
pull-up and missing external host pulldowns remain hardware uncertainties.

Local validation on 2026-10-07:

- Built `build-arm/ch552_probe.uf2` with Arm GNU Toolchain 14.3.Rel1, Pico SDK
  2.3.1, the SDK's pinned TinyUSB, and the Pico-PIO-USB revision listed in
  [usage.md](usage.md). Picotool 2.3.1 confirmed an RP2350 ARM Secure UF2 for
  `waveshare_rp2350_usb_a`; picotool was built without USB access support.
- Portable C tests passed with AddressSanitizer/UndefinedBehaviorSanitizer.
  Simulated POSIX serial-port tests passed for capture, preflight rejection,
  failure handling, and arm/start acknowledgement sequencing.
- The Homebrew compiler initially found on PATH lacked the C runtime. The working
  compiler was downloaded/extracted under `/private/tmp`, without a system install;
  its archive SHA-256 matched Arm's published checksum. Dependency checkouts also
  live under `/private/tmp` for this local build. `prepare_deps.py` provides the
  reproducible source setup under ignored `.deps/` for subsequent builds.
- The final RP2350 core0 stack reservation is 4KiB in its scratch bank. Large log
  formatting buffers use static RAM; CH552 stack capacity is unchanged.
- No connected hardware was opened, probed, or flashed during implementation.
  The next required input is an actual stock-board insertion/probe capture.

The initial UF2 SHA-256 is
`71980ddbeeac542b72c0dd650bed693897592f476af7195db5a98e3ec38086f1`.
Rebuilds may differ because the SDK embeds build metadata.

### First hardware capture and descriptor-read correction

User capture: `logs/probe-20261007T204111-909048Z.jsonl`, firmware 0.1.0.
The user observed that the macropad's configured LEDs did not turn on during the
trial. That observation alone does not identify the running firmware, but the USB
capture provides stronger evidence:

- The RP2350 started its host after the 5000ms insertion window. At roughly 523ms
  after host startup, it opened interface 0 of `4348:55E0` with bulk IN `0x82` and
  bulk OUT `0x02`, both with 64-byte maximum packets.
- TinyUSB completed enumeration and mounted the device. A further device-descriptor
  read succeeded with 18 bytes:
  `12011001ff8055084843e055500200000001`. This advertises an eight-byte control
  endpoint and the WCH bootloader identity.
- The next diagnostic configuration-descriptor read requested the entire 512-byte
  receive buffer. It completed with USB result 0 (success), but zero data bytes.
  Our validation stopped the probe with `short_configuration_descriptor`.
- Neither `A1` nor `A7` was sent. Thus the capture demonstrates bootloader USB
  enumeration and control communication, but not CH552 protocol identification
  or a firmware update. It does not establish the exact cause of the empty reply.

Firmware 0.1.1 replaces the oversized request with the same sequence used by the
successful SDK enumerator: read nine bytes, validate `wTotalLength` against the
buffer capacity and minimum interface size, then request precisely that length.
It logs `configuration_header` and `configuration_read` for the next trial and
checks the final returned length against the header before sending `A1`.

The corrected UF2 built successfully and its version/family metadata were checked.
Descriptor-length tests passed with AddressSanitizer/UndefinedBehaviorSanitizer.
The 0.1.1 UF2 SHA-256 is
`bd152a37bd23938fa20fa90a86e34928d9c4d4fdb1077cbdef738776d18f8e38`.
Next trial: install 0.1.1 on the RP2350 with the pad disconnected, repeat the same
insertion/capture workflow, and inspect the descriptor and identification replies.

## Objective and constraints

Build a USB-connected programmer that enters the CH552G factory bootloader and
uploads macropad firmware without opening or modifying the macropad.

- Zero soldering and zero hardware modifications, including to the programmer.
- Use the stock Waveshare RP2350-USB-A board and ordinary USB cables.
- Keep the built-in D+ pull-up in place. Removing, replacing, or switching R13 is
  outside this experiment's scope.
- It is acceptable to power the RP2350 first, then manually plug the macropad
  into its USB-A port. Unplugging and reinserting the macropad supplies subsequent
  power cycles.
- Original staging proposed a native computer-controlled uploader before a
  standalone programmer. After successful identification, the user explicitly
  chose standalone programming next; computer access is optional for debugging.
- First establish bootloader identification without writes. Flashing is a later
  milestone, not a prerequisite for demonstrating entry.

The linked board is RP2350-based, despite the initial discussion calling it an
RP2040 board. RP2040 can support the same broad architecture, but this plan
targets the Waveshare RP2350-USB-A specifically.

## Repository placement

Keep the experiment in `tools/rp2350-programmer/` in this repository. It shares
CH552 protocol behavior, image validation, and firmware artifacts with the
existing uploader. Keep experiment details here rather than in the project README.
Consider a separate repository only if the adapter develops into a general CH55x
programmer with its own independent users and release lifecycle.

Suggested eventual layout:

```text
tools/rp2350-programmer/
  plan.md
  firmware/       Pico SDK C/C++ project, board configuration, USB host/device code
  host/           Native CLI and serial transport
  tests/          Protocol fixtures and meaningful host-side checks
  findings/       Dated hardware observations and captured transaction logs
```

Keep generated builds and dependency checkouts out of version control. Record
dependency revisions, compiler/SDK versions, board markings, and reproducible
build instructions once implementation begins. This task does not generate CH552
releases or commit changes.

## Why this can work

The CH552 configuration word at `0x3FF8` contains `No_Boot_Load` at bit 14.
Despite its name, a value of 1 selects power-on execution at `0x3800`. The factory
bootloader can check an entry condition before handing control to the application
at `0x0000` through a software reset. Merely selecting `0x3800` does not force an
update session. Only power-on reset reloads configuration; a USB bus reset is not
a CH552 power-on reset. The runtime `bBOOT_LOAD` bit is separate and read-only.

On the project's existing pads, holding USB D+ high at power-on is the known
hardware entry method. A programmable adapter can supply that signal through the
cable, then act as the USB host. No HID bootloader command in the factory
application is required. Applicability still depends on the actual target being
a CH552 with compatible bootloader configuration; newer factory pads may differ.

Ordinary computer USB APIs do not expose D+ as a controllable 3.3V GPIO.
Removing a browser permission dialog does not change that limitation. USB
electrical `TEST_J` is a high-speed test signal, not an established substitute for
the CH552's power-on pull-up condition.

## Stock Waveshare board observations

The published schematic shows:

| Connection | Implementation | Implication |
| --- | --- | --- |
| USB-C data | Native RP2350 USB controller | Computer-facing USB device connection |
| USB-A D+ | GPIO12 through a 27Ω series resistor | GPIO access and PIO USB host transmission |
| USB-A D− | GPIO13 through a 27Ω series resistor | Adjacent GPIO pair for Pico-PIO-USB |
| R13 | Fixed 1.5kΩ D+ pull-up to 3.3V | Possible boot-entry signal, but masks normal attachment detection |
| R10 | Optional D− pull-up, marked unpopulated | Confirm the actual board matches the schematic |
| USB-A power | Connected to VSYS, without a GPIO-controlled load switch | Manual insertion supplies the target power-on event |

The permanent R13 pull-up may already provide the desired CH552 entry signal.
This is a hypothesis, not a demonstrated result. It also means the USB host may
see a full-speed idle state even with no target attached. Normal hot-plug and
disconnect detection cannot be assumed to work.

Do not plan to remove the pull-up in software: it is physically connected to the
3.3V rail. Nor should the prototype depend on holding D+ high using a push-pull
GPIO while the target is unpowered. Start with GPIO12/13 as inputs, with internal
pull configuration chosen deliberately, and use the board's existing resistor.
The CH552 and RP2350 supplies rise in a different sequence when the board is
powered with the macropad already attached; that is not the initial workflow.

The central feasibility question is whether the unmodified circuit permits both
entry and subsequent reliable bootloader communication. If it does not, document
that result; hardware modifications are not a fallback within this scope.

## Software architecture

Use C/C++ with the Pico SDK, TinyUSB on the native USB-C device port, and
Pico-PIO-USB for the USB-A host port. Start from the upstream dual-role example
that receives host-side HID traffic while exposing a native USB CDC device.
The CH552 bootloader uses vendor bulk transfers, so HID hosting alone is not
sufficient: implement or adapt a TinyUSB host driver that opens its bulk endpoints.

Pin D+ to GPIO12 and D− to GPIO13 explicitly. Verify the required clock setup,
PIO resources, interrupt handling, and RP2350 support against the selected library
revision. Prefer a revision incorporating the relevant RP2350 GPIO erratum
workaround. Pin working versions after testing rather than assuming all releases
or board revisions behave identically.

The adapter terminates two separate USB connections. It is an active protocol
bridge, not a transparent USB hub. The computer sees the RP2350's interface; the
RP2350 enumerates and communicates with the CH552. Existing WebUSB or native
upload tools need a transport adaptation to use it.

## Phase 1: prove entry and identification

1. Build a UF2 that exposes a USB CDC serial console and reports its firmware
   revision, board configuration, pin mapping, and host-stack initialization.
2. Power the RP2350 through USB-C with the USB-A port empty. Initially leave the
   PIO host stopped and the data GPIOs as inputs so R13 supplies the pull-up.
3. Arm a probe through the serial console. Prompt the operator to insert the
   macropad, then wait for explicit confirmation or use a documented timed
   insertion window. D+ going high is not a usable insertion detector here.
4. After insertion, initialize/restart the PIO host and request a USB bus reset
   followed by enumeration. Check what the chosen host stack actually permits:
   initialization may drive the lines or alter pulls. Allow an experimentally
   adjustable delay between insertion and host startup; do not assume an exact
   CH552 sampling interval or bootloader timeout.
5. If standard connection handling fails because D+ was already high, investigate
   a bounded, explicit attach/reset/enumeration path in the host stack. This may
   require a library patch. Avoid repeated uncontrolled reset/enumeration loops.
6. Read device/configuration/interface/endpoint descriptors. Log the observed
   identity, negotiated speed, endpoint addresses and packet sizes, and errors.
7. If the descriptors identify a supported CH552 bootloader, send identification
   and configuration-read requests only. Record chip type, bootloader version,
   chip ID, raw configuration, and complete responses.
8. Unplug and reconnect the pad normally to confirm the factory application still
   runs. Repeat the entry sequence at least ten times and retain failure logs.

Check both known WCH bootloader VID/PID pairs, `4348:55E0` and `1A86:55E0`, as
identification candidates. A VID/PID match alone does not authorize programming;
validate descriptors and CH552 protocol identity. The existing browser adapter
currently filters only `4348:55E0`, so accepting the second identity needs an
explicit, tested decision.

First milestone: repeatedly identify the CH552 bootloader through the stock board
and cable, without writing configuration, erasing, programming, or verifying an
arbitrary image. A successful serial command, disconnect, or D+ reading alone
does not demonstrate bootloader entry.

## Phase 2: native host-computer uploader

Prefer a Node.js CLI initially because this repository already has JavaScript
image parsing and upload logic. Use a maintained serial transport library with
macOS support. Python is also viable, but would require porting more protocol
logic. A browser UI can be considered later; it is not necessary for the prototype.

Begin with commands for adapter information, arming/probing, target identification,
and exporting a log. Add upload only after Phase 1 succeeds. Keep target USB
transactions on the RP2350, while the CLI initially handles image parsing,
bootloader packet construction, response validation, and progress.

Define a versioned serial protocol before implementing uploads:

- Framed binary messages with lengths, request IDs, operation codes, and bounded
  payloads; handle partial reads and coalesced serial writes.
- Separate diagnostic logs from binary responses, either by framed log messages
  or a distinct interface. Never mix unframed text into binary replies.
- Operations for adapter capabilities, probe/session start, target information,
  bulk OUT, bulk IN, and session teardown. Define timeouts, byte counts, USB
  errors, disconnect behavior, and cancellation semantics.
- Tie transactions to a target session. Reject stale requests after a failed
  transfer, re-enumeration, or manual unplug; the fixed pull-up makes physical
  disconnect detection especially important to investigate.
- Initially restrict the identification build to read-only bootloader commands.
  Enable destructive commands only in the later upload implementation.

Do not assume the existing browser class can simply accept a serial port.
`webUploader/src/bootloader.mjs` includes WebUSB device lifecycle and transfer
wrappers. Extract or adapt the shared protocol behavior behind a transport
interface, preserving direct WebUSB behavior and its checks.

Relevant repository references:

- `webUploader/src/hex.mjs`: validates Intel HEX records, rejects overlaps and
  out-of-range data, requires application data at address zero, and pads to
  eight-byte alignment.
- `webUploader/src/bootloader.mjs`: CH552 identity checks, response validation,
  configuration readback, transfer bounds, and error handling.
- `webUploader/upstream/bootloaderWebtool/ch55xbl.js`: upstream protocol reference;
  do not copy it without the repository's patches and validation behavior.
- `webUploader/tests/uploader.test.mjs`: existing upload behavior and fixtures.
- `pio-platform/build_firmware.py`: existing native upload invocation and firmware
  build integration.

The import of `upstream-patched.mjs` in the browser adapter refers to a generated
module. Establish its generation path when extracting shared logic; it is not a
checked-in source file available for a simple direct import.

For flashing, validate the complete image before any erase. Application code must
remain below `0x3800` (14,336 bytes), and eight-byte padding must stay within that
limit. Distinguish application image bounds from the bootloader's explicit
configuration command; do not treat configuration space as ordinary image data.
Check the actual three-key/six-key image selection separately from chip identity.

Preserve existing protocol safeguards: configuration write/readback before erase
when required by the upload sequence; chip-ID-derived XOR handling; the distinct
key-checksum response; strict erase/program/verify status checks; and explicit
failure reporting. Review the provisionally accepted configuration response
`0x40` and require the existing readback check rather than broadly relaxing errors.
Do not infer that upload preserves factory firmware or saved configuration without
checking the actual erase behavior. Report completion only after successful
verification; an interrupted upload needs a new entry/probe session, not a blind
replay of destructive requests.

## Phase 3: standalone programmer

Once the transport and entry sequence work, move the same validated CH552 protocol
implementation onto the RP2350. Embed an explicitly selected application image in
the programmer UF2 initially; a later version could accept and persist an image
over USB before operating without a computer.

Workflow: power the RP2350 from a suitable USB supply, wait for readiness, then
insert the macropad. Identify it, validate the stored image and target selection,
program, verify, and run the application. Use the onboard RGB LED for distinct
ready/busy/success/failure indications and retain detailed logs for later retrieval.
Define an explicit arming policy to avoid flashing every device plugged in merely
because it resembles a CH552.

Store the complete image with length, target variant, format/version metadata, and
an integrity checksum before erase. An integrity checksum is not authentication.
Handle partial staging and power loss without treating an incomplete image as
usable. Keep computer-controlled and standalone paths aligned through shared
fixtures and documented command semantics.

The native USB-C port remains available for power, RP2350 firmware installation,
diagnostics, or image staging. Standalone operation does not require forwarding
USB descriptors or impersonating the WCH bootloader to a computer.

## Validation and unresolved questions

### Second hardware capture: serial connection lost

`logs/probe-20261007T204546-443112Z.jsonl` reports firmware 0.1.1, idle status,
and acknowledgement of a 5000ms insertion window. The Mac then returned
`[Errno 6] Device not configured`; no `host_start`, descriptor, or identification
event reached the capture. The operator observed the pad's normal application
starting immediately.

This is a computer-to-adapter connection failure, not the earlier
`short_configuration_descriptor` result. The descriptor-length change executes
only after enumeration; the idle/arming GPIO behavior is unchanged. The capture
does not establish whether the adapter reset, lost power/USB connectivity, or
failed during host startup: `host_start` is queued before initialization and may
be lost if initialization crashes before the queue is flushed.

Next isolate the failure with an empty-port capture after resetting the adapter,
then a separate fresh-reset capture with manual pad insertion. Record whether
serial loss happens on insertion or at the end of the countdown, and whether the
RP2350 serial port reappears. An empty-port trial may fail enumeration because of
R13; its purpose here is to check whether the computer-facing connection survives
host startup. Neither trial should be interpreted as a firmware-writing test.

Follow-up control: `logs/probe-20261007T204721-621045Z.jsonl`, firmware 0.1.1,
kept the serial connection through `host_start` and the expected enumeration
timeout with USB-A empty. Two additional insertion trials lost the Mac serial
connection immediately on pad insertion, according to the operator. This moves
the leading investigation to insertion-related power/connectivity/reset behavior,
rather than descriptor handling. A supply dip is a hypothesis, not a measured
result; adapter reset has not yet been confirmed. The published schematic connects
USB-A VBUS to VSYS, shared with the board's regulator input.

Next try a different USB-C data cable and a direct Mac connection if a hub/dock
was used, keeping the board steady and clear of its buttons during insertion.
If needed, compare a powered hub on the computer-facing USB-C side; keep the pad
directly connected to the Waveshare USB-A port so the boot-entry experiment is
unchanged. Record whether the serial port disappears and reappears after insertion.
No GPIO/software power switch exists in the stock schematic to isolate this load.

The operator subsequently confirmed that `/dev/cu.usbmodem1101` reappears
automatically after insertion-related failure. A different USB-C cable connected
directly to the Mac made no difference. A cable/hub-specific explanation is less
likely; a chip reset versus a USB-only reconnection remains unresolved. The first
capture still demonstrates one successful bootloader enumeration, not repeatability.

Firmware 0.1.2 snapshots `POWMAN_CHIP_RESET` and watchdog reset evidence at
application startup and includes these, decoded power-on/brownout/RUN flags, and
a random per-boot identifier in status. This reads the SDK-defined hardware
register without modifying reset or power configuration. The host tool's new
`--status` path validates adapter identity and captures status without arming,
including on a used/failed adapter. Compare its boot identifier and uptime with
the original capture immediately after automatic reconnection, before manually
resetting anything. An unchanged identifier points toward USB-only reconnection;
a changed identifier indicates the application restarted. Reset flags can help
classify the cause but are not voltage measurements. See [usage.md](usage.md).

The 0.1.2 UF2 built successfully; file-only picotool inspection confirmed version
and RP2350 ARM Secure metadata. Five Python test methods passed, including new
PTY checks that status-only capture never arms a used adapter and still rejects
an unexpected adapter. The RP2350 stack reservation remains 4KiB; CH552 firmware
is unchanged. No connected hardware was accessed during these changes.
UF2 SHA-256:
`b2a0b3cf10e8e0147b58b9a29728576f084c5f2d753feec9a3a729aef4784265`.

The first 0.1.2 attempt (`probe-20261007T205210-386973Z.jsonl`) reported
pre-insertion boot ID `6fa3617b`, uptime 16334ms, and `reset_raw=262144`
(`reset_run_pin=true`). Those flags describe the reset before this insertion;
they do not identify the cause of the subsequent serial loss. The follow-up
status attempt (`probe-20261007T205216-316886Z.jsonl`) encountered the fragment
`on":"unexpected_usb_identity"}` rather than a complete JSON line and stopped
before capturing the new status. This leaves the reset-versus-reconnection
question unanswered.

The Python reader now permits one malformed initial JSON line to handle opening
CDC mid-log. Once a complete valid frame arrives it records the discarded bytes
as a separate host diagnostic; later malformed JSON still fails. The same original
receive deadline and identity checks apply. This is a Python-only correction;
the 0.1.2 UF2 need not be replaced. Retry `--status` before manually resetting
the adapter if the original session is still available; otherwise repeat the
probe/status pair to obtain comparable boot IDs.

### Confirmed insertion-related brownout

The next paired 0.1.2 captures resolve the reset question:

- `logs/probe-20261007T205423-132055Z.jsonl`: before insertion, boot ID
  `60a0337b`, uptime 6053ms, `reset_raw=262144` (RUN-pin reset).
- `logs/probe-20261007T205431-039386Z.jsonl`: after insertion and automatic
  reconnection, boot ID `9bcd1ab5`, uptime 4774ms, `reset_raw=131072`,
  `reset_brownout=true`, other decoded reset flags false, and idle host state.

The RP2350 application restarted with a hardware-reported brownout. The armed
countdown was lost. This is stronger evidence than a serial disconnect alone;
the exact rail waveform and source of the dip remain unmeasured. Pad startup
inrush through the shared VSYS supply is a candidate explanation, not yet proven.
Loss of the board's 3.3V-derived R13 pull-up could also explain failed bootloader
entry. The earlier successful capture establishes occasional operation, not
sufficient transient power margin for repeatable insertion.

The next zero-modification experiment is an externally powered USB hub on the
computer-facing side: Mac to powered hub to RP2350 USB-C, with the pad still
directly attached to RP2350 USB-A. This tests a different supply path while keeping
CDC capture and the target-facing pull-up topology. It is not a guaranteed remedy.
A hub between RP2350 USB-A and the pad would change the boot-entry topology and
is not an equivalent test. Software cannot add capacitance or control target power
on this stock board; changing descriptor reads or countdown timing does not address
the observed insertion-time reset. No new UF2 is needed for this power-path trial.

### Software brownout and USB power options

The [RP2350 datasheet](https://pip-assets.raspberrypi.com/categories/1214-rp2350/documents/RP-008373-DS-2-rp2350-datasheet.pdf?disposition=inline),
sections 7.6.2 and the POWMAN BOD register, confirms software-adjustable brownout
detection via `BOD.VSEL` and disabling via `BOD.EN`. It monitors the approximately
1.1V digital core supply DVDD, not USB VBUS or the board's 3.3V rail directly.
Reset threshold is nominally 0.946V; selectable values include 0.903V and 0.860V.
Read the actual register before experimenting rather than assuming reset defaults
persist through boot. Lowering the threshold does not guarantee correct operation
at the configured clock or preserve flash/USB operation during a supply dip.

A possible next read-only experiment is logging the current threshold and testing
one lower setting with detection still enabled. Disabling detection is a separate
diagnostic option, not an established remedy. Neither is implemented in 0.1.2.
No bootloader flash writes should be added based solely on surviving insertion
with a lower detection threshold; power stability remains unvalidated.

The CDC configuration in `firmware/usb_descriptors.c` already declares 500mA in
`TUD_CONFIG_DESCRIPTOR`. The Mac's reported 2.5W allocation matches that declaration;
it is not a measurement of the load or proof that a 500mA current limit tripped.
500mA is the ordinary configured USB 2.0 bus-power limit
([USB-IF policy](https://compliance.usb.org/index.asp?Format=Standard&UpdateFile=Policies)).
Increasing a descriptor value is not USB-C current detection or USB PD negotiation.
The stock schematic has fixed CC termination resistors rather than a programmable
power-negotiation controller. A higher current allowance would not by itself
establish sufficient transient voltage margin at the RP2350 core.

Firmware 0.1.3 implements the requested readback only. Each status request reads
`POWMAN_BOD` and reports `bod_raw`, `bod_enabled`, `bod_vsel`, and
`bod_threshold_mv` (nominal DVDD threshold, not a voltage measurement). Reserved
VSEL encodings produce `null` instead of an invented threshold. No register is
written and no threshold/enable setting is changed. Install the new UF2 with the
pad unplugged and run `python3 host/probe.py --port /dev/cu.usbmodem1101 --status`
to obtain the actual setting without starting a probe.

The build succeeded and file-only picotool inspection confirmed version 0.1.3
and RP2350 ARM Secure metadata. The Python tool needs no changes for these added
JSON fields. No connected hardware was accessed. UF2 SHA-256:
`291a67ebba25ebf6132c452ccbf8dee04b023509675bc477973dde35d068ce83`.

The operator's 0.1.3 readback in
`logs/probe-20261007T210035-911064Z.jsonl` confirms the current baseline:
`bod_raw=177` (`0xB1`), `bod_enabled=true`, `bod_vsel=11`, and
`bod_threshold_mv=946`. Boot ID was `bc0f291b`; host initialization had not
started. The threshold has not been changed. The next lower documented encoding
is VSEL 10, nominally 0.903V; a trial at that setting should retain detection
and compare both insertion/probe results and post-failure reset diagnostics.

The operator authorized testing VSEL 10 after confirming the baseline. Firmware
0.1.4 now writes `POWMAN_BOD` at application startup with the required POWMAN
password, VSEL 10 (nominal 0.903V), and EN set. It waits 50us for the setting to
settle before continuing initialization. Detection remains enabled; no OTP,
regulator voltage, USB power declaration, or CH552 firmware is changed. The
existing status path reads the actual register so the operator can verify the
write before insertion. Confirm `bod_raw=161` (`0xA1`), `bod_enabled=true`,
`bod_vsel=10`, and `bod_threshold_mv=903` on the board.

The build passed and file-only picotool inspection confirmed 0.1.4/RP2350 ARM
Secure metadata. Hardware register behavior and insertion survival still need
the operator's trial; no connected device was accessed during implementation.
The CH552 stack allocation is unchanged. The 0.1.4 UF2 SHA-256 is
`c66a7a94f4089a757cb201927141d52a5c29a313b3c36a8b462d89b2b9335fbf`.
The previous UF2 was preserved as `build-arm/ch552_probe-0.1.3.uf2` and its hash
still matches the recorded 0.1.3 hash, providing a readback-only rollback image.

### First 0.903V insertion trial: application enumerated

`logs/probe-20261007T210423-114932Z.jsonl` verifies firmware 0.1.4 with
`bod_raw=161`, VSEL 10, threshold 903mV, and detection enabled. The insertion
attempt retained CDC, completed the armed countdown, started the host at 29154ms,
and mounted a full-speed device at 29679ms. Its decimal VID/PID 4617/50525 decode
to `1209:C55D`, matching the normal application descriptors in
`src/userUsbHidKeyboardMouse/USBconstant.c`. The probe correctly stopped with
`unexpected_usb_identity`, without sending A1/A7 to the application.

This attempt avoided the earlier insertion-time adapter reset, but did not enter
the bootloader. The operator observed immediate application startup. One trial
does not establish repeatable power stability. A smaller supply transient could
still disturb the 3.3V-derived D+ entry signal without resetting the RP2350 at the
lower threshold; this remains a hypothesis. The trace does not measure that signal.

Keep the threshold at 0.903V for the next comparison. Try a shorter insertion
window (for example 1000ms, inserting promptly after arming) to check whether
the five-second wait contributes to losing bootloader availability. If the pad
again starts its application immediately, a wait-related bootloader timeout is
less persuasive than a failure of the power-on entry condition. Neither outcome
justifies lowering the detector further without new evidence.

The 1000ms comparison in `logs/probe-20261007T210815-150827Z.jsonl` verified
0.1.4, enabled detection at 903mV, boot ID `0458b79d`, uptime 5386ms, and arming
at 5387ms. The Mac then returned `Device not configured` before a host-start
event was captured. A post-reconnection status is needed to classify this new
loss; the pre-insertion RUN reset flag cannot do so. The lower threshold has
not established repeatable insertion survival. The shorter window trial did
not reach an enumeration result and therefore cannot settle bootloader timeout.
Prioritize the powered computer-side hub comparison over further threshold
reductions; retain the direct RP2350-to-pad connection and the current firmware
for that comparison.

The post-failure capture `logs/probe-20261007T210838-809981Z.jsonl` confirms
that the 1000ms trial reset the RP2350 through brownout: boot ID changed from
`0458b79d` to `b509d100`, `reset_raw=131072`, `reset_brownout=true`, and
the host returned to idle. Readback remained enabled at 903mV after startup
reapplied the experimental setting.

The operator explicitly requested one more threshold step before a powered-hub
trial. Firmware 0.1.5 sets VSEL 9, nominal 0.860V, at application startup using
the same password-protected write and settling delay. Detection remains enabled.
Verify `bod_raw=145` (`0x91`), `bod_vsel=9`, `bod_threshold_mv=860`, and
`bod_enabled=true` before the next insertion test. This is an experiment in
insertion survival, not a validation of power reliability for programming.
The previous 0.903V UF2 is preserved as `build-arm/ch552_probe-0.1.4.uf2`.
The CH552 firmware and stack allocation are unchanged.

The 0.1.5 build passed and file-only picotool inspection confirmed version and
RP2350 ARM Secure metadata. No connected device was accessed. Its UF2 SHA-256 is
`4b88409ee56f7ba6f72c732b84117e3d719c9247bdb2561065fddf844117c604`.
The preserved 0.1.4 UF2 still matches its previously recorded hash.

### Computer-side hub trial at 0.903V

The operator tried the hub before installing 0.1.5, retaining firmware 0.1.4.
The former `/dev/cu.usbmodem1101` path did not exist after changing topology;
`probe-20261007T211124-473337Z.jsonl` is therefore not an insertion test. The
adapter was reached at `/dev/cu.usbmodem11401` in
`logs/probe-20261007T211146-353973Z.jsonl`. It reported enabled detection at
903mV, boot ID `9f5fd1f9`, and power-on reset history. The 2500ms countdown
completed, then `1209:C55D` (normal application) mounted roughly 525ms after
host start and was correctly rejected before any A1/A7 requests.

Follow-up `logs/probe-20261007T211208-821506Z.jsonl` retained the same boot ID,
advancing uptime, `host_started=true`, failed state, and no brownout reset flag.
This confirms no application restart during this hub insertion trial. It does
not establish absence of shorter supply disturbances or success with the stock
0.946V threshold. The operator has described this as a hub trial; retain hub
model and external-power details when available.

Treat adapter reset and CH552 bootloader entry as separate observed problems.
Keep the working hub topology and 0.1.4 constant for a timing comparison rather
than installing 0.1.5 simultaneously. Try inserting promptly during a 1000ms
window, ensuring the pad was fully unplugged first and the adapter reset while
USB-A was empty. Record whether normal application LEDs appear before host start.
If the application starts before any host activity, changing subsequent descriptor
reads cannot restore a missed power-on entry condition. The original 0.1.0
bootloader enumeration remains evidence of one successful entry, not a guarantee
that the stock pull-up produces that condition on every insertion.

The 1000ms hub comparison (`logs/probe-20261007T211348-387388Z.jsonl`) again
mounted `1209:C55D`, with host start at 5295ms and mount at 5820ms. The operator
explicitly observed the configured LEDs turning on immediately, before host
start. That establishes application execution before PIO USB initialization in
this trial; the subsequent descriptor requests/countdown cannot explain initial
application entry. The CH552 power-on entry condition remains the investigation.

Firmware 0.1.6 adds passive digital GPIO snapshots (`dp_level`, `dm_level`) to
status, arming, and the host-start event before PIO initialization. It sets the
threshold back to 0.903V to match the operator's hub trials on 0.1.4; the 0.860V
0.1.5 UF2 was built but has not been reported tested. That image is preserved as
`build-arm/ch552_probe-0.1.5.uf2`. No new pulls or pin-driving behavior is added.
First inspect status with the target unplugged: stock R13 should hold D+ high.
A low reading challenges the assumed board/pull-up behavior. A high reading
does not prove the CH552 sees a sufficient voltage at its boot-sampling instant.
The samples cannot capture brief glitches; D− may float before host initialization.
Keep the hub topology constant for this check. No connected device was accessed
during implementation; CH552 firmware and its stack allocation are unchanged.

The 0.1.6 build passed and file-only picotool inspection confirmed its version
and RP2350 ARM Secure metadata. UF2 SHA-256:
`a8bfa5602282c3dff9fe32ae1ff6c3c2089f16cf127006dc8fd9c3696b7a4e6f`.

### Empty-port D+ baseline confirmed

`logs/probe-20261007T211640-902942Z.jsonl` reports 0.1.6, idle/no host start,
903mV enabled detection, `dp_level=1`, and `dm_level=0`, with the pad unplugged.
The intended host-side idle D+ high is present; this does not prove its analogue
voltage at the target during power-on. Further changes to host enumeration timing
should not substitute for establishing the power-on entry signal.

Check which cable connector is being inserted. A distinct unresolved hypothesis
is that target power arrives before the cable's D+ contact is established, so
the chip can reach its entry check without the external pull-up. That would be
compatible with occasional successful entry, but has not been measured. If the
cable is detachable, comparing insertion at the pad end with insertion at USB-A
is a zero-modification test of contact/ramp timing, not a guaranteed fix. Keep
the RP2350 powered through the hub, with host stopped during the insertion window.

For a controlled test of that hypothesis, power would need to be switched while
data conductors remain connected. The stock RP2350 board cannot independently
switch USB-A VBUS. A commercial inline adapter that switches only VBUS while
passing D+/D− continuously could preserve zero soldering; an adapter that also
switches data or an intervening USB hub is not equivalent. No specific adapter
has been selected or verified. Pre-powering D+ also raises possible back-powering
effects, so simply leaving data connected is not proof of a true CH552 power-on
reset. Do not drive D+ push-pull high as a substitute for the existing resistor.

The [CH552 manufacturer datasheet](https://cdn-learn.adafruit.com/assets/assets/000/129/847/original/CH552DS1.PDF?1715004485=)
identifies P3.6/P3.7 as V33-powered pins and disallows 5V there. Its 5V-operation
table specifies a 2.4V input-high minimum. The nominal 3.3V pull-up is therefore
not inherently the wrong voltage; a host digital high remains insufficient to
measure target voltage or boot sampling. The exact factory entry-check timing
has not been established.

### USB-A versus USB-C insertion comparison

The operator had predominantly inserted the pad-side USB-C connector. Inserting
USB-A instead produced the same immediate configured LEDs before host startup.
`logs/probe-20261007T212131-865678Z.jsonl` shows firmware 0.1.6 at 903mV,
boot ID `e5d4aa3f`, D+ high/D− low in idle status, arming, and pre-host-start
snapshots. The 2500ms countdown completed and `1209:C55D` mounted roughly
525ms after host startup. There was no captured adapter reset during the trial.
The software correctly refused application identification commands.

Connector-end substitution did not improve entry. These snapshots do not measure
D+ during initial target power rise, and D+ high after application startup is
also consistent with the application's normal USB attachment pull-up. They do
not prove that the external pull-up met the factory bootloader's entry condition.
Avoid inferring a specific contact race or supply waveform from this result.

Further countdown/descriptor changes have no demonstrated connection to the
pre-host application startup. The next discriminating evidence would be a trace
of target-side D+ against target VBUS/power rise, or a controlled VBUS-only power
cycle with data already connected and verification that the target actually
loses power despite D+ back-powering. An oscilloscope measurement would be a
diagnostic aid, not part of the intended zero-modification product workflow.
Firmware digital sampling alone can expose some D+ transients but cannot measure
voltage margin or establish the target power-on instant on this stock wiring.
The first successful bootloader enumeration remains valid; repeatable entry
through this unmodified board/cable arrangement has not been demonstrated.

### Proposed direct GPIO-high entry experiment

The operator suggested driving GPIO12 high before target startup and releasing
it to PIO for enumeration. On this board a GPIO high is referenced to its 3.3V
I/O supply. Compared with R13 this changes source impedance/drive strength, not
nominal voltage. It could distinguish inadequate pull-up strength from other
causes, but is not a demonstrated remedy. It cannot establish a D+ connection
before physical contact or maintain 3.3V if the shared source supply collapses.

Direct push-pull drive differs electrically from a resistor pull-up. A CH552
USB transmitter driving D+ low would contend with GPIO-high drive, including
before our host starts; the host-start countdown is not a guarantee that the
target remains an input. The CH552 datasheet also limits P3.6/P3.7 to V33+0.4V
at the absolute maximum, making powered GPIO drive into an unpowered target
a back-powering/overvoltage concern. RP2350's 2/4/8/12mA drive-strength settings
are output characteristics, not hard fault-current limits. Limiting drive to a
brief interval and releasing before PIO initialization is necessary for USB,
but does not independently establish electrical safety during target startup.

This option has been discussed, not implemented. Assess current limiting and
the actual target-power/drive-release sequence before adopting it as a stock-board
workflow. The existing passive input/R13 implementation remains the current build.

### Reconstructed early builds for a comparison trial

The operator requested retrying the early successful build. The recorded success
was on 0.1.0, not 0.1.1; 0.1.1 introduced the descriptor-length correction after
that capture. Searches of this experiment's generated files, accessible temporary
files, and Downloads found only saved 0.1.3-and-later UF2s. One unrelated restricted
temporary directory could not be searched. No original 0.1.0/0.1.1 UF2 was found.

Separate reconstructed sources/builds were created without modifying the current
0.1.6 sources or UF2. The reconstructions remove reset/GPIO diagnostics, random
boot IDs, and the brownout override, restoring the original startup GPIO/clock
path. Version strings explicitly say `0.1.0-reconstructed` and
`0.1.1-reconstructed`. The former restores the documented 512-byte configuration
request and single configuration state; the latter retains the corrected
header/exact-length request. Current portable parsing validation is retained,
including the configuration-length helper, so these are not claims of exact
historical source or byte-for-byte binary recovery. Differences after enumeration
do not establish equivalence of every later code path. Both still restrict target
application requests to validated A1/A7 identification/information reads.

Provenance diffs against the current 0.1.6 source are saved in
`experiments/0.1.0-reconstructed.patch` and
`experiments/0.1.1-reconstructed.patch`. Isolated source snapshots and generated
UF2s reside under the ignored `build-reconstructed-0.1.0/` and
`build-reconstructed-0.1.1/` directories, with UF2s at `output/ch552_probe.uf2`.
They use the existing pinned SDK, PIO USB, and complete Arm toolchain. Both builds
passed without compiler warnings; file-only picotool inspection confirmed the
reconstruction version labels and RP2350 ARM Secure metadata. No hardware was
accessed or flashed during reconstruction. The current Python capture tool is
compatible; use the original 5000ms insertion window for a comparison and record
the actual power/cable topology. An original-style descriptor failure after WCH
enumeration is distinct from failing to enter the bootloader.

UF2 SHA-256 values:

- 0.1.0-reconstructed:
  `a4a5311be78f973627718f5932bc15ccac01d82ec4258f58774dc931f91df343`.
- 0.1.1-reconstructed:
  `8b33b2709bb8335c0105150a94974940a99be0c6cf8968d6969153e520d64983`.

### Bootloader entry reproduced with 0.1.0 reconstruction

`logs/probe-20261007T213759-121879Z.jsonl`, version
`0.1.0-reconstructed`, repeats the first trial's WCH enumeration and descriptor
failure. With a 2500ms insertion window, host start was at 13182ms, WCH interface
open at 13705ms, and mount at 13706ms. VID/PID `4348:55E0`, interface 0,
bulk IN `0x82`, bulk OUT `0x02`, and 64-byte endpoint packets were recorded.
The 18-byte device descriptor again was `12011001ff8055084843e055500200000001`.
The subsequent 512-byte configuration request completed successfully with zero
data bytes, producing `short_configuration_descriptor`. No A1/A7 requests were
sent. The operator observed the configured LEDs staying off for several seconds
after insertion, then coming on; the USB trace confirms bootloader presence at
enumeration but does not establish the cause or timing of any later application
transition.

This is a second confirmed bootloader enumeration, now with reconstructed early
behavior. It makes comparing early and later startup behavior worthwhile, but
does not prove the brownout override or diagnostic code caused the entry failures:
trial timing, supply transients, and other uncontrolled factors remain possible.
The descriptor-read correction executes after bootloader enumeration, so it cannot
explain whether the chip initially entered the bootloader in that same session.

Next use the already-built `0.1.1-reconstructed` UF2, retaining the same cable,
hub, insertion end, and 2500ms window. Its application startup/status path matches
the 0.1.0 reconstruction; the main-source diff adds only the configuration-header
state, length tracking, and corrected descriptor-read sequence. Version metadata
also differs. This keeps later reset/GPIO diagnostics and brownout writes out of
the comparison. If entry repeats, inspect the header/exact-length responses and
any A1/A7 results. A full identification success remains unproven.

### Immediate repeat on unchanged reconstruction missed entry

The operator deliberately retained `0.1.0-reconstructed`, unplugged the pad,
pressed the RP2350 board's reset button with USB-A empty, then repeated the
2500ms capture. `logs/probe-20261007T213951-115854Z.jsonl` reports idle preflight
at 2629ms, arming at 2630ms, host start at 5130ms, and a mount of application
`1209:C55D` at 5655ms followed by `unexpected_usb_identity`. The USB connection
survived through enumeration. No firmware change occurred between the confirmed
bootloader entry and this application enumeration.

This control demonstrates variable entry on the same reconstructed build and
weakens attribution to later descriptor/diagnostic/brownout code. The prior
successful run started its capture at 10681ms of RP2350 uptime, versus 2629ms
here, but those are times of capture start, not measured target insertion times.
The duration of target disconnection, residual/back-fed target power, contact
timing, supply transients, and cold-power-on versus board-reset conditions remain
uncontrolled. Do not infer a required adapter warm-up interval from this pair.

Before more firmware changes, a useful repeatability control is to disconnect
both adapter power and the pad, leave them disconnected for about 10 seconds,
power the RP2350 through the same hub with USB-A empty, wait about 10 seconds,
then repeat the same 2500ms manual insertion trial. Repeat the complete sequence
if comparing results. This standardizes a cold start and removes the board-reset
versus fresh-install distinction without modifying hardware; it does not guarantee
capacitor discharge, eliminate D+ back-powering during insertion, or prove a
specific failure mechanism. Keep the reconstruction and cable/insertion end
constant while collecting these results.

The operator followed the proposed full-disconnect/10-second cold-start sequence
on unchanged `0.1.0-reconstructed` and still reported `unexpected_usb_identity`.
No new log filename or raw trace was supplied for this repeat. A full power cycle
therefore did not restore bootloader entry in this attempt; it does not identify
the electrical cause. Countdown, connector-end, warm-reset/cold-start, and build
comparisons have not produced repeatable entry. Prioritize observing target D+
against power rise or independently sequencing VBUS/data over additional blind
changes to the host descriptor path. Any diagnostic instrument or external inline
adapter is separate from modifying/soldering the pad or Waveshare board.

### USB-C contact sequencing

The USB Type-C specification's receptacle mating table places GND and VBUS before
signal contacts, including USB 2.0 D+/D−. An alternative permitted geometry places
GND first, VBUS second, and signals third. Thus changing from USB-A insertion to
USB-C insertion does not guarantee that D+ is established before target power.
See the [USB Type-C specification](https://www.usb.org/sites/default/files/USB%20Type-C%20Spec%20R2.0%20-%20August%202019.pdf),
Table 3-4 and its alternate-contact-geometry note (release 2.0).

With an already-powered legacy USB-A source feeding an A-to-C cable, VBUS is
already present on the cable. Mechanical mating sequence can therefore matter
directly to when the target starts versus when external D+ reaches it. Fully
Type-C source attachment/power control is a separate mechanism and must not be
assumed for the Waveshare's always-powered USB-A output. Contact sequencing is
a plausible explanation to measure, not a diagnosis established by existing logs.

### Fast insertion on 0.1.1 reconstruction: enumeration timeout

The operator deliberately inserted the cable very quickly while running
`0.1.1-reconstructed`, with a 2500ms window, and observed the configured LEDs
remaining off for several seconds. `logs/probe-20261007T215750-569511Z.jsonl`
reports arming at 22962ms, host start at 25462ms, then enumeration timeout at
35462ms. No interface, mount, or descriptor-transfer event was captured, and
CDC remained available to report the firmware timeout. This is not a timeout
in the Python status handshake or the corrected configuration read.

The LED observation is compatible with transient bootloader operation but does
not establish it; delayed application startup or a power disturbance are also
possible. With no mounted identity, this trace cannot distinguish failure to
detect/complete USB enumeration from a target state transition during that process.
The descriptor correction was never reached. Do not attribute this outcome to
that correction or assume that rapid insertion has established reliable entry.

A useful timing comparison on this unchanged reconstruction is a 1000ms insertion
window with prompt insertion, retaining the same hub, cable, and insertion end.
If LEDs again stay off initially, record when they appear relative to `host_start`
and any interface/mount/transfer events. This tests earlier host startup after a
possibly successful entry; it is distinct from earlier short-window trials where
the application LEDs appeared immediately. A negative result would still leave
the electrical entry condition and PIO enumeration as separate open questions.

### First CH552 A1 identification exchange and parser correction

The operator reports roughly twelve 1000ms trials on the later/latest build with
immediate configured LEDs and no bootloader entry, followed by reinstalling
`0.1.1-reconstructed` and inserting rapidly. Exact version/logs for the dozen
negative trials were not supplied in that report; keep this as an observed build
association rather than proof of a particular startup regression.

`logs/probe-20261007T220128-002140Z.jsonl` establishes progress beyond all prior
captures: WCH `4348:55E0` mounted, the device descriptor returned 18 bytes,
configuration header `090220000101008032` returned 9 bytes, and the exact-length
configuration returned 32 bytes. The bulk A1 request completed with 21 bytes
written, followed by the six-byte response `A1 9F 02 00 52 11`. The existing
validator rejected it solely because it required header byte 1 to be zero.
The chip/family fields `52 11` and two-byte payload length were correct. No A7
request was sent because of that local rejection.

The local upstream `webUploader/upstream/bootloaderWebtool/ch55xbl.js` uses the
same wildcard A1 request and identifies the chip/family at response offsets 4/5,
without requiring byte 1 to be zero. Our existing uploader wrapper behaves
similarly for detection. The [wchisp protocol implementation](https://raw.githubusercontent.com/ch32-rs/wchisp/master/src/protocol.rs)
also parses reply length/payload without a universal zero-byte requirement.
The precise meaning of `9F` in this response has not been established; do not
describe it as a documented zero-equivalent success status for every command.

`probe_parse_detect` now accepts only the zero or observed `9F` header variant,
with exact six-byte framing, payload length 2, A1 command, chip `52`, and family
`11`. A7 validation remains separate and unchanged. Sanitized C parser tests
passed with the real response as a regression fixture and rejection cases for
truncation, extra bytes, unknown header variant, wrong command, wrong chip/family,
and malformed length. The same fix is applied to the current parser source.

For the next hardware trial, the separate build
`build-reconstructed-0.1.1-detectfix/output/ch552_probe.uf2` reports
`0.1.1-reconstructed-detectfix`. Its `main.c` is byte-for-byte identical to the
0.1.1 reconstruction, preserving early startup and avoiding later GPIO/reset
diagnostics and brownout writes. Only parser logic and version metadata differ;
`experiments/0.1.1-detectfix.patch` records those changes. Keep hub/cable/insertion
end and the 1000ms window constant for comparison. A1 identity is now evidenced;
A7 bootloader version/chip-ID reading and repeatable hardware entry are still
unvalidated. No connected device was accessed during implementation.

The parser-corrected early build passed; file-only picotool inspection confirmed
`0.1.1-reconstructed-detectfix` and RP2350 ARM Secure metadata. UF2 SHA-256:
`f9f5c7f1498f4d063910c57cefe660aa675bd98fb78bc248661d2ec2a68ca54e`.

### A1 header byte varies: replace the narrow whitelist

`logs/probe-20261007T220752-714885Z.jsonl` on
`0.1.1-reconstructed-detectfix` again reached WCH enumeration and all descriptor
reads, then returned `A1 9D 02 00 52 11`. The previous zero/9F whitelist rejected
it, despite matching command, length, and CH552 chip/family payload. Follow-up
`logs/probe-20261007T220758-193836Z.jsonl` showed the adapter still in failed
state with `host_started=true` and advancing uptime, rather than a new idle boot.
This is another parser failure after successful bootloader communication.

Whitelisting just one observed value was too narrow. Both local upstream uploader
read paths use the identification/version/ID payload without a universal zero
requirement for header byte 1, as does wchisp's generic reply parser. The byte's
precise meaning remains unknown here; do not assign it success-code semantics.
The parser now disregards byte 1 for A1 and A7 read replies while retaining command,
length, and payload validation. A1 requires exactly six bytes, declared payload
length 2, and `52 11`; A7 retains declared/received length checks and field-mask
validation. No erase/write/status reply handling is introduced or generalized.
Tests cover both real A1 fixtures and synthetic nonzero-header A7 framing cases,
alongside truncation, malformed lengths, wrong commands/chip/family, and the
unchanged read-only request allowlist. Address/undefined sanitizer checks passed.

The separate `build-reconstructed-0.1.1-replyfix/` experiment uses the unchanged
early 0.1.1 `main.c`, the corrected parser, and metadata label
`0.1.1-reconstructed-replyfix`. Its provenance diff is
`experiments/0.1.1-replyfix.patch`. The old detectfix image is preserved as a
superseded comparison, not the next suggested trial. No connected device was
accessed; target firmware and its stack allocation are unchanged. The next trial
keeps the same hub/cable/insertion sequence and 1000ms window, then inspects A7.

The replyfix build passed; file-only picotool inspection confirmed the version
label and RP2350 ARM Secure metadata. UF2 SHA-256:
`5b8aaa2e1c2f1ca7be9837c95f317062af53bd25df754fe022be75abfd10f569`.

### A1 accepted; A7 OUT completed but IN timed out

`logs/probe-20261007T221135-700722Z.jsonl`, on
`0.1.1-reconstructed-replyfix` with a 1000ms window, confirms WCH enumeration,
both configuration reads, and accepted A1 reply `A1 BD 02 00 52 11`. This is a
third observed second-header-byte value, reinforcing removal of that check.
The firmware then sent the same five-byte A7 request as the existing uploader:
`A7 02 00 1F 00`. Bulk OUT completed successfully at 4981ms. No bulk-IN callback
arrived before the 2000ms deadline, so `info_in` timed out at 6981ms. There is no
captured A7 payload to validate; this is not another reply-parser rejection.

Local comparison confirms the request bytes and OUT/IN order match
`webUploader/upstream/bootloaderWebtool/ch55xbl.js`. The uploader wrapper permits
10000ms per transfer, versus this probe's 2000ms; no evidence yet establishes
that merely waiting longer would solve this failure. TinyUSB releases endpoint
busy/claim state before invoking the completion callback; inspection did not
find a callback-lifetime error in the current asynchronous sequence.

The PIO host retries NAKs and DATA0/DATA1 mismatches without completing the app
transfer, so the existing timeout cannot distinguish those cases. The diagnostic
`build-reconstructed-0.1.1-bustrace/` experiment adds counters and a first-data-packet
snapshot for bulk IN 0x82 in an isolated copy of the pinned PIO-USB checkout.
Its version is `0.1.1-reconstructed-bustrace`. The early startup path, read-only
request bytes, timeout, ACK/PID decisions, and retry rules remain the same; the
added observation code can still perturb execution timing. It does not force
data toggles or resend application requests.

For each bulk-IN submission the counters reset. Completion or terminal failure
logs `bulk_in_trace` with polls, matched packets, mismatches, NAKs, stalls, errors,
and the first packet's received/expected PID and length. A corresponding
`bulk_in_first_packet` contains up to 64 payload bytes even if a toggle mismatch
prevented delivery to the application. IRQ code only updates bounded counters/
snapshot storage; logging runs in the application, with interrupt-protected
snapshot copies. Large application snapshot storage is static to preserve stack.
Provenance is in `experiments/0.1.1-bustrace.patch` and
`experiments/0.1.1-bustrace-pio.patch`. Upstream dependency checkouts and earlier
UF2s are preserved. The current parser fix is unchanged. No connected device was
accessed, and CH552 firmware/stack allocation is unchanged.

The bus-trace build passed; file-only picotool inspection confirmed its version
label and RP2350 ARM Secure metadata. UF2 SHA-256:
`f15c42e4312e591d96843b4ae30473ad2569e0d30a37028bb1d26093fd391e6f`.

### A7 IN returns only NAKs; paced follow-up

`logs/probe-20261007T221549-952708Z.jsonl` on
`0.1.1-reconstructed-bustrace` confirms WCH enumeration and A1 reply
`A1 BF 02 00 52 11`. The A1 read had one poll and one matching DATA0 packet
(PID 195), with no errors or mismatches. A7 OUT completed successfully at
8039ms. Its IN trace at 10039ms shows 1999 polls, all NAKs, zero data packets,
zero toggle mismatches, zero stalls, and zero receive errors. The bootloader
is responding on USB, but no A7 data was observed during that interval.
This rules out an observed IN data-toggle mismatch for this trial; it does
not establish why A7 was not answered or prove the OUT request was processed.

Source inspection confirms PIO-USB advances OUT transfers on an ACK and
maintains the endpoint data toggle across transfers. Request bytes and
application ordering match the local web uploader. Browser scheduling introduces
host-side delays that this immediate callback-driven sequence may not have;
a readiness/timing issue is a hypothesis, not a confirmed bootloader requirement.

The isolated `build-reconstructed-0.1.1-paced/` experiment changes only the
application sequencing and version relative to bustrace: after accepted A1,
enter `info_wait` for 20ms, servicing native USB and PIO host tasks throughout,
then send A7 once. It retains the same early startup, trace dependency,
2000ms transfer deadline, request bytes, parser, and USB retry/toggle behavior.
No blocking sleep, target write, request replay, or GPIO drive change is added.
Version: `0.1.1-reconstructed-paced`. Provenance relative to bustrace:
`experiments/0.1.1-paced.patch`; its dependency instrumentation is still
`experiments/0.1.1-bustrace-pio.patch`. Earlier UF2s remain available.
Keep the same hub/cable/insertion setup and 1000ms window for comparison.
RP2350 stack reservation remains 4KiB; CH552 firmware is untouched.

The paced build passed, and file-only picotool inspection confirmed its version
and RP2350 ARM Secure metadata. UF2 SHA-256:
`e5282ac94818b4f907842d45bed69b8322fa73d307f8663fe892a1bc1725c864`.
No connected hardware was accessed.

### First complete identification on the paced build

`logs/probe-20261007T222052-944174Z.jsonl` on
`0.1.1-reconstructed-paced`, with a 1000ms window, completed identification.
The user reports approximately six normal-application / unexpected-identity
failures before this successful bootloader entry. Entry remains intermittent.

A1 reply `A1 9D 02 00 52 11` arrived on its first IN poll. After the logged
20ms gap, A7 OUT completed at 6134ms and its 30-byte reply arrived at 6135ms,
also on the first poll. Both reads had zero NAKs, mismatches, stalls, and errors.
The A7 DATA1 PID (75) matched the expected toggle after A1 DATA0 (195).
Raw A7 reply:
`A7 9D 1A 00 1F 00 FF FF FF FF 23 00 00 00 FF 52 FF 7D 00 02 05 00 0F 28 3E BD 00 00 00 00`.
Parsed result: CH552, bootloader 2.5.0, chip ID `0f283ebd`, field mask 31.
The host script correctly printed its identification success result.

This is the first complete read-only protocol proof through the stock RP2350
adapter. The response after adding the gap supports a timing/readiness hypothesis,
but one success does not establish causation, a minimum required delay, or
repeatability. Keep this exact UF2 as the known successful reference. Repeat
successful entries on it before changing transport behavior or attempting writes.
The unresolved priority is reliable bootloader entry; this success does not
validate erase/program/verify, standalone flashing, or factory-app preservation
after reconnection (the latter still needs the user's observation).

The exact 30-byte A7 reply is now a parser regression fixture, checking version,
ID, field mask, and rejection of every truncated prefix. No firmware behavior
or generated UF2 changed for this result-recording step.
The parser tests passed with AddressSanitizer and UndefinedBehaviorSanitizer.

### Host-side reset flag for repeated trials

`host/probe.py --reset` now reboots the adapter before capturing a probe. The
user requested this to replace repeated presses of the small RP2350 reset button.
It validates the selected adapter's status before sending its existing `reset`
console command, requires CDC disconnection within 5s, then retries opening the
same explicitly selected serial path for up to 15s. It revalidates identity,
clean idle state, host-not-started, and zero dropped logs before arming. When
both statuses have a boot ID, the IDs must differ. Early reconstructed firmware
has no boot ID; observed disconnection plus fresh idle status supports that path.
Wrong adapters, ignored resets, stale state, and reconnect failures stop before
arming. The capture records pre/post status and a `reset_requested` host event.

Example: `python3 host/probe.py --port /dev/cu.usbmodem11401 --reset --delay-ms 1000`.
Keep the macropad unplugged until the usual insertion prompt: adapter reset does
not switch downstream VBUS. `--reset --status` resets and reads diagnostics without
starting a probe. For spontaneous-reset investigation, omit `--reset` so the
original reset cause remains available. No new firmware or UF2 is needed; the
existing paced build already implements the watchdog-backed reset command.

All 14 host tests passed, including existing PTY framing/capture cases and
simulated disconnect, temporarily missing serial path, successful reconnection,
early firmware without boot IDs, changed/unchanged boot IDs, status-only reset,
wrong identities, unclean post-reset state, ignored reset, and bounded failure
when the port does not return. No connected hardware was accessed; firmware,
stack reservations, and saved UF2s are unchanged. Usage instructions are updated.

### Intermittent wait after software reset

The user reported an apparent hang at the serial-reconnect message after several
successful software-reset trials. Captures `222802-179199Z` and `222821-602734Z`
end at `reset_requested`; `222816-336020Z` is empty. A subsequent `222852-486801Z`
capture completes identification on the paced firmware. These logs do not locate
a blocked syscall or establish whether the 15s retry deadline was exceeded.

The host now pauses 1000ms after observed CDC disconnect before reopening, skips
restoring terminal settings on disconnected or failed-open serial handles, and
reports each open attempt with remaining time and the transition to status reads.
It records `reconnect_open` and `reconnect_status` phase events in the JSONL log.
This avoids an unnecessary termios ioctl on a disconnected device and provides
evidence to distinguish a missing port, an open/configuration stall, and a
status timeout. This is mitigation and instrumentation; it is not a confirmed
root-cause fix. The retry loop retains its 15s deadline; OS-level open/ioctl/close
calls are not independently guarded by that Python loop deadline. If it stalls
again, the last printed phase and capture will identify where to investigate.
Receive checks its deadline even when complete frames are already buffered, so
queued unsolicited events cannot indefinitely bypass a status/probe deadline.
Firmware and generated UF2s remain unchanged; no hardware was accessed.
All 16 host tests passed, including disconnected-close and buffered-deadline
regressions alongside the reset/reconnect and PTY capture cases.

### Standalone three-key flashing requested and implemented

After accepting insertion reliability as adequate for this proof of concept,
the user explicitly authorized the full standalone write routine using the
existing three-key release. A computer can provide debugging but must not be
required. The user selected blinking blue until a press of **BOOT**, then solid
cyan for a 2000ms insertion window. Yellow indicates communication, red error,
and green success. The stock fixed pull-up hides reliable empty-port detection,
so the explicit button preserves the working delayed-host sequence without
introducing new hardware or autonomous write retries.

Implementation: `standalone/`, built independently from the retained read-only
`firmware/`. UF2: `build-standalone/ch552_programmer.uf2`, version
`0.2.0-standalone-3key`. No connected hardware was opened or flashed by the agent.
The write-capable image is intended for the user's manual RP2350 installation
and first hardware trial. Existing read-only and reconstructed UF2s are preserved.

Image input is the existing `releases/ch552-macropad-3-key-30101c94.hex`, with
14292 source bytes and configuration format 10. The generator validates records,
checksums, address bounds, overlaps, EOF, reset-vector data, and the three-key
GET_INFO signature. It fills gaps and the final 44 bytes with FF, making an exact
14336-byte application image. The build fails unless exactly one three-key HEX
exists, and generates its header/manifest only under the ignored build directory.
The runtime CRC is checked before readiness; packet construction independently
bounds addresses below 0x3800. Chip identity cannot determine physical key count,
so the operator must use the three-key pad.

Image provenance:

- HEX SHA-256: `12c00480382d6c82596bc10359793faccb2aa0f183eaee570a7ccf424c1be67c`.
- Full padded image SHA-256: `04fc94d0006805cdb90015148e058f7afbaa562832b0d23c94543fa79d008c69`.
- Full padded image CRC32: `79ac3c1b`.
- UF2 SHA-256: `99e864cda89e21ec15bd6f0ebf04228189fb9adcfa865d04e0d01c65b7ff8f5b`.

Sequence: exact-length USB descriptor reads, A1 CH552 detection, A7 identification
and configuration snapshot, A3 zero seed with UID-derived XOR-key checksum gate,
A4 erase of 14 application sectors, A5 full-image programming, A6 full-image
comparison, A7 configuration/UID readback, and A2 run-application OUT. The build
accepts only tested bootloader 2.5.0. Every application command after A1 waits
20ms while servicing USB, extending the successful A1/A7 pacing conservatively.
USB transfer deadlines are 2000ms, with 10000ms for erase and enumeration.
Write/compare chunks are 56 bytes, aligned to eight bytes, covering the entire
0x0000..0x37FF application area. No blind retries of application commands occur;
normal USB transport retries retain the library's rules.

Programming reply validation checks command, declared payload length, exact frame
length, and command-specific payload. The variable second header byte is not
interpreted as status. A3 validates the key checksum; A4/A5/A6 require zero
16-bit results. Every failure stops without reboot. Post-write A7 checks the
original 12 configuration bytes, UID, and bootloader version before running code.
Green is latched only after all comparison replies and configuration checks pass
and the A2 OUT transfer completes. It does not attest to application enumeration.

The requested literal code-flash readback is unavailable through this USB ISP
command set. A6 performs an on-device comparison against supplied code bytes;
Data Flash read commands address another memory space. This implementation uses
A6 for every application byte and explicitly logs `raw_code_readback: false`.
There is no downloaded flash image or host-side hash of target flash. This limit
was explained during implementation and in [standalone.md](standalone.md).
Reference: [wchisp command definitions](https://github.com/ch32-rs/wchisp/blob/master/src/protocol.rs).

Unlike the web uploader's initialization, this standalone flow does not issue
A8 or change boot options. It follows the direct identify/key/erase/write/compare
sequence supported by the
[CH55x Python flasher](https://github.com/hexeguitar/CH55x_python_flasher/blob/master/chflasher.py),
which also specifies 14 application erase sectors for CH552. Configuration words
are read before and after; Data Flash and bootloader address ranges are not
explicitly erased/programmed. Actual preservation behavior, power-loss recovery,
and first hardware write still need validation; do not infer a backup exists.

The LED uses WS2812 GRB on GPIO16 via PIO1 SM0 with no DMA. PIO USB remains on
PIO0 SM0/1/2 and DMA0. A 400us interval before each LED update permits the preceding
packet and reset/latch time, even for consecutive state changes. BOOT sampling
adapts Raspberry Pi's SRAM-resident QSPI-CS routine, with interrupts disabled
only during the short sample, and only while idle before PIO USB starts. Core1
and XIP DMA are unused. The default brownout setting and passive D+/D- startup
are retained; no GPIO-high experiment or power switching was added. Blue blinks
250ms on/250ms off; three button samples at 10ms intervals arm the cyan window.
One attempt runs per RP2350 boot. Unplug the target before adapter reset because
VBUS remains on. BOOT held during reset still enters the RP2350 ROM UF2 loader.

Native CDC is optional, protocol 2 with `read_only: false` and a separate debug
PID. `host/monitor.py` sends only status and captures standalone events with
explicit green/red outcomes; mere identification cannot report programming
success. It also interprets latched final status when opened after completion.
The old probe tool rejects the write-capable firmware. Console reset/bootsel
commands are rejected while armed or active. Per-KiB progress keeps normal offline
logs within the static 16KiB ring; logs are volatile. Status includes the last
error and image metadata. RP2350 stack remains 4KiB in its scratch bank; the map
confirms 0x20081000..0x20081FFF. CH552 source, stack, and release files are untouched.

Validation completed:

- Standalone RP2350 build passed with project `-Wall -Wextra -Werror`; file-only
  picotool confirmed its version and ARM Secure target metadata.
- All 23 Python tests passed: existing PTY/reset cases, image converter bounds/
  signature cases, and standalone monitor success/failure/identity behavior.
- Portable C programmer tests passed under AddressSanitizer/UndefinedBehaviorSanitizer.
  An independent flash model decodes the wire packets, checks contiguous full
  writes and comparisons, catches a deliberately corrupted flash byte, and
  verifies that identity/version/key/erase/write/compare/config failures prevent
  reboot. CRC and application-address bounds are covered.
- The generated image hash and format independently match the existing JavaScript
  uploader's parser/signature implementation after FF extension to the full area.
- Disassembly places BOOT sampling at 0x20000110 in SRAM, with SRAM-local literals
  and no calls out to flash while QSPI access is temporarily released.

Remaining hardware checks: LED colors and BOOT arming, a complete program/compare/
reboot capture, operation with native USB connected only to a power brick, and
normal application behavior afterward. Electrical entry remains intermittent,
and the USB write path is newly implemented rather than hardware-proven.

### Standalone LED channel correction

The user observed correct blue but magenta during the intended cyan insertion
window on the initial standalone build. This matches red/green channels being
swapped by the assumed GRB wire order. `standalone/board_status.c` now transmits
RGB order; logical status colors and timing remain the same. The earlier GRB
resource description above records the initial implementation and is superseded
by this correction. No flash protocol, embedded image, GPIO assignment, or stack
reservation changed.

Rebuilt `build-standalone/ch552_programmer.uf2` as
`0.2.1-standalone-3key` to distinguish it from the initial build. Build passed;
file-only picotool confirmed the version and RP2350 ARM Secure metadata.
UF2 SHA-256: `3bbf2361db320b7b67d327f2c6fd06c86df29f99c40cee2f87699d983039f31b`.
The user still needs to confirm colors on hardware. No connected hardware was
accessed by the agent, and this observation alone is not a programming result.

### First standalone trial: command-gap timeout race

`logs/standalone-20261007T225222-498355Z.jsonl`, version
`0.2.1-standalone-3key`: user observed bootloader entry, yellow, then red, and
opened the monitor afterward. This is valid diagnostic evidence: the adapter
buffers logs in RAM independently of CDC attachment, and the final status
confirmed a failed state with `last_error: timeout` and zero dropped logs.
Earlier startup records may be absent because opening/flushing CDC can discard
bytes already queued for transmission; remaining records identify the failure.

Enumeration and descriptors passed. A1 response `A1 BD 02 00 52 11` arrived at
4833ms. The programmer then failed at 4853ms in `command_gap`, phase detect,
offset zero. No A7, key, erase, write, or reboot command was sent in this trial.
This failure occurred before destructive operations.

Source inspection found a clock-boundary race introduced in the standalone main
loop: one `now_ms()` check decided whether the gap had elapsed, then a separate
check treated every active state, including the gap, as a transfer timeout.
If the first check saw 4852ms and the second 4853ms, the gap incorrectly failed
rather than scheduling A7. This matches the capture exactly.

Version `0.2.2-standalone-3key` uses a single time snapshot and a mutually exclusive
timer decision. An expired command gap produces only the next-command action;
actual active transfer deadlines still produce timeout. Portable regression
checks cover before/at/after the observed boundary, inactive states, transfer
timeouts, and timer wraparound. The full simulated programmer test and these
regressions passed with AddressSanitizer/UndefinedBehaviorSanitizer. The RP2350
build passed; file-only picotool confirmed its version and ARM Secure metadata.
UF2 SHA-256: `3346c77f09b033c27d3c5ebb3b592a7deb9c7287255e81a25acca33a1dc47391`.

The updated UF2 remains `build-standalone/ch552_programmer.uf2`. RGB correction,
2000ms cyan insertion window, 20ms command gap, image, and flash validation remain
in place. No connected hardware was accessed by the agent. CH552 release/source
files and RP2350 stack reservation are unchanged. Next trial: install this UF2
with the pad unplugged, then repeat BOOT/insertion. The monitor may run before
or after the attempt, provided the adapter is not reset before capturing logs.

### First complete standalone hardware flash

The user reports a green LED, corroborated by
`logs/standalone-20261007T225720-237621Z.jsonl` on
`0.2.2-standalone-3key`. This is the first successful write-capable hardware trial.
The monitor was opened after the operation and recovered buffered events plus
latched done status, with zero dropped logs and an empty last-error field.

The 2000ms insertion window was armed at 13593ms; host startup was at 15593ms.
The WCH bootloader mounted at 16118ms. A1/A7 identified CH552 bootloader 2.5.0,
UID `0f283ebd`. A3 returned the expected checksum `E2` in
`A3 9D 02 00 E2 00`. A4 request `A4 01 00 0E` returned zero result; its OUT event
at 16200ms and reply at 16563ms span 363ms.

A5 programming began at 16583ms and reached 14336 bytes at 23003ms (6420ms).
A6 comparison began at 23023ms and reached all 14336 bytes at 28635ms (5612ms).
The final A7 reply at 28657ms exactly matches the initial configuration/UID
snapshot, and `config_readback_verified` was emitted. A2 run request
`A2 01 00 01` was logged at 28677ms, and `program_completed` at 28678ms confirms
successful OUT completion. From host startup to completion was 13085ms; from
arming, 15085ms. The existing three-key release and padded image SHA-256 match
the recorded build manifest. The application comparison is on-device A6;
`raw_code_readback: false` correctly remains explicit.

This validates the stock adapter's full write/compare/config-check/run-command
path for this pad in this trial, without a running monitor during programming.
It does not establish insertion repeatability, a trial powered solely by a brick,
or successful execution/USB enumeration of the new application. Next user checks:
reconnect the pad normally and test its firmware, then repeat with USB-C connected
only to a power brick. Confirm resulting LED state and normal application behavior.
No code or UF2 changed while recording this result; no connected hardware was
accessed by the agent. The successful reference remains version 0.2.2 and UF2
SHA-256 `3346c77f09b033c27d3c5ebb3b592a7deb9c7287255e81a25acca33a1dc47391`.

### Configuration retained and power-brick-only trial passed; BOD question

The user reports the macropad configuration remained valid after programming.
They also completed a power-brick-only trial, after approximately six failed
attempts. This validates operation without a computer in that trial; insertion
reliability remains limited. The failed-attempt causes were not supplied, so
none should be classified as brownouts solely from the attempt count.

The user asked whether the standalone build lowers the RP2350 brownout threshold
and whether an earlier setting might still be present. Source inspection confirms
standalone 0.2.2 has no POWMAN/BOD writes. The earlier lowered settings were
volatile runtime register writes, not OTP or nonvolatile configuration changes.
A full loss of adapter power clears those changes; after a cold power-up, the
expected setting is nominal 946mV, VSEL 11, BOD enabled (register reset 0xB1).
This matches both the pinned SDK register reset constants and the user's original
status measurement. Some resets need not restore all POWMAN state, so a software
reset or firmware replacement without removing power is not a sufficient test
of retention. The brick trial is evidence of cold-start behavior if adapter
power was fully interrupted while moving it. Current standalone status does not
report BOD, so the actual live threshold has not been measured for this trial.

Reference: Raspberry Pi's
[POWMAN register definitions](https://github.com/raspberrypi/pico-sdk/blob/master/src/rp2350/hardware_regs/include/hardware/regs/powman.h),
including BOD reset/VSEL/enable and POWMAN reset selection. No firmware setting,
source behavior, or generated UF2 was changed in response to this question.

Record board revision/markings, target pad identity, cable, power source, software
versions, insertion timing, and raw transactions for each hardware trial.

- Does R13 reliably trigger the CH552 bootloader on insertion into a powered board?
- Does the bootloader remain reachable with R13 permanently connected?
- Can the PIO host enumerate without an observed attachment transition, and detect
  target loss reliably enough to invalidate sessions?
- Does host initialization/reset happen within the observed bootloader window?
- Do supported library versions handle the actual RP2350 silicon revision?
- Are manual unplug/replug cycles sufficient to reset every tested pad, including
  any effects from D+ being pulled up before VBUS contacts engage?
- Which bootloader identities/versions and hardware variants actually work?
- Can both full-size boundary images and partial final packets be programmed and
  verified, with useful errors on transfer failure or power loss?

Use meaningful host-side tests for serial framing, truncated replies, timeouts,
stale-session rejection, image limits, and response validation. Hardware entry and
electrical compatibility require real-device trials; unit tests cannot prove them.
Run existing uploader checks if shared code changes. Run `npm run build` from
`webapp/` if implementation changes the web app or its bundled uploader. Ordinary
prototype work does not authorize CH552 release generation or commits.

## Sources

- [Waveshare product](https://www.waveshare.com/rp2350-usb-a.htm) and
  [wiki](https://www.waveshare.com/wiki/RP2350-USB-A).
- [Waveshare schematic](https://files.waveshare.com/wiki/RP2350-USB-A/RP2350-USB-A.pdf):
  board wiring, R13, and power path. Confirm against the purchased revision.
- [Pico-PIO-USB](https://github.com/sekigon-gonnoc/Pico-PIO-USB): host implementation
  and native-device/PIO-host example.
- [Pico SDK board definition](https://github.com/raspberrypi/pico-sdk/blob/master/src/boards/include/boards/waveshare_rp2350_usb_a.h).
- [TinyUSB](https://github.com/hathach/tinyusb): USB device/host stacks and host-driver
  interfaces.
- [CH552 datasheet](https://hubtronics.in/docs/CH552DS1.PDF), especially configuration
  information and reset behavior in sections 6.2 and 7.3.
- [USB 2.0 specification](https://bitsavers.trailing-edge.com/components/usb/USB_2.0_2000.pdf),
  especially connection signaling and electrical test modes.
- [First-hand Waveshare host investigation](https://qsantos.fr/2025/11/21/fixing-the-rp2350-usb-a-not-working-as-usb-host/)
  and [disconnect follow-up](https://qsantos.fr/2026/01/01/the-rp2350-usb-a-cannot-see-devices-disconnect/):
  evidence of fixed-pull-up/pulldown problems. Their hardware fixes are excluded
  by this experiment's zero-modification requirement.

Upstream branch links can change. These sources establish implementation leads,
not proof that the complete unmodified adapter workflow works with our pads.
