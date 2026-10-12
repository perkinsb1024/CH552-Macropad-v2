# RP2350 Read-Only CH552 Bootloader Reader

This firmware enters the macropad bootloader using the existing Waveshare
RP2350-USB-A insertion sequence, reads its identity/configuration and DataFlash,
then presents the results to the computer as a read-only **CH552READ** drive.
The macropad stays connected to USB-A throughout the capture.

Load [ch552-reader.uf2](ch552-reader.uf2) for this workflow. The older
`tools/rp2350-programmer-release/ch552_programmer.uf2` is a firmware updater
that erases and programs the macropad.

## Capture the Stock Device

Use the Waveshare RP2350-USB-A with its original R13 pull-up installed, a data
cable from USB-C to the computer, and a data cable from USB-A to the macropad.
No soldering is required for this reader. Other RP2350 boards are unsupported.

1. Leave the RP2350 USB-A port empty. Hold **BOOT** while connecting USB-C to
   the computer, then release **BOOT** when the RP2350 boot drive appears.
2. Copy `ch552-reader.uf2` onto that drive. After restart, a solid blue LED means
   the reader is ready. There is no results medium yet and no HEX file to load.
3. With the macropad unpowered, press **BOOT** once. During the solid cyan
   insertion window, connect the macropad to USB-A within 2000ms.
4. Keep both cables connected while the LED is yellow. Wait for green, amber,
   or red, then for **CH552READ** to appear on the computer. The adapter briefly
   reconnects its computer-facing USB interface to publish the results; target
   hosting continues without intentionally switching target power.
5. Copy all files from **CH552READ** to a folder on the computer. Open
   `REPORT.TXT` first; its contents are JSON. Green or amber confirms a valid
   CH552 bootloader identity reply. Red means entry was not confirmed.

*Results live only in RP2350 RAM. Copy them before pressing **RESET** or removing
power. Powering the reader from a brick, then unplugging it to move to the
computer, loses the capture.*

For another attempt, first copy any existing files, unplug the macropad, then
press **RESET** on the RP2350. Wait for blue and repeat from step 3. Resetting
the RP2350 alone does not power-cycle the macropad: USB-A VBUS is wired to VSYS.
The original D+ pull-up also limits ordinary unplug detection. The reader permits
one host start and one capture per adapter reset, with no automatic command
retries. Entry has historically been intermittent. One successful capture on
the new stock six-key pad is recorded in [the investigation notes](stock-six-key-capture.md);
repeated entry reliability remains unmeasured.

## LED Status

All colors are solid.

| Color | Meaning |
| --- | --- |
| Blue | Ready; USB-A should be empty. Press **BOOT** to arm. |
| Cyan | Connect the unpowered macropad within 2000ms. |
| Yellow | Enumerating or reading; keep the cables connected. |
| Green | Entry confirmed; configuration and all 128 DataFlash bytes captured. |
| Amber | Entry confirmed; a later read failed or returned invalid data. Copy the partial capture and inspect `REPORT.TXT`. |
| Red | Entry unconfirmed, or an internal results-publication error. If the drive appears, copy its diagnostic files. |

Green describes the documented metadata/DataFlash capture, not extraction of
the factory application firmware.

## Captured Files

Only replies actually received and validated DataFlash bytes are included;
missing files or shorter files represent incomplete reads, not erased bytes.

| File | Contents |
| --- | --- |
| `REPORT.TXT` | JSON: entry confirmation, completion, bootloader version, UID, global configuration, protection bit, DataFlash byte count/CRC32, last parsed status and error. |
| `DATA.BIN` | Readable DataFlash bytes from logical offset zero, up to 128 bytes. Present when at least one chunk succeeded. |
| `A1.BIN` | Raw identification reply, including invalid replies. |
| `A7.BIN` | Raw configuration/version/UID reply; retains all configuration bytes and any trailing bytes. |
| `AB0.BIN`, `AB1.BIN`, `AB2.BIN` | Raw DataFlash replies for offsets 0, 58 and 116, when received. |
| `USBDEV.BIN`, `USBCFG.BIN` | Bootloader USB device/configuration descriptors, when their reads succeeded. |
| `TRACE.TXT` | Bounded JSON-lines log: transmitted read commands, raw replies, USB results and terminal outcome. |

`capture_complete` requires valid A1/A7 replies and 128 validated DataFlash bytes.
The DataFlash CRC32 covers exactly `dataflash_read_bytes`, including a partial
capture; it uses the standard IEEE CRC32 convention. `dataflash_last_status`
is `null` until a structurally valid AB status has been received. A failed or
timed-out configuration read does not imply protection is disabled: unknown
protection values are `null`. Invalid A7 replies that do complete a USB exchange
still allow an independent DataFlash attempt; a USB timeout terminates the
session because the outstanding transfer may still own its buffers.

The report preserves the global configuration register as a 32-bit hexadecimal
value from A7 bytes 14–17. `code_protect_bit` is bit 15 of its low word:
`1` means external synchronous-serial code readout is allowed; `0` means it is
protected. `bootloader_enabled` decodes bit 14. This polarity comes from the
[CH552 datasheet, section 6.6](https://akizukidenshi.com/goodsaffix/CH552.pdf),
with the configuration layout cross-checked against
[wchisp's CH55x register definitions](https://github.com/ch32-rs/wchisp/blob/main/devices/0x11-CH55x.yaml).
The external-interface read permission does not establish USB code-read support.

The documented USB reads do not return the CH552's application code flash.
`DATA.BIN` is a settings/data-region backup, not a firmware image.
`code_flash_captured` is explicitly `false`. No protection bypass, unlock,
comparison attack or guessed read command is attempted.

## Read-Only Command Boundary

The reader executes a fixed sequence, with 20ms between commands:

| Command | Request |
| --- | --- |
| A1 | Identify CH552, family `0x11`, chip `0x52`. |
| A7 | Read the full supported configuration/version/UID field mask `0x001f`. |
| AB | Read 58, 58 and 12 bytes at logical DataFlash offsets 0, 58 and 116. |

The AB request is `AB 06 00 offset:u32le count:u16le`; a successful reply has
the echoed opcode, a four-byte header, zero 16-bit status, and exactly the
requested bytes. DataFlash reads use the CH552's 128-byte logical address space,
not physical `0xC000` cell addresses. These layouts follow
[wchisp's protocol](https://github.com/ch32-rs/wchisp/blob/main/src/protocol.rs)
and [DataFlash reader](https://github.com/ch32-rs/wchisp/blob/main/src/flashing.rs).

Only A1, A7 and bounded AB requests can reach bulk OUT. The new executable has
no HEX loader, erase/program/configuration-write path, XOR-key setup, verify
command, application-start command, or generic command relay. The RP2350 results
disk is backed by RAM, has read-only file attributes, reports write protection,
and rejects MSC writes and format commands. Standard USB enumeration/setup
requests still occur on both USB buses.

This implements the autonomous file-capture alternative. It does not emulate a
WCH USB device for existing uploaders or accept their commands. The native USB
identity is local-development `CAFE:4054`, separate from the older updater.
CDC serial accepts only `arm`, `status` and `help` as newline-terminated ASCII;
`arm` is equivalent to **BOOT** while idle. No host software is needed to copy
the drive. Version-1 bootloaders and non-CH552 devices are unsupported and stop
at identity validation without speculative fallback commands.

## Build and Verify

The build adapts the read-only protocol and USB host implementation from source
commit `fa7f297b4e710292fa29d9a8987fabd22a1628dc`, using the standalone LED/button
helper. Its original Raspberry Pi button-helper license is included in
`firmware/LICENSE.raspberrypi`. The original programmer's storage, image loader
and programming state machine are absent from this target. The experimental
brownout-threshold override is also absent.

Pinned dependencies:

| Dependency | Revision |
| --- | --- |
| Pico SDK 2.3.1 | `079c6f39023649b154152db30f1d781e884879bc` |
| SDK TinyUSB submodule | `86ad6e56c1700e85f1c5678607a762cfe3aa2f47` |
| Pico-PIO-USB | `5a37a66dc5d3fbe0ef3cdbeda923a757440f984f` |

From the repository root, install CMake and a complete Arm GNU bare-metal
toolchain, then run:

```sh
python3 tools/rp2350-passthrough/prepare_deps.py
cmake -S tools/rp2350-passthrough/firmware -B tools/rp2350-passthrough/build \
  -DPICO_SDK_PATH="$PWD/tools/rp2350-passthrough/.deps/pico-sdk" \
  -DPICO_PIO_USB_PATH="$PWD/tools/rp2350-passthrough/.deps/Pico-PIO-USB" \
  -DPICO_TOOLCHAIN_PATH=/path/to/arm-gnu-toolchain \
  -DCMAKE_BUILD_TYPE=Release
cmake --build tools/rp2350-passthrough/build -j 8
python3 tools/rp2350-passthrough/tests/run.py
```

CMake may fetch/build picotool on its first run. The resulting image is
`tools/rp2350-passthrough/build/ch552_reader.uf2`. Native tests require a C compiler
with AddressSanitizer and UndefinedBehaviorSanitizer; they validate captured
fixtures, protection polarity, all downstream commands, malformed/truncated
replies, partial reads, timeout/late-callback handling, removal, LED outcomes,
upstream reconnect timing, disk bounds and write/format rejection. A separate
Python FAT12 decoder verifies the files exported by the simulated USB session.

Validation of the supplied image and its checksum are recorded in
[validation.md](validation.md). After implementation, the user supplied a
successful stock six-key capture, establishing bootloader entry, configuration
and DataFlash reads, and retrieval of the files on the computer. Detailed LED
observations, retry reliability and post-capture factory application behavior
remain unreported; see [the capture findings](stock-six-key-capture.md).
