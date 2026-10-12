# Reader Build and Hardware Validation

Validated 2026-10-11 on repository base
`9838835c0a3ef5d39c8e5cf7d7ec401879c5d2c6`, with the new reader files uncommitted.
Individual firmware/test source hashes and dependency revisions are recorded in
[build-manifest.json](build-manifest.json) to identify the exact tested contents.
The subsequent user-supplied hardware capture and its limits are recorded below.

## Supplied Image

- File: [ch552-reader.uf2](ch552-reader.uf2), version `0.1.0`.
- SHA-256: `a3aa4d48a33abbd40dcc298b38d7ea57f5401a444534251955361fdd3dfe0289`.
- Board: Waveshare RP2350-USB-A; RP2350 ARM Secure image.
- Build: Pico SDK 2.3.1, pinned TinyUSB/Pico-PIO-USB, Arm GNU 14.3.Rel1,
  CMake Release configuration, warnings treated as errors.
- UF2: 130048 bytes, 253 application blocks plus picotool's ignored RP2350-E10
  workaround prefix. Block framing/family/address sequence checked; picotool
  confirmed program name, version, board and architecture.
- ELF section totals: 70856 bytes text, zero initialized data, 106708 bytes BSS.
- Core0 stack reservation: 4096 bytes, matching the previous RP2350 tool.
  GCC's largest application function frame is 160 bytes (`reader_report`);
  this is a static per-function measurement, not whole-call-chain or hardware
  high-water validation. The CH552 firmware and its stack reservations are unchanged.

## Software Checks

`python3 tools/rp2350-passthrough/tests/run.py` passed with AddressSanitizer and
UndefinedBehaviorSanitizer enabled:

- USB descriptor bounds, real historical A1/A7 reply fixtures and the closed
  read-command allowlist.
- Configuration/protection polarity, complete and partial DataFlash captures,
  rejected reads, unsupported versions, malformed/truncated replies and
  20000 deterministic fuzz inputs.
- Simulated downstream USB session through the actual adapter transport code:
  full automatic capture, 20ms pacing, 350ms upstream reconnect, LED outcomes,
  submission/transfer failures, removal, enumeration timeout, late completion
  after timeout, no second host start, and wrapping timer deadlines. Every
  submitted bulk OUT is checked against the read-only command boundary.
- RAM-disk bounds and full allocation, no-medium behavior, write protection and
  rejection of writes/format operations without changing disk contents.
- Independent Python FAT12 decoding of the exported disk: all expected files,
  JSON parsing, byte-exact DataFlash/raw replies, CRC32 cross-check and command
  trace containing only A1, A7 and three bounded AB reads.

The ARM ELF symbol audit found no linked `flash_range_erase`,
`flash_range_program`, `flash_safe_execute`, `rom_flash_op`,
`rom_flash_range_erase` or `rom_flash_range_program` symbols. Source review and
transport tests establish the target-command restriction; the symbol check
additionally checks that the old RP2350 persistent-storage write path is absent.

## User-Supplied Hardware Capture

After implementation, the user ran reader `0.1.0` on the new stock six-key pad
and supplied all ten files in [output/](output/). The user reported apparent
success on the first attempt; the trace records one arming event and host start.
The assistant inspected the files, without accessing connected hardware.

The capture establishes CH552 bootloader `2.5.0`, valid configuration/UID replies,
successful reads of all 128 DataFlash bytes, and retrieval of the result files
on the computer. All DataFlash bytes are `FF`; CRC32 `652d544c` matches the raw
payloads and report. All logged USB transfers succeeded, with no dropped events.
Completion took 650ms from host start. Only A1, A7 and three bounded AB reads
were transmitted. See [the full findings](stock-six-key-capture.md) and
[capture-manifest.json](capture-manifest.json) for raw-file checksums.

The configuration low word is `0x52ff`, so `Code_Protect=0`: the documented
external serial readout path is protected. This capture is metadata/DataFlash,
not an application firmware dump.

## Hardware Validation Remaining

Detailed LED observations, repeated entry reliability, hardware failure/retry
paths and factory application behavior after normal reconnection have not been
reported. The successful capture establishes file retrieval, but does not by
itself isolate or validate every step of the native USB reconnect/mount behavior,
CDC behavior or every supported host platform. Hardware validation is limited
to this single user-supplied stock-pad capture.

The web app, uploader, CH552 application sources and existing release artifacts
were unchanged; their deployment/release suites were outside this tool build.
