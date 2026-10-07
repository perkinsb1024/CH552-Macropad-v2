# Factory WebHub bootloader entry investigation

Recorded 2026-10-07. No factory device was available for hardware validation.

## Findings

[Knurl](https://knurl.site/) configures existing factory firmware over HID. Its WebHub / SDCX / Huali protocol notes identify subcommand `0x5A` as entering the device bootloader. The notes attribute this protocol to devices using the vendor's WebHID configurator, rather than to an installed open-source replacement firmware.

The [Knurl report composer](https://github.com/dozzenn/knurl/blob/main/Sources/KnurlCore/Reports.swift) identifies the vendor configurators as `huali-tech.com` / `sdcx-tech.com`. It documents 64-byte payloads, report ID 0, byte 0 equal to `0x06`, and the subcommand in byte 1. Its tested configuration target is an SDINNOVATION **SIDE-KEYBOARD**, VID/PID `6D7B:DCFA`.

Knurl's documentation states that `0x5A` enters the bootloader. The source files inspected (`Reports.swift` and `knurl-probe/main.swift`) do not contain a dedicated `0x5A` implementation or a captured bootloader transaction. The prototype combines the documented subcommand with Knurl's general framing and zero-padding convention. The exact bootloader frame, including any firmware-specific arguments, remains to be validated on hardware or against the vendor updater.

This is a concrete lead for software entry on some factory devices. It does not establish a universal CH552 command, MCU type, bootloader protocol, or compatibility with our original `1189:8890` pads.

## Identities listed by Knurl

| VID:PID | Interface in Knurl's documentation | Protocol |
| --- | --- | --- |
| `1189:8890` | 1 | Legacy |
| `1189:8840` | 1 | Extended |
| `1189:8830`–`1189:8833` | 0 | Extended |
| `1189:8810` | 0 | Extended |
| `6D7B:DCFA` | 2 | WebHub |
| `6D7C:DCFB`, `6D7D:DCFC`, `6D7E:DCFD`, `6D7F:DCFE`, `68BD:DCFC` | 2 | WebHub |

These are protocol hints, not a guarantee that every device with an ID behaves identically. Shared VID/PID values also do not establish board wiring or chip identity. WebHID exposes HID collections and reports rather than a USB interface-number selector.

## Prototype

### Comparison with the supplied Windows executable

The decoded `MINI KeyBoard.exe` matches Knurl's `LegacyComposer`, rather than its `WebHubComposer`. This conclusion follows from multiple matching packet fields, not just the device identity:

| Operation | Supplied executable | Knurl Legacy | Knurl WebHub |
| --- | --- | --- | --- |
| Select configuration layer | `A1 <layer>` | `A1 <layer>` for nonzero report IDs | Layer is a field in key-table requests/writes |
| Save key configuration | `AA AA` | `AA AA` | Key-table writes use `06 10` or `06 09` |
| Save LED configuration | `AA A1` | `AA A1` | Backlight writes use `06 0B` |
| Key sequence | Control byte, packed layer/type, count, sequence index, modifier, usage | Same field layout and multi-frame sequence | Writes an addressed four-byte key-table entry |
| Report ID | Host-write probes 3, 0, 2 | Configurable; also provides a zero-filled probe | Fixed 0 |

In the executable's `Download_Click`, the layer occupies the high nibble of payload byte 1 when the report ID is nonzero; the low nibble identifies keyboard (1), consumer (2), mouse (3), or LED (8) configuration. Keyboard sequences use bytes 2 and 3 for count and sequence index, then bytes 4 and 5 for modifier/usage. These match the Legacy composer. The executable allocates 65-byte buffers and its wrappers account for the HID report ID/output length; the actual device descriptor is still needed to establish wire length. Similar buffer sizes alone do not establish shared command handling.

The executable provides no evidence that a `06` command envelope or `0x5A` bootloader subcommand exists on its target firmware. Shared support remains possible through an undocumented handler, but the comparison gives no positive reason to expect it. In the Legacy layout, the first two bytes of `06 5A` occupy control and packed layer/type fields rather than WebHub command/subcommand fields. Its behavior on Legacy firmware cannot be inferred from the PC application, including whether invalid type values are safely rejected.

Evidence: local `MINI KeyBoard.exe.usb.il.txt`, methods `Send_SwLayer`, `Send_WriteFlash_Cmd`, `Send_WriteFlashLED_Cmd`, `Download_Click`, and `KeyBoardVersion_Check`; upstream [Knurl report composers](https://github.com/dozzenn/knurl/blob/main/Sources/KnurlCore/Reports.swift), `LegacyComposer`, `ComposerFactory.versionProbe`, and `WebHubComposer`. Both supplied executable builds had matching command construction as recorded in [the original inspection](findings.md).

### Request framing

The local page is `/bootloaderProbe/`, built with the existing Vite web app. Source is in `webapp/src/bootloaderProbe/` with its HTML entry at `webapp/bootloaderProbe/index.html`.

The request is:

```text
WebHID method: device.sendReport(0, payload)
Payload length: 64 bytes
Payload bytes: 06 5A followed by 62 zero bytes
```

Report ID 0 is supplied separately to WebHID; it is not a leading byte in the 64-byte payload. This is an output report, not a feature report. There are no alternate IDs, automatic request sequences, or retries.

The device picker filters to the 13 VID/PID pairs in the table above, covering Knurl's WebHub, Legacy, and Extended identities. Unlisted devices do not appear. Legacy and Extended command compatibility remains unverified.

The prototype accepts a vendor HID collection with a 64-byte output report on ID 0. This is a framing check only. If the descriptor does not match, sending is disabled. No arbitrary packet editor or descriptor override is provided.

## Test procedure when the pad arrives

1. Open `/bootloaderProbe/` in Chrome or Edge, served over HTTPS or localhost. Safari and Firefox do not support this WebHID workflow.
2. Close other configurators. Click **Select HID device** and choose the factory pad. If the browser returns multiple HID interfaces, choose the configuration interface using the displayed descriptors. Opening the interface sends no application reports.
3. Record the product name, VID/PID, protocol hint, and descriptors. Check whether the report matches the WebHub framing. A matching descriptor alone does not prove support for the command.
4. If testing this protocol on the selected pad is appropriate, click **Send 06 5A bootloader request** once. An unrecognized firmware could interpret these bytes differently; this is not a proven harmless query.
5. Inspect macOS **System Information** → **USB** for a new identity. The optional **Check for WCH USB bootloader** chooser filters for `4348:55E0` and `1A86:55E0`. It identifies enumerated USB devices without opening them or sending transfers. WebHub devices may use a different MCU/bootloader; an empty WCH chooser is not proof of failure. An existing WCH device is also not proof that this pad changed mode.
6. Use **Download log** to preserve timestamps, identity/descriptors, the attempted frame, input reports, disconnects, and host write results. The display retains the latest 200 entries.
7. Unplug/reconnect normally to check the factory application still runs. A host write success or HID disconnect alone is not confirmation of bootloader entry. A write rejection during disconnect also leaves delivery uncertain.

No firmware upload, erase, configuration save, or factory-reset command is part of this prototype. Bootloader entry and firmware compatibility are separate questions; identify the actual MCU and bootloader before choosing an image or flashing tool.

## Verification and remaining work

Automated tests cover the exact report ID/payload, rejecting closed devices and incompatible descriptors before sending, nested vendor collections, and not retrying a rejected write. Hardware behavior remains untested.

The next research target is the vendor WebHID configurator/updater: find its complete `0x5A` request and any MCU identification, update transport, or downloadable firmware. This may clarify both first-flash entry and whether the newly ordered pad shares the CH552 hardware used in this repository.

Sources: [Knurl documentation](https://knurl.site/), [report composer](https://github.com/dozzenn/knurl/blob/main/Sources/KnurlCore/Reports.swift), [diagnostic CLI](https://github.com/dozzenn/knurl/blob/main/Sources/knurl-probe/main.swift). These upstream URLs track their current branch and may change.
