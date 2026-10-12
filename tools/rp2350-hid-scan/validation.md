# Factory HID Scanner Validation

Recorded 2026-10-11 on branch `experiment/rp2350-passthrough`, repository base
`9838835c0a3ef5d39c8e5cf7d7ec401879c5d2c6`. The scanner files are uncommitted.
[build-manifest.json](build-manifest.json) identifies the exact firmware and test
sources with SHA-256 hashes. The existing bootloader reader, CH552 application,
web app, uploader and release files were not changed.

## Supplied Image

| Field | Value |
| --- | --- |
| Image | [ch552-hid-scan.uf2](ch552-hid-scan.uf2) |
| Version | `0.1.0` |
| SHA-256 | `824a7766ce2a80ec56e48f4f0992ca174fa8b70dac10c93fb23531ed547468e8` |
| Board | Waveshare RP2350-USB-A |
| Architecture | RP2350 ARM Secure |
| Toolchain | Arm GNU 14.3.Rel1, GCC 14.3.1 |
| Build | CMake Release; application warnings treated as errors |
| Pico SDK | 2.3.1, `079c6f39023649b154152db30f1d781e884879bc` |
| TinyUSB | `86ad6e56c1700e85f1c5678607a762cfe3aa2f47` |
| Pico-PIO-USB | `5a37a66dc5d3fbe0ef3cdbeda923a757440f984f` |
| UF2 size | 139776 bytes; 272 application blocks and one ignored RP2350-E10 prefix block |
| ELF text / data / BSS | 75672 / 0 / 212400 bytes |
| Core0 stack reservation | 4096 bytes, `0x20081000..0x20081FFF` |
| Largest application function frame | 304 bytes, `store_save`; static GCC measurement, not stack high-water validation |
| Flash storage | Two 68KiB slots at offsets `0x1DE000` and `0x1EF000` |

File-only picotool 2.3.1 inspection confirmed the image's name, version, board,
SDK and architecture. Independent UF2 inspection checked block framing,
RP2350 ARM Secure family ID, contiguous application addresses and block numbers,
and that all application data ends below the reserved storage boundary. The
absolute-family prefix's ignore extension and expected RP2350-E10 payload were
checked separately. Physical flash size remains 2MiB; the linker alone excludes
the reserved storage area.

## Software Checks

`python3 tools/rp2350-hid-scan/tests/run.py` passed with AddressSanitizer and
UndefinedBehaviorSanitizer, with sanitizer errors configured to fail execution.

- HID descriptor parsing: numbered/unnumbered vendor reports, preference order,
  nested collections, global push/pop, constant padding, rejection of keyboard
  output, unsupported IDs, oversize and truncated descriptors, plus 20000
  deterministic fuzz inputs.
- Independent checks of all 235 candidate values, exact skip list, no wrap after
  `FF`, zero padding and report-ID framing.
- Actual scanner callbacks with simulated USB: a complete two-report 470-probe
  sweep; explicit baseline re-enumeration before probing; an observation interval
  and forced identity check after every candidate; and stopping only after a
  valid CH552 A1 reply for a bootloader transition.
- Negative attribution: bootloader before any probe, bootloader after the
  baseline reset alone, and WCH-like descriptors with the wrong MCU cannot
  produce a confirmed candidate hit.
- A second complete sweep with all 470 reports stalled still records every
  candidate, with zero accepted transfers and complete saved CSV findings.
- Control **SET_REPORT** fallback, interrupt OUT framing, short writes,
  submission failure, enumeration/transfer timeout, uncertain disconnect
  delivery, stale callbacks, timer wraparound, upstream reconnect timing,
  terminal scan lockout and flash-save failure with RAM diagnostics.
- Flash snapshots: interruption at every erase/program/commit operation,
  complete restoration, disk/header CRC corruption, and fallback to the prior
  valid snapshot. Tests model flash's erase/program constraints.
- Independent Python FAT12 decoding of the actual exported full-sweep and hit
  disks: readable files, JSON and CSV parsing, one row per attempt, complete
  candidate coverage, no skipped selectors sent, raw report/descriptor files,
  bootloader evidence, and byte-identical persisted snapshots.

These session tests compile the real scanner application/transport code against
fake USB and flash interfaces. They exercise application scheduling and callback
behavior; they do not simulate the complete TinyUSB/PIO host controller or its
physical bus. The ARM build links the pinned real implementations.

## Hardware Validation Remaining

No connected hardware was accessed or flashed. This image has not yet been
tested on the factory pad. The required first trial must establish:

- Low-data-line insertion reaches factory `1189:8890` mode on the stock board,
  with the default brownout settings and existing R13.
- The actual interface and HID descriptor match an eligible Output report.
- Repeated forced removal/re-enumeration works with the pinned TinyUSB/PIO host,
  including disconnects masked by R13 and device transitions during a transfer.
- The factory device accepts the chosen interrupt/control report framing.
- Findings mount and survive an actual RP2350 reset/power cycle; LED states and
  host reconnect work on the user's computer.
- Any candidate hit is reproduced separately with controlled starting state
  before it is described as a reliable bootloader-entry command.

The earlier successful reader capture establishes bootloader communication on
this factory pad; it does not validate the scanner's new factory-mode startup,
HID output path, repeated re-enumeration or persistent storage. No undocumented
entry command has been discovered by this software validation.

The main risk remains the unknown commands themselves, as authorized by the
user. Completed results are saved only at a terminal outcome or `stop`; a
brownout/reset while scanning can lose this run's RAM progress. Entry following
a candidate and reset is evidence for a lead, not isolated proof of causation.
