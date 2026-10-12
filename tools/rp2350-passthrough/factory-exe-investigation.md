# Factory Windows Configurator Investigation

Original static inspection: 2026-10-07. Current-device follow-up recorded:
2026-10-11. This document brings the relevant findings into the RP2350 reader
investigation without switching branches or running the Windows application.

## Current Device and Scope

The user confirmed that the new stock six-key pad uses the supplied
`MINI KeyBoard.exe` configurator, rather than the vendor WebHID configurator.
The recovered legacy application protocol is therefore the relevant research
lead. The [read-only RP2350 capture](stock-six-key-capture.md) independently
identifies the MCU as CH552 and the bootloader as `2.5.0`.

Normal application-mode USB/HID descriptors have not yet been captured on this
pad. The bootloader's `4348:55E0` identity does not establish its normal VID/PID,
interface, report IDs or report length. The user confirmation associates the
configurator with the pad; it is not a new binary comparison or a device-level
validation of every recovered command.

## Original Analysis Provenance

The original reports, inventory, decoded IL and executable files remain on
`experiment/factory-software-bootloader-investigation`, inspected at
`c53c6be28131f6304648c836de9bac357d4d8bba`:

```sh
git show c53c6be28131f6304648c836de9bac357d4d8bba:factorySoftware/analysis/findings.md
git show c53c6be28131f6304648c836de9bac357d4d8bba:factorySoftware/analysis/webhub-bootloader.md
git show c53c6be28131f6304648c836de9bac357d4d8bba:factorySoftware/analysis/inventory.txt
```

The two inspected executables have these inventory identities:

| Original Path | Size | SHA-256 |
| --- | --- | --- |
| `factorySoftware/Release/MINI KeyBoard.exe` | 217088 bytes | `4ae53d3a40921e4f57444c489fa1b38fe91a2e907feda17630450fc97a7cd7b1` |
| `factorySoftware/Release/app.publish/MINI KeyBoard.exe` | 218096 bytes | `cd20ac6e9ca5d6786acd8ae1a7240420a8f838d79f5d2c5ca7dc5dce2d5c6385` |

The application is an unobfuscated .NET Framework 4 Windows Forms executable,
with UI title **MINI KeyBoard V02.1.1**. The inspection used string extraction
and managed IL decoding with `dnfile` 0.18.0 and `dncil` 1.0.2 on macOS. All
executable/DLL method bodies were decoded, USB send call sites reviewed, and
resources inspected. Neither application was executed and no device commands
were sent during that static inspection.

## Recovered USB Configuration Protocol

- The legacy `AutoCheckUsb` path explicitly selects VID `0x1189`, PID `0x8890`.
- Default `WriteMode=1` uses `HidLibrary` through `HidLib`.
- `HidLib.Connect_Device` enumerates VID `0x1189` and chooses a device path
  containing `mi_01`, indicating interface 1. That path does not explicitly
  filter the PID.
- Application command buffers contain 65 bytes. HID wrappers insert a separate
  report ID and use the descriptor-reported output length. The buffer allocation
  alone does not establish the on-wire length for this pad.
- Payload prefixes below exclude the HID report ID.

| Method | Recovered Behavior | Interpretation |
| --- | --- | --- |
| `KeyBoardVersion_Check` | Writes a zero-filled payload; default transport tries report IDs 3, 0, then 2. | Chooses an ID from host-write success; no firmware-version reply is parsed. |
| `Send_SwLayer` | `A1 <layer>` followed by zeros; layer 0 becomes 1. | Selects the layer being configured. |
| `Download_Click` | Selected key/control, packed action type/layer and action-specific data. | Configures keyboard, consumer, mouse or LED behavior. |
| `Send_WriteFlash_Cmd` | `AA AA` followed by zeros, after key/action configuration. | Saves key configuration; no application image is supplied. |
| `Send_WriteFlashLED_Cmd` | `AA A1` followed by zeros, after LED configuration. | Saves LED configuration. |

With nonzero report IDs, payload byte 1 holds the layer in its high nibble and
the action type in its low nibble: keyboard 1, consumer 2, mouse 3 or LED 8.
Keyboard sequences use bytes 2–3 for count/index and bytes 4–5 for modifier/usage.
The legacy transport's version-check path starts with report IDs 0 and 2, then
falls back to 3. Host write success does not prove firmware interpretation.

Both inspected executable builds construct the same five send-method commands.
The published build omits an initial connection-state check in `Download_Click`.
The legacy `myhid_DataReceived` callback stores a received report, converts it
to a string and discards that string; it implements no version/bootloader handshake.

## What Was Not Found

No implemented bootloader-entry or firmware-update command was found in the
supplied configurator. The **Download** button sends configuration, followed by
a configuration-save command. Methods containing `Flash` do not establish
application firmware programming or readback.

No firmware image was identified in the inspected resources. Strings did not
identify bootloader, ISP, IAP, firmware-upgrade or reboot operations. Supporting
library names related to reset/update/disposal and ClickOnce application-update
metadata were not device-command evidence.

This is evidence about the application's implemented paths, not proof that the
device firmware lacks hidden commands, startup gestures or other readout mechanisms.
Configuration-save commands are writes and are not bootloader-entry probes.

## Relationship to the WebHub Lead

The original comparison matched this executable's packet fields to Knurl's
`LegacyComposer`: `A1 <layer>` selection, `AA AA`/`AA A1` saves, packed layer/type
fields, sequence framing and configurable report IDs. Knurl's WebHub protocol
instead uses a `06` command envelope and different configuration writes.
The relevant original comparison and decoded IL remain at the pinned source
revision above; its upstream reference was
[Knurl's report composers](https://github.com/dozzenn/knurl/blob/main/Sources/KnurlCore/Reports.swift).

The WebHub `06 5A` bootloader request was a separate lead for vendor WebHID
configurator devices. No corresponding handler or implemented command was found
in this executable. In the legacy layout, those first two bytes occupy control
and packed layer/type positions; support and effects cannot be assumed.
The new pad's successful RP2350-assisted bootloader entry does not validate
`06 5A` or any normal-mode HID bootloader request.

## Consequences of the New Capture

The new capture establishes CH552 bootloader `2.5.0` and `Code_Protect=0`, blocking
the documented external serial code-read route. It still contains no factory
application dump and provides no evidence of a hidden application HID read command.

All 128 returned DataFlash bytes are `FF`. That does not resolve where the factory
firmware persists configuration: the PC application's save commands do not reveal
the MCU storage implementation. No settings payload was recovered from this region.

The remaining application-protocol evidence to collect is the pad's normal-mode
USB/HID descriptors, followed by comparison with the recovered interface/report
requirements. No factory configuration writes or speculative WebHub requests were
performed as part of the RP2350 capture or this notes update.
