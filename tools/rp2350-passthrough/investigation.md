# RP2350 Bootloader Bridge Investigation

Recorded 2026-10-11. The original source/protocol investigation below preceded
implementation. A read-only autonomous reader has since been implemented and
software-tested; see [usage.md](usage.md) and [validation.md](validation.md).
The user then supplied a successful hardware capture from the new stock six-key
pad. The assistant inspected the saved files without accessing connected hardware.
The objective is computer-controlled investigation of a new stock six-key
macropad, preserving its factory application while exploring firmware extraction.

## Finding

The implemented autonomous reader successfully captured CH552 bootloader `2.5.0`,
UID `30f5b5bd`, a protected `Code_Protect=0` configuration and 128 DataFlash bytes
that all returned `FF`. The trace contains only A1, A7 and bounded AB reads,
with no transfer failures or erase/program operations. Completion took 650ms
from host start, and the user retrieved the files on the computer. See
[the stock six-key capture findings](stock-six-key-capture.md) for raw evidence,
checksums and the limits of this single hardware trial.

The user confirmed that this pad uses the supplied Windows `MINI KeyBoard.exe`
configurator. Its recovered legacy HID protocol is the relevant application
research lead; the vendor WebHub `06 5A` bootloader command is not established
for this protocol. See [the restored executable investigation](factory-exe-investigation.md).
Normal application-mode USB/HID descriptors remain uncaptured. The blank-looking
DataFlash result does not establish where the factory firmware stores settings.

### Original Feasibility Finding

The existing Waveshare RP2350-USB-A hardware can support a computer-controlled
bootloader bridge. Its programmer already operates a computer-facing USB device
and a macropad-facing USB host simultaneously. The missing part is a command
transport connecting those two interfaces, with a persistent target session after
identification instead of an automatic firmware replacement sequence.

This would solve access to the bootloader without unplugging the macropad. It
would not itself provide an application-flash read operation. The inspected WCH
command implementations distinguish code comparison from data-flash readback;
neither contains a normal code-flash dump command.

## Source Provenance

The inspected working branch is `experiment/rp2350-passthrough`, initially at
`9838835c0a3ef5d39c8e5cf7d7ec401879c5d2c6`, with a clean working tree.
It contains the packaged programmer and instructions in
`tools/rp2350-programmer-release/`, but not the buildable source project.

The buildable source and investigation history are preserved on
`experiment/rp2350-bootloader-entry`, inspected at
`fa7f297b4e710292fa29d9a8987fabd22a1628dc`. Relevant files can be read without
switching branches, for example:

```sh
git show fa7f297b4e710292fa29d9a8987fabd22a1628dc:tools/rp2350-programmer/plan.md
git show fa7f297b4e710292fa29d9a8987fabd22a1628dc:tools/rp2350-programmer/standalone/main.c
```

The packaged `ch552_programmer.uf2` in this checkout has SHA-256
`0e0cf3d4aae53147ab026183689097a726bfd308491eb52fbdd82c1327f5d3b7`.
The source project's standalone CMake target identifies itself as
`0.3.2-standalone`. That is source metadata, not a fresh verification of the UF2's
embedded metadata or a reproduction of its build.

## Existing Hardware and Software

The previous investigation's schematic review records USB-C on the RP2350's
native USB controller, USB-A D+ on GPIO12, USB-A D− on GPIO13, and USB-A power
connected to VSYS without a software-controlled power switch. Its source uses
TinyUSB for both roles and Pico-PIO-USB for the downstream host.

The stock board's fixed R13 D+ pull-up participates in the existing bootloader
entry method. The operator powers the RP2350 with USB-A empty, arms an insertion
window, plugs in the macropad, and the firmware subsequently starts USB hosting.
The bridge should preserve that sequence initially. Waveshare's ordinary host
hot-plug advice is to remove R13, but doing that would change the circuit used by
this project's entry method. No hardware modification is required by the
proposed initial bridge. [Waveshare board documentation](https://www.waveshare.com/wiki/RP2350-USB-A).

The historical source already provides these reusable components:

| Component | Existing Location in the Source Revision | Bridge Use |
| --- | --- | --- |
| Native CDC serial connection | `firmware/usb_descriptors.c`, `standalone/usb_descriptors.c` | Computer command transport |
| Delayed PIO host start | Both `main.c` implementations | Preserve the tested entry sequence |
| WCH identity and interface checks | `firmware/probe_protocol.c` | Accept `4348:55E0` / `1A86:55E0`, then validate the bulk interface and CH552 identity |
| Asynchronous bulk transfers | Both `main.c` implementations | Send computer-supplied commands and return received bytes |
| Nonblocking USB service and logging | `standalone/main.c` | Keep both USB connections serviced while waiting |
| Paced command scheduling | `standalone/main.c`, `standalone/programmer.c` | Preserve the historical 20ms inter-command gap initially |
| Python serial capture | `host/probe.py` | Starting point for a research client and timestamped captures |

The read-only probe sends A1 and A7, then enters `DONE`. It has no arbitrary
transfer console command. The standalone programmer proceeds from identification
to key setup, erase, write, compare, configuration readback, and application start.
Its CDC console accepts status/reset/bootsel; it is not a packet relay.

The prior hardware notes record CH552 bootloader 2.5.0 identification and a
successful complete programming trial on the previous pad. These historical
results do not establish entry reliability for the newly arrived six-key unit;
its separate successful read-only capture is recorded above. The older notes
also record insertion-related brownouts and intermittent entry.
The standalone source retains the default brownout setting; the probe source
contains an experimental threshold override that should not be inherited casually.

## Bridge Options

```mermaid
flowchart LR
    PC[Computer Research Client] <-->|USB-C CDC Commands and Replies| RP[RP2350 Bridge]
    RP <-->|USB-A PIO Host: WCH Bulk Transfers| PAD[Powered Macropad in Bootloader]
```

The RP2350 terminates two independent USB buses. USB addresses, packet handshakes,
and enumeration are handled separately on each side. It can forward command
payloads and replies; its present wiring does not directly connect the
computer's USB data lines to the macropad.

### Custom Serial Research Protocol

Originally considered as the first implementation. Expose the adapter under its own USB identity
and retain CDC. A small Python client arms entry, waits for target identification,
and sends framed transfer requests. The RP2350 remains the macropad's host and
maintains power and bus service throughout the session.

Define protocol version, request IDs, target-session IDs, bounded payload lengths,
deadlines, and explicit USB result/actual-length fields. Initial payload bounds
can follow the existing 64-byte WCH request/reply buffers. Hex-encoded JSON lines
would fit a low-volume prototype, but require a larger parser than the current
80-byte command line; a binary protocol needs explicit framing and resynchronization.

Provide adapter status, arm, target descriptors/identity, and command exchange.
An exchange should send one OUT request and collect its IN reply under one
request ID, with a separately defined option for commands that expect no reply.
Keep raw reply bytes intact even when a higher-level parser rejects them.
Diagnostic events must have a distinct message type or interface.

This supports our own scripts directly. An existing USB uploader would need a
transport adapter. `webUploader/src/bootloader.mjs` already wraps an object with
`open`, `selectConfiguration`, `claimInterface`, `transferOut`, and `transferIn`;
a bridge adapter could implement those semantics later. The uploader's flashing
initialization is not a factory-preservation workflow.

### WCH Serial Protocol Compatibility

Potentially useful when an existing native tool is preferred. `wchisp` has a
serial transport that encloses WCH command bytes in request prefix `57 AB` and
an additive checksum. Replies use `55 AA`, raw WCH reply bytes, and a checksum.
Its default serial receive timeout is 1000ms.
[Inspected serial transport](https://github.com/ch32-rs/wchisp/blob/main/src/transport/serial.rs).

The adapter could parse that serial envelope, forward the contained command
through USB bulk OUT, collect USB bulk IN, and construct the serial reply. The
macropad would still communicate over USB; no target UART wiring is involved.
This is a feasibility inference from the transport source, not demonstrated
compatibility. It would require strict length/checksum validation, bounded
buffering, timing compatible with the client's deadlines, and a separate channel
for diagnostics and arming. A physical **BOOT** arming sequence is another option.
Baud-change requests need deliberate local handling rather than blindly passing
UART-specific commands to a USB target.

### WCH USB Device Emulation

For unchanged USB clients, the RP2350 could present a WCH-compatible bootloader
interface to the computer and relay its bulk traffic. `wchisp` looks for WCH
VID/PID, configuration 1, interface 0, bulk OUT `0x02`, and bulk IN `0x82`.
[Inspected USB transport](https://github.com/ch32-rs/wchisp/blob/main/src/transport/usb.rs).

This needs new upstream descriptors and endpoint handling, including backpressure,
short replies, zero-length termination when needed, stalls and endpoint recovery.
Standard upstream control requests such as setting the USB address must be handled
locally; indiscriminate forwarding would confuse the two independent buses.
Any required vendor control requests need explicit support.

The existing standalone descriptors already use `0x02` / `0x82` for CDC data,
so adding a bootloader interface requires reassigning those endpoints and arranging
interface 0 appropriately. An upstream software disconnect/reconnect after target
identification could expose the new interface while downstream power and hosting
continue. Behavior with each intended client would need testing; matching VID/PID
alone does not establish compatibility.

This is substantially broader work than the serial bridge and provides no new
code-read capability by itself. A universal transparent USB proxy would be a
larger project still, beyond the narrow WCH bootloader interface needed here.

## What Can Be Read

| Operation | Meaning | Relevance to a Factory Application Dump |
| --- | --- | --- |
| A1 | Identify MCU family/type | Establish the new device's identity |
| A7 | Read configuration, bootloader version, UID | Establish the exact bootloader and preserve raw metadata |
| AB | Read Data Flash | Candidate for a settings backup; not an application image |
| A3 / A6 | Establish XOR key / compare supplied code bytes | Investigate comparison behavior; normal replies are not code readback |

The upstream command definitions explicitly separate `Verify`, `ReadConfig`,
and `DataRead`, without a code-read operation. Its CH552 metadata lists 14KiB
of application flash and 128 bytes of Data Flash.
[Command definitions](https://github.com/ch32-rs/wchisp/blob/main/src/protocol.rs),
[Command numbers](https://github.com/ch32-rs/wchisp/blob/main/src/constants.rs),
[CH55x metadata](https://github.com/ch32-rs/wchisp/blob/main/devices/0x11-CH55x.yaml).

Application extraction therefore needs a separately established read mechanism,
undocumented command, or bootloader information leak. A6 comparison is a research
lead, not a proven byte-by-byte extraction method. The `isp55e0` author warns that
a failed comparison can make subsequent comparisons fail until a power cycle;
that observation must not be assumed to apply identically to this new pad, but
it undermines any assumption of a freely repeatable guessing oracle.
[Author's comparison note](https://github.com/frank-zago/isp55e0#usage).

Do not equate a code-protection bit with the availability of a USB code-read
command. Likewise, AB addresses Data Flash through its own operation; supplying
an application address is not an established way to read application memory.
Both require evidence for the actual bootloader version.

## Original Bridge Proposal

The following proposal was superseded by the user's choice to allow autonomous
read-only file capture. The implemented reader accepts no arbitrary transfer
requests or A3/A6 commands; these remain research options, not enabled features.

1. Recover the pinned source project into this branch, retaining provenance, and
   add a separate bridge build target. Preserve the packaged programmer UF2.
2. Reuse standalone USB scheduling and the entry sequence, but remove the stored
   HEX requirement and automatic programming flow from the bridge target. End
   identification in a persistent `READY` state with host USB service continuing.
3. Add the custom CDC protocol and Python research client. Initially permit
   validated A1/A7 and bounded AB data reads; exclude flash/configuration erase
   and write operations. Add A3/A6 comparison research separately after identifying
   and reviewing the new pad's bootloader behavior.
4. Associate every request and completion with a target session. Invalidate it on
   timeout, transfer failure, re-enumeration, cancellation, or adapter restart.
   Keep one exchange in flight, return actual received lengths, and avoid automatic
   command replay after uncertain delivery.
5. Retain the historical 20ms pacing as an initial setting. Use asynchronous
   transfers, static buffers that remain owned until completion, and continuous
   native-device and host-task service. The pinned TinyUSB transfer structure has
   no implemented per-transfer timeout field; enforce deadlines in application
   state. Its abort API only promises cancellation of transfers not yet started,
   so a timed-out buffer cannot immediately be reused on the assumption that an
   active transfer has stopped.
   [Pinned host API](https://github.com/hathach/tinyusb/blob/86ad6e56c1700e85f1c5678607a762cfe3aa2f47/src/host/usbh.h).
6. Treat R13 as a limitation on attachment/removal detection. A normal unmount
   callback alone is insufficient evidence of continuity. Keep the initial
   one-host-start-per-adapter-reset workflow; retries require manual target
   unplug/reinsertion because adapter reset does not switch target power.

Meaningful software checks would exercise fragmented/coalesced frames, malformed
lengths, transfer results, short replies, timeouts, stale callbacks/sessions,
slow client backpressure, and rejection of erase/write requests before USB
submission. Hardware checks would establish native CDC survival during insertion,
correct new-pad identity, repeated reads with pauses between commands, and factory
application behavior after reconnecting normally. A successful data backup must
be identified as Data Flash, with its actual size and checksum, rather than
reported as a firmware dump.

## Follow-Up: Documented Readout Methods

WCH's datasheet, section 6.6, documents external synchronous-serial readout when
`Code_Protect=1`. With `Code_Protect=0`, readout is blocked; its documented unlock
requires erasure. The interface uses P1.4, P1.6, P1.7 and optionally RST, with a
5V target supply. For CH552G SOP-16 these are pins 2, 4, 5 and 6 respectively.
[Manufacturer datasheet, pages 3 and 18](https://akizukidenshi.com/goodsaffix/CH552.pdf).

This identifies a hardware route, but this investigation has not located a
verified compatible reader or complete public programming protocol. Generic SPI
flash-reader compatibility must not be inferred from the signal names.

There is also an actual historical USB dumper, Thomas Z.'s `freader`, with
reported successful CH552 extraction on bootloaders 1.1 and 2.31.
[Original developer and tester reports](https://www.mikrocontroller.net/topic/462538?page=2#5873139).
The developer's analysis of 2.4 reports address restrictions that prevent the
previous byte-walking comparison attack.
[Original analysis](https://www.mikrocontroller.net/topic/462538?page=3#6388650).
His August 22, 2025 follow-up reports no working firmware-dump method for 2.4/2.5.
The earlier 2.5 bootloader dump used an installed fake loader, so it is not
evidence of preserving a stock application while extracting it.
[Latest follow-up](https://www.mikrocontroller.net/topic/462538?page=4#7926922),
[2.5 bootloader-dump procedure](https://www.mikrocontroller.net/topic/462538?page=4#7191218).

These are version-specific researcher observations, not proof that every
possible extraction method is impossible. The new pad's capture now establishes
bootloader `2.5.0` and `Code_Protect=0`. The documented external serial readout
path is therefore blocked, and erasure to remove protection would lose the factory
application. No non-destructive application dump has been established.

## Implemented Follow-Up

The user authorized removal of all destructive operations and accepted autonomous
capture as an alternative to passthrough. The new `ch552_reader` target reads A1,
A7 and the CH552's 128-byte DataFlash through AB, then exports an immutable FAT12
results drive backed by RP2350 RAM. Its LED distinguishes confirmed entry/full
capture, confirmed entry/partial capture and unconfirmed entry. The old packaged
programmer artifact is preserved and is not the image for this workflow.

The first user-supplied hardware trial completed the full supported read sequence
and exported its files. [validation.md](validation.md) distinguishes that result
from unreported LED observations, repeated-entry testing and post-capture factory
application behavior. The source and UF2 are unchanged by the capture-note update.

The original custom-bridge recommendation below describes the research options,
not the implemented reader's command interface.

## Original Recommendation

Build the custom serial research bridge first. It reuses the existing hardware
and downstream USB implementation, offers precise transaction/error captures,
and keeps the stock pad powered throughout a computer-controlled session.
Capture its actual bootloader version and read-only metadata before choosing an
application-extraction technique. Consider WCH serial compatibility next if
native-tool reuse is useful; full USB bootloader emulation is optional.

The bridge is feasible from the inspected architecture. A byte-for-byte factory
application dump remains unproven. No firmware, web app, release artifact, or
connected device was changed during the original investigation. The subsequent
implementation adds a separate reader source/build and UF2, without changing
the CH552 application firmware or the older programmer release.
