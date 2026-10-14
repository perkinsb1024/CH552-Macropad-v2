# DataFlash Header and CRC Investigation

Recorded October 13, 2026, on `experiment/v15-updated-header`.
Baseline source: `a14798a4450c85d88d96f9e5cad598da552de0b6`, initially clean.
This investigation evaluates alternatives; it does not select a new production
format or implement the deferred **Auto-Sleep** extension.

## Goal and Existing Protection

Reclaim header storage for selectable **Auto-Sleep** behavior without reducing
the existing 119-byte profile payload. Four timeout choices need two bits;
companion controls could require more. See the
[Auto-Sleep Extension Investigation Plan](auto-sleep-extension-plan.md).

The current nine-byte header contains `MP` at bytes 0–1, format version at byte
2, settings at bytes 3–5, CRC16-CCITT-FALSE at bytes 6–7, and settings at byte 8.
The 128-byte image includes all unused tail bytes in its CRC. Firmware also
validates the version, hardware, bounds, actions, strings and macro references.

Uploads carry an expected CRC separately from the stored image CRC. Firmware
checks both before saving. `storageSave` compares the old image, skips identical
saves, clears and verifies both marker bytes, writes changed body bytes with
individual readback, restores the marker last, and compares all 128 bytes.
An interrupted save normally leaves an invalid marker. At startup the image is
read into RAM and structurally validated with its stored CRC before activation.

Readback checks whether flash matches the intended image at save time. It does
not establish future retention. On the next boot, the intended upload buffer
is gone, so a stored CRC provides an independent integrity check. CRC does not
repair data or identify semantically wrong settings encoded with a matching CRC.

## Header Alternatives

| Alternative | Reclaimed Space | Tradeoff |
| --- | ---: | --- |
| Borrow two version bits | 2 bits | Six version bits retain values 0–63; use a masked version consistently in decoding and advertise the clean value in GET_INFO. |
| Borrow three version bits | 3 bits | Five version bits retain values 0–31; with current version 15, values 16–31 remain. |
| Single-byte marker | 8 bits | Less marker redundancy and weaker recognition of arbitrary data, while preserving the complete CRC. |
| CRC-8 | 8 bits | Less integrity protection, potentially smaller arithmetic, comparisons and upload-CRC storage. |
| CRC-10 | 6 bits | Still occupies two bytes; shared settings need CRC coverage and masking. |
| CRC-12 | 4 bits | Same packing issue, but stronger sparse-error detection than CRC-8. Not implemented in this measurement task. |

Configuration-format numbers need change only when the format changes, not for
every firmware revision. Borrowed version bits must remain CRC-covered.

The user prefers keeping marker and version adjacent. A distinct new single-byte
marker at byte 0 can identify a layout with version at byte 1 and settings at
byte 2. Old `MP` images continue to use version at byte 2. Bytes 3–8 and layer
offsets can remain unchanged. The marker must distinguish these layouts before
reading the version; updated importers can decode both. Old firmware and frozen
configurators reject the new marker. GET_INFO identifies the format independently
of the image offset. Moving the version is migration work, not a hardware
restriction or an inherent integrity penalty.

A single-byte marker can be cleared and verified before body writes, then
restored last after successful body verification. It preserves the intended
interrupted-save behavior under normal byte-write operation, with less redundancy
against abnormal hardware faults. Both marker bytes currently receive two writes
per changed save; reducing their count does not reduce the wear of the remaining
marker cell.

## Corruption Despite Save Verification

| Source | What Save Verification Does and Does Not Establish |
| --- | --- |
| Power loss or reset during saving | The save may never reach final verification. The invalid-marker sequence normally prevents activating a partial image. Neither CRC width provides atomic rollback to the old image. |
| Repeated programming wear | Immediate readback can pass before retention becomes unreliable. Marker cells are rewritten on every changed save. |
| Retention loss or marginal cells | Aging, temperature and prior cycling can affect later reads; a past correct readback cannot detect a later change. |
| Electrical faults or damaged hardware | Supply instability during programming can affect writes; faulty hardware can affect later reads. These are possible causes, not diagnosed faults in these pads. |
| Unintended writes | Firmware bugs, programming tools or another firmware image can overwrite data after a successful save. Matching wrong data and CRC can still pass. |
| Upload or staging corruption | Readback can faithfully confirm the wrong image. Comparing staging against the host's separately supplied expected CRC helps detect this before saving. |
| RAM corruption after activation | The boot/save CRC checks do not continuously validate the active RAM image. Changing stored CRC width does not add runtime RAM protection. |

WCH specifies approximately 10,000 erase/program operations per DataFlash cell
and recommends balanced use: [CH552 Datasheet, Section 6.2](https://cdn-learn.adafruit.com/assets/assets/000/129/847/original/CH552DS1.PDF?1715004485=).
General flash reliability depends on cycling, retention, temperature and programming
conditions: [Microchip TB072](https://ww1.microchip.com/downloads/en/appnotes/91072a.pdf).
The Microchip lifetime figures are not CH552 specifications. No CH552-specific
retention lifetime or failure rate is claimed here.

## CRC Strength and Standard Middle Grounds

For uniformly random corruption syndromes, approximate miss rates are 1/256,
1/1,024, 1/4,096 and 1/65,536 for 8, 10, 12 and 16 bits. These are conditional
miss rates, not the probability that a saved profile becomes corrupt. Actual
detection depends on the error pattern, polynomial and covered length.

CRC-8 detects every single-bit error and every burst spanning at most eight
bits. At this roughly 1,000-bit length it cannot guarantee detection of all
two-bit errors. The current CRC-16 polynomial guarantees detection of all one-,
two- and three-bit errors at this length. CRC-12 with polynomial `0x80F` provides
the same sparse-error guarantees here, although its random-corruption miss rate
and guaranteed burst span are weaker. See Koopman's
[CRC-8](https://users.ece.cmu.edu/~koopman/crc/crc8.html),
[CRC-12](https://users.ece.cmu.edu/~koopman/crc/crc12.html), and
[CRC-16](https://users.ece.cmu.edu/~koopman/crc/crc16.html) analyses.

| Standard Algorithm | Polynomial | Initial Value | Reflection | Final XOR | `123456789` Check |
| --- | --- | --- | --- | --- | --- |
| CRC-10/ATM | `0x233` | `0` | Neither input nor output | `0` | `0x199` |
| CRC-12/DECT | `0x80F` | `0` | Neither input nor output | `0` | `0xF5B` |
| CRC-12/UMTS | `0x80F` | `0` | Output only | `0` | `0xDAF` |
| CRC-8/SMBUS | `0x07` | `0` | Neither input nor output | `0` | `0xF4` |

Polynomial notation omits the implicit highest term. Named algorithm parameters
and check values are recorded in the
[CRC Catalogue](https://reveng.sourceforge.io/crc-catalogue/all.htm).
CRC-10 is used in [ITU-T I.610](https://www.itu.int/rec/T-REC-I.610/en);
the twelve-bit polynomial appears in the
[DECT](https://www.etsi.org/deliver/etsi_en/300100_300199/30017503/02.05.01_60/en_30017503v020501p.pdf)
and [UMTS](https://www.etsi.org/deliver/etsi_ts/125200_125299/125212/17.00.00_60/ts_125212v170000p.pdf)
standards. A named CRC algorithm can be used on this image without adopting the
original transport's framing or padding. Truncating CRC-16 does not implement
these smaller CRC algorithms or establish their detection guarantees.

## Measurement Design

The [probe driver](build-crc-probes.py) extracts immutable baseline firmware,
tests and build dependencies into temporary trees. The normal native builder
uses CH55xDuino 0.0.25, SDCC build.13407_4, model-small, size optimization,
no-xinit-opt, int-long-reent, 24MHz, 148 USB DMA bytes and the real 14,336-byte
application flash limit. Each candidate is built for both hardware variants,
retaining native RAM/startup/IRQ parameter checks. No release generation occurs.

Candidates preserve all existing features and all header/layer offsets. They
retain the v15 number only to isolate CRC costs; their CRC definitions are
incompatible with production v15. Do not flash or publish these probes. Adoption
requires an explicit format identifier and configurator/migration work.

| Candidate | Change |
| --- | --- |
| `baseline` | Unchanged CRC16-CCITT-FALSE. |
| `crc10-core` | CRC-10/ATM arithmetic only; retain 16-bit API and skip bytes 6–7. Upper six bits of byte 7 remain unused. |
| `crc10-packed` | CRC-10/ATM with low eight check bits in byte 6 and high two in byte 7 bits 0–1. Reclaim byte 7 bits 2–7; CRC input includes byte 7 with bits 0–1 forced to zero. Mask only the stored check bits when validating. |
| `crc10-right-core` | Right-aligned 16-bit state, input byte shifted by two, polynomial `0x233`, feedback from bit 9, final `& 0x3FF`. Retain unused storage. |
| `crc10-right-packed` | Same right-aligned arithmetic with the protected settings packing of `crc10-packed`. |
| `crc10-aligned-core` | Left-aligned CRC-10 state returned without shifting. Store canonical CRC shifted left by six; leave unused bits zero. |
| `crc10-aligned-packed` | Left-aligned storage: CRC bits occupy byte 6 bits 6–7 and all of byte 7. Reclaim byte 6 bits 0–5, include byte 6 masked to `0x3F` in CRC input, and skip byte 7. Separate upload CRC also uses the left-aligned representation. |
| `crc8-core` | CRC-8/SMBUS accumulator with 16-bit API/caller/upload storage retained; skip bytes 6–7 and require byte 7 to be zero. |
| `crc8-byte` | Also narrow API, validator temporary, protocol temporary and upload CRC to eight bits. Keep byte 7 zero; reject nonzero expected-CRC high byte at BEGIN_WRITE. |
| `crc8-packed` | Narrow eight-bit implementation; reclaim all of byte 7 and include it in CRC input. Validate only byte 6 as stored CRC. Keep upload length three, with its separate CRC high byte required to be zero. |

CRC-10 uses a left-aligned 16-bit accumulator with `0x233 << 6` (`0x8CC0`),
byte injection at bit 8 and final shift right by six. This avoids per-bit
10-bit masking. The right-aligned alternative permits unused high accumulator
bits during shifting, since they cannot feed back into the low ten bits;
feedback tests bit 9 and the final mask discards them. The aligned-storage
alternative removes the final shift; this changes storage and transport
representation, not the underlying polynomial algorithm. Its unused low bits
are covered as settings in the packed form. All three are checked against an
independent input-bit reference with explicit width masking on each bit.
Reclaimed settings are storage/coverage probes only; no new sleep behavior is
credited to their size. Core-only results cannot be used as the integrated cost.

## Results and Validation

All twenty native builds pass the real 14,336-byte limit and the builder's
memory/startup/IRQ parameter checks. The table lists actual linked sizes, including
the builder's segment padding. Positive savings mean smaller than the same-pad
baseline; negative savings mean added code.

| Candidate | Six-Key Flash | Three-Key Flash | Flash Saving, Six/Three | Usable Reclaimed Settings Bits |
| --- | ---: | ---: | --- | ---: |
| `baseline` | 14,210 | 14,208 | 0 / 0 | 0 |
| `crc10-core` | 14,232 | 14,228 | -22 / -20 | 0 |
| `crc10-packed` | 14,274 | 14,272 | -64 / -64 | 6 |
| `crc10-right-core` | 14,226 | 14,224 | -16 / -16 | 0 |
| `crc10-right-packed` | 14,266 | 14,262 | -56 / -54 | 6 |
| `crc10-aligned-core` | 14,210 | 14,208 | 0 / 0 | 0 |
| `crc10-aligned-packed` | 14,254 | 14,250 | -44 / -42 | 6 |
| `crc8-core` | 14,192 | 14,188 | 18 / 20 | 0 |
| `crc8-byte` | 14,154 | 14,152 | 56 / 56 | 0 |
| `crc8-packed` | 14,124 | 14,122 | 86 / 86 | 8 |

The integrated CRC-8 candidate leaves 212/214 flash bytes free, versus baseline
126/128. The best integrated CRC-10 candidate leaves 82/86 bytes free. These
results include checksum computation, stored-check comparisons and upload
handling, but no new timeout selection, sleep behavior or marker/version changes.
Do not add these isolated savings to a different firmware parent without rebuilding.

Stack capacity remains 90/93 bytes for every candidate; there is no reduction.
PSEG remains 105 bytes. Ordinary XSEG remains 365/356 except for `crc8-byte`
and `crc8-packed`, where narrowing `uploadCrc` saves one byte: 364/355. Total
allocated external RAM, including 148 USB DMA bytes and the 134-byte absolute
active/runtime buffer, changes from 752/743 to 751/742 only for those two forms.
These are linker allocations and stack reserve, not runtime high-water measurements.

## Interpretation

CRC-8 provides both types of saving sought here: a complete protected settings
byte and 86 bytes of firmware space per pad in the integrated implementation.
Changing the accumulator alone yields only 18/20 bytes. Narrowing its consumers
and removing the obsolete stored high-byte requirement account for the remaining
integrated gain. Save-time byte readback, final full-image comparison, two-byte
marker invalidation/restoration and structural validation all remain intact.

CRC-10 does not save firmware flash in the tested forms. Its arithmetic still
requires a two-byte state. Keeping that state left-aligned in storage eliminates
conversion overhead and matches the baseline flash size when unused bits stay
zero. Once the six reclaimed bits are usable and CRC-covered, masking/injection
and stored-check comparisons add 44/42 bytes. This is a measured outcome for
these implementations, not a proof that every possible CRC-10 implementation
must be larger.

CRC strength remains a separate decision. No production CRC change has been
adopted, and these measurements do not establish hardware corruption rates.
For the next decision, CRC-8 is the measured option that improves both DataFlash
capacity and firmware headroom; a single-byte marker preserves CRC-16 but its
code-size effect has not been measured here. Borrowed version bits also remain
an alternative when only two or three new settings bits are needed.

## Validation and Preserved Artifacts

Every candidate passes the complete firmware host suites with preview enabled
and disabled, including configuration, actions, protocol/storage, USB, physical
holds, layer encoding, macros, timed actions, sleep/wake input, eight layout tests
and nineteen bootloader tests. Existing tests are adapted only for the changed
CRC reference/coverage and to preserve reclaimed settings while sealing images.
The first validation attempt exposed a missing `<stdint.h>` include in the new
test-reference header; it was corrected and all affected suites rerun successfully.

The [integrity probe](crc-integrity-probe.c) runs separately on both pad variants
for every candidate. It checks the standard `123456789` reference values, compares
production image CRCs with independent input-bit division on 1,000 random images
per variant, flips every single bit of valid images for both geometries, exhausts
all 64 or 256 settings values in packed candidates, rejects unsealed settings
changes, and uploads/readbacks/reloads every settings value. It also runs all
existing protocol regressions, including interrupted/failed saves. Eight-bit
uploads reject nonzero expected-CRC high bytes rather than truncating them.

Host/reference coverage does not execute the linked SDCC CRC machine code on
hardware. Native checks establish compilation, sizes and memory layout. No
hardware validation, release generation, flashing, deployment, active
configurator changes or frozen-archive changes occurred. The baseline and
candidate firmware sources come from the initially clean revision above;
investigation files were uncommitted during measurement and validation.

Durable artifacts are in [CRC Candidates](crc-candidates/): firmware patches,
test-adaptation patches, measured results, source/log checksums and validation
outcomes. Native assembly, maps, memory reports, temporary HEX files, complete
logs and generated source trees remain in
`/private/tmp/macropad-crc-investigation/`. The active firmware is unchanged.

Reproduce the complete investigation from this checkout with:

```sh
python3 protocol/build-crc-probes.py --host
```

Rerun only host/integrity validation of existing native source trees with:

```sh
python3 protocol/build-crc-probes.py --host --validate-only
```

Apply a preserved firmware patch only to an isolated copy of the stated source
revision. Adoption elsewhere requires measuring that checkout's own baseline,
an explicit compatible format transition, updated encoding/decoding and migration,
appropriate archive handling before active configurator changes, both native
geometries and complete host suites, and the final shared deployment gate.
