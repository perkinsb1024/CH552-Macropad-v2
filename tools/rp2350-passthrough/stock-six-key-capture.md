# Stock Six-Key Factory Capture Findings

Recorded 2026-10-11 from the user's first supplied hardware capture, saved in
[output/](output/). The user reported that the reader appeared to work on the
first attempt. The saved trace contains one arming event and one host start;
it does not establish success rates across repeated attempts.

The user also confirmed that this pad uses the supplied Windows
`MINI KeyBoard.exe` configurator, rather than the vendor WebHID configurator.
The relevant application-protocol investigation is now available in
[factory-exe-investigation.md](factory-exe-investigation.md).

## Observed Results

| Field | Captured Value |
| --- | --- |
| RP2350 reader version | `0.1.0` |
| MCU identity | CH552, chip `0x52`, family `0x11` |
| Bootloader version | `2.5.0` |
| Bootloader USB VID:PID | `4348:55E0` |
| USB interface | Vendor interface 0, bulk OUT `0x02`, bulk IN `0x82`, 64-byte maximum packets |
| Bootloader-reported UID | `30f5b5bd` |
| Raw configuration value, A7 bytes 14–17 | `0xfdfd52ff`; low configuration word `0x52ff` |
| `Code_Protect`, bit 15 | `0`: external serial readout protected |
| Bootloader-start enable, bit 14 | `1` |
| Configuration read | Valid; returned field mask `0x001f` |
| DataFlash read | 128 bytes, all `FF` |
| DataFlash CRC32 | `652d544c` |
| DataFlash SHA-256 | `e9175db65a9789096ca9cb5524d3abc2107df03e3c9ba3af1aca628f9c5d3bd2` |
| Terminal result | Entry confirmed, capture complete, no reported error |
| Trace | All transfers succeeded; zero dropped log events |

The report and raw files were independently checked together. A1 confirms the
CH552 identity. A7 confirms the version, UID, field mask and configuration bits.
The three AB replies contain zero 16-bit status and the exact requested payload
lengths. Their concatenated payload equals `DATA.BIN`; its independently computed
CRC32 matches `REPORT.TXT`. The binary USB descriptors and raw replies match
the corresponding trace entries byte for byte.

Read-reply header byte 1 is `B7` in this capture, rather than the `9D`/`9F` values
seen in historical fixtures. It was preserved, without mistaking it for a
command status. The AB status is the separate 16-bit field at reply bytes 4–5.

## Sequence and Timing

All times are adapter milliseconds since boot, not wall-clock timestamps.

| Event | Time |
| --- | --- |
| Armed | 6760ms |
| PIO USB host started | 8760ms |
| Target mounted | 9285ms |
| First A1 request | 9320ms |
| Final DataFlash reply and capture completion | 9410ms |

The complete capture took 650ms from host start, including enumeration, and
90ms from the first read request. The trace's downstream bulk OUT sequence is:

```text
A1: identify CH552
A7: read configuration/version/UID, mask 0x001f
AB: read DataFlash offset 0, length 58
AB: read DataFlash offset 58, length 58
AB: read DataFlash offset 116, length 12
```

No erase, program, configuration-write, key-setup, compare or application-start
command appears in the capture. Raw files are preserved as supplied; their sizes
and SHA-256 checksums are recorded in [capture-manifest.json](capture-manifest.json).

## Implications for Factory Firmware Extraction

The capture validates the RP2350's autonomous metadata/DataFlash reader on this
stock six-key pad. The user successfully retrieved its result files from the
computer. It does not contain the factory application code.

WCH documents external synchronous-serial readout when `Code_Protect=1` and
blocks it when `Code_Protect=0`. This pad reports the protected value. The
documented unlock erases the code and requires another power-on, so it cannot
preserve the factory application. Soldering access alone therefore does not
establish a usable documented readout path for this pad.
[CH552 datasheet, Table 6.2 and section 6.6](https://akizukidenshi.com/goodsaffix/CH552.pdf).

Bootloader `2.5.0` is now an observation on the new pad, rather than an assumption
from the previous device. The previously investigated historical USB extraction
methods do not establish a working non-destructive application dump on this
version; see [the readout-method investigation](investigation.md#follow-up-documented-readout-methods).
No comparison attack, undocumented read command or protection bypass was tested.

The DataFlash reads returned the erased value at every logical byte. That is an
observation about the returned region, not proof that the whole MCU is blank or
that factory configuration cannot persist. The executable's save commands do not
establish the device firmware's storage location. No useful settings payload was
recovered from these 128 bytes.

## Remaining Unknowns

- Normal application-mode USB/HID descriptors and exact report lengths/IDs on
  this pad have not been captured. The bootloader descriptors cannot confirm them.
- The user identifies the Windows configurator as the correct factory tool, but
  its recovered protocol has not been exercised against this pad in this investigation.
- The WebHub `06 5A` entry request is not established for this legacy protocol;
  successful RP2350-assisted entry does not validate that HID command.
- Detailed LED observations, repeated entry reliability, failure/retry behavior,
  power-cycle persistence and post-capture factory application behavior have not
  been reported. This is one successful capture, not comprehensive hardware validation.
- A non-destructive factory application dump and the location/format of persisted
  factory settings remain unresolved.
