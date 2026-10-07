# Factory configurator inspection

Inspected on 2026-10-07 using static analysis on macOS. The Windows application was not executed, and no device commands were sent.

## Result

No bootloader-entry command was found in the supplied configurator. Both executables expose the same five application methods that send HID output reports. These implement report-ID probing, layer selection, key configuration, and configuration saves. This is evidence about the PC application's implemented commands; it does not establish that the device firmware has no additional commands or startup gestures.

## Inputs and approach

The application is an unobfuscated .NET Framework 4 Windows Forms executable. Its UI title is **MINI KeyBoard V02.1.1**. The directory also contains debugging symbols, a HID library, a .NET compatibility library, ClickOnce deployment metadata, and English/Chinese UI resources.

Both `Release/MINI KeyBoard.exe` and `Release/app.publish/MINI KeyBoard.exe` were inspected. They are different builds; the published build omits an initial connection-state check in `Download_Click`. The five sending methods and their command construction otherwise match.

Analysis used ASCII/UTF-16LE string extraction and managed IL decoding with `dnfile` 0.18.0 and `dncil` 1.0.2. All executable/DLL method bodies were decoded; the application USB call sites were then reviewed. Resource entries were inspected and appeared to be UI strings, layouts, and serialized UI objects; no firmware image was identified.

The accompanying `inventory.txt` records file sizes and SHA-256 hashes. The two `*.usb.il.txt` files preserve the relevant decoded methods, original method tokens, RVAs, and IL offsets for review. External member references are rendered with their member name; internal methods and fields include their declaring type.

## USB interface

- The legacy `AutoCheckUsb` path explicitly selects VID `0x1189` (4489), PID `0x8890` (34960).
- The default `WriteMode` is 1, which uses `HidLibrary` through `HidLib`.
- `HidLib.Connect_Device` enumerates VID `0x1189` and selects a device path containing `mi_01`, meaning interface 1. This path does not explicitly filter the PID.
- The application allocates 65-byte command buffers. The HID wrappers insert a separate report ID and use the device's reported output length. Packet length on the actual pad still needs confirmation from its HID descriptor.
- Command prefixes below refer to payload bytes, excluding the HID report ID.

## Commands traced

| Method | Payload / behavior | Interpretation from application call sites |
| --- | --- | --- |
| `KeyBoardVersion_Check` | Zero-filled buffer; default transport tries report IDs 3, 0, then 2 | Chooses an ID based on successful host writes. No firmware-version response is parsed. |
| `Send_SwLayer` | `A1 <layer>` followed by zeros; layer 0 becomes 1 | Selects the layer being configured. |
| `Download_Click` | Selected key/control, action type and layer, then action-specific configuration | Sends key assignments, modifier/consumer/mouse configuration, or LED settings. |
| `Send_WriteFlash_Cmd` | `AA AA` followed by zeros | Called after key/action configuration to save it. No application image is supplied. |
| `Send_WriteFlashLED_Cmd` | `AA A1` followed by zeros | Called after LED configuration to save it. |

`KeyBoardVersion_Check` is misleadingly named: with the default transport it tries report ID 3 first, then 0, then 2. With the legacy transport it starts with 0, then 2, and falls back to 3. Success reflects the host write result, not a parsed reply proving the firmware understood the command.

The **Download** button sends configuration and then calls one of the save methods. Its branches handle low-nibble action types 1, 2, 8, and 3. There is no separate firmware-update branch in this method.

The legacy `myhid_DataReceived` callback stores a received report and converts it to a string, but discards that string. It does not implement a firmware-version or bootloader handshake.

## Strings and supporting files

No explicit bootloader, firmware-upgrade, ISP, IAP, reboot, or corresponding Chinese firmware/update/reset terminology was found in the two application executables' extracted strings. The method names containing `Flash` and UI text containing **Download** were traced as described above rather than treated as update evidence.

`HidLibrary.dll` provides general HID transport; `Theraot.Core.dll` supplies compatibility helpers. Reset/dispose/update-related names in supporting libraries are not by themselves device commands. ClickOnce deployment metadata concerns installation of the PC application and provides no evidence of MCU update support.

## Next investigation

When the factory pad arrives, record its USB and HID descriptors before changing its configuration. Confirm whether its VID/PID, interface, and report IDs match these builds. The recovered protocol gives us a starting point for examining the factory HID handler if a firmware binary becomes available.

A hidden firmware command or power-on button gesture remains possible. This application does not supply a confirmed bootloader-entry payload. The configuration-save prefixes above should not be treated as bootloader probes.
