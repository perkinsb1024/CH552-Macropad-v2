# Header Repacking Target and Firmware Plan

Recorded October 13, 2026, on `experiment/v15-updated-header`.
Status: user-approved header target; firmware implementation has not started.
The user finalized marker ASCII `B` (`0x42`, for “board”) and retained format
version 15 because it remains under active development and unpublished.
Only one device runs the earlier provisional v15 firmware. The user will erase
it after this firmware work is complete; no deployed devices will require
compatibility with that firmware.
The user selected the three-bit **Chord Window**, five-bit chord count and
single-byte marker, and then selected windows from 20ms through 90ms.
The subsequent LED packing refinement puts transparency before the rainbow
fields, retaining their existing phase/speed shifts.

## Target Goal

Keep the image at 128 bytes and the header at nine bytes, with a 119-byte
payload and layers beginning at byte 9. Preserve existing action, layer, chord,
timed-action, string and macro record layouts. Repack only the header and retain
CRC16-CCITT-FALSE. Allocate five bits for new **Auto-Sleep** settings, leaving
three reserved bits in that byte; the five settings' meanings remain undecided.

This supersedes the earlier two-bit-window and CRC-reduction alternatives.
The [CRC Investigation](dataflash-header-crc-investigation.md) preserves their
measurements; the [Auto-Sleep Extension Plan](auto-sleep-extension-plan.md)
preserves candidate sleep behaviors and timeout feasibility.

## Approved Header Layout

Bit numbers run from 0, the least significant bit, to 7. Multibyte values remain
little endian. Reserved bits are zero in canonical images; target firmware
rejects nonzero reserved bits.

| Byte | Field | Encoding and Validation |
| --- | --- | --- |
| 0 | Marker | ASCII `B` (`0x42`, for “board”), distinct from legacy `M` (`0x4D`). Zero is invalid. |
| 1 | Format version | `15`, a full eight-bit version with no borrowed setting bits. |
| 2 | Hardware and layers | Bit 0: physical variant (`0` = six keys, `1` = three keys). Bits 1–3: layer count minus one. Bits 4–6: startup layer. Bit 7: reserved. |
| 3 | **String**-pool length | Bit 0: reserved. Bits 1–7: used string-pool bytes, 0–127; section bounds still limit actual capacity. |
| 4 | Number of **Timed Actions** and chord count | Bits 0–2: number of saved timed-action records, 0–4. Bits 3–7: chord count, 0–31; bounds and unique chord identifiers still apply. |
| 5 | **Chord Window** and LED settings | Bits 0–2: window selector. Bit 3: transparent black key LEDs (`0` = opaque, `1` = transparent). Bits 4–5: rainbow phase spacing. Bits 6–7: rainbow speed. |
| 6 | **Auto-Sleep** settings | Bits 0–4: allocated for the future settings, meanings pending. Bits 5–7: reserved. |
| 7–8 | CRC | CRC16-CCITT-FALSE, low byte first; polynomial `0x1021`, initial value `0xFFFF`, no reflection, final XOR `0`. |

CRC covers bytes 0–6 followed by 9–127, excluding only stored CRC bytes 7–8.
This includes the marker, version, all settings and reserved bits, and unused
payload bytes. CRC width and error-detection strength are unchanged.

All fields fit within single bytes. The hardware bit is the first bit after
the version byte. **String**-pool length → number of **Timed Actions** → chord
count form an uninterrupted 15-bit run from byte 3 bit 1 through byte 4 bit 7.
The **Chord Window** immediately follows in byte 5 bits 0–2. Transparency and
both rainbow settings share byte 5. Five bits remain reserved overall: byte 2
bit 7, byte 3 bit 0, and byte 6 bits 5–7.

The saved number of **Timed Actions** is configuration metadata, not elapsed
runtime timer state. It counts only the four available user-defined records;
the built-in **Auto-Sleep** timer does not increment it or write DataFlash.

## Chord Window Encodings

| Selector | **Chord Window** |
| --- | --- |
| `000` | 20ms |
| `001` | 30ms |
| `010` | 40ms |
| `011` | 50ms |
| `100` | 60ms |
| `101` | 70ms |
| `110` | 80ms |
| `111` | 90ms |

For configured chords, duration is `20 + 10 * (byte5 & 7)` milliseconds.
No selector means **Off**. A chord count of zero disables chord recognition;
the firmware accessor should return zero in that case so ordinary key presses
do not wait for an unused window. Every nonzero chord count enables recognition
with its selected window. Keep the existing timing boundary: the second press
must arrive strictly before expiry; at expiry the pending single-key action
resolves. Preserve early release, precedence and timestamp-wrap behavior.

## Remaining Header Field Encodings

| Field | Decode |
| --- | --- |
| Physical variant | `byte2 & 1` |
| Layer count | `((byte2 >> 1) & 7) + 1` |
| Startup layer | `(byte2 >> 4) & 7` |
| **String**-pool length | `byte3 >> 1` |
| Number of **Timed Actions** | `byte4 & 7` |
| Chord count | `byte4 >> 3` |
| Transparent black key LEDs | `(byte5 & 0x08) != 0` |
| Rainbow phase spacing | `(byte5 >> 4) & 3` |
| Rainbow speed | `byte5 >> 6` |
| Allocated **Auto-Sleep** bits | `byte6 & 0x1F` |

Layer limits remain 1–5 on six-key pads and 1–7 on three-key pads. Startup layer
must be less than layer count. Rainbow phase codes retain **0°**, **30°**,
**60°** and the existing 150° scattered-color behavior. Speed codes retain
**Extra Fast**, **Fast**, **Slow** and **Extra Slow**. Transparency semantics
retain their current meaning; only header positions change.

Phase and speed retain their existing shifts of four and six. Speed occupies
the top two bits, so shifting by six already limits its value to 0–3; an
additional mask is unnecessary. Phase still needs `& 3` to exclude speed bits.
Transparency uses mask `0x08`, below both rainbow fields.

## Why Five Chord-Count Bits Preserve Capacity

Five bits encode 0–31 records. A one-layer six-key profile has only 30 unique
valid chord identifiers: 15 layer-specific and 15 global. With two or more
six-key layers, remaining image space permits at most 25 records. A one-layer
three-key profile has only six identifiers; with two or more three-key layers,
remaining image space permits at most 29 records, even before identifier limits.
Timers, strings and macros can only reduce these bounds. Therefore no current
valid profile needs a count above 30.

This proof includes global chords, rather than relying on the layer-specific
capacity tables alone. It depends on current hardware, record sizes and image
size; reevaluate it if those change. Five-bit encoding does not authorize 31
records where geometry, uniqueness or capacity checks reject them.

## Firmware Implementation Sequence

1. Establish the baseline. Record source revision and relevant working changes,
   then run both native builds and the existing host suites with preview enabled
   and disabled. Current measured firmware is 14,210/14,208 flash bytes with
   126/128 free and 90/93 bytes of stack reserve, six-/three-key respectively.
   These are historical measurements to confirm, not promised new results.
   Use temporary outputs and preserve checked-in releases.

2. Use the finalized format identification: marker ASCII `B` (`0x42`) and
   configuration format 15. The distinct marker identifies this repacking of
   the unpublished, actively developed v15 format; earlier `MP`/v15 images keep
   their original interpretation when imported. Define marker, header offsets,
   masks and shifts in `src/config.h`; retain the full version byte and transport
   version 1. Preserve the earlier header specification as development history
   when updating the complete v15 reference to the implemented target.

3. Repack validation and accessors in `src/config.c`. Check the new marker,
   version, hardware, reserved bits and layer/startup bounds. Decode the contiguous
   timed-action count, shifted pool length and five-bit chord count. Keep the
   16-bit section-end calculation and all action/string/macro/chord validation.
   Update every repeated count/pool calculation, including chord lookup and
   timed-action/string offsets. Decode all eight chord windows, with the zero-count
   fast path. Change CRC coverage and comparisons to bytes 7–8. Section starts
   and action numbering remain unchanged because the header and record sizes
   remain unchanged.

4. Update LED header consumers in `CH552_Universal_Macropad.ino`. Move saved phase,
   speed and transparency reads to byte 5. Cover startup/application, preview,
   restoring configured settings, runtime LED commands and rendering. Mask
   the phase selector with `(byte5 >> 4) & 3`; speed uses `byte5 >> 6` without an
   additional mask because it occupies the top two bits. Retain the existing
   phase/speed shift constants and change the saved transparency mask to `0x08`.
   Distinguish saved-header packing from preview-packet
   and LED-action encodings; those protocol encodings need no change.

5. Change DataFlash validity handling in `src/storage.c`. Clear and verify only
   byte 0 before body writes. Save and individually verify changed bytes 1–127,
   including version and CRC; restore the new marker last. Keep unchanged-image
   retry detection and final comparison of all 128 bytes. This prevents ordinary
   interrupted saves from activating partial images but does not provide rollback.
   Update `pio-platform/erase_config.c` to invalidate and verify byte 0 without
   treating byte 1, now the version, as another marker. Invalidating byte 0 also
   invalidates legacy `MP` images.

6. Update `src/protocol_firmware.c`. GET_INFO advertises the target format;
   READ_FLASH continues returning all original stored bytes, including incompatible
   images. Startup and COMMIT_WRITE accept only the target format and compare
   its stored CRC at bytes 7–8. Retain the separate 16-bit expected upload CRC,
   ordered staging, retries, timeout/reset handling, complete-image validation
   and activation only after a verified save. BEGIN_WRITE and other USB packet
   layouts remain unchanged.

7. Keep the initial checkpoint focused on the header. Allocate byte 6 but retain
   existing per-layer enablement, fixed 30-minute timeout, consumed wake input
   and layer reminder. Until the five new settings are defined, use byte 6 value
   zero in fixtures and reject nonzero values in this provisional checkpoint.
   This is a temporary implementation constraint, not the final five-bit encoding.
   Implement the new sleep behaviors separately after defining their bit meanings,
   defaults and interactions. No global-enablement conversion is implied by this
   header decision.

8. Validate and measure the completed header checkpoint, then record individual
   and combined flash/RAM/stack changes. Preserve or increase 90/93-byte stack
   reserve; explicitly report any reduction. Consult `potential_optimizations.md`
   before choosing optimizations and append every measured attempt there. Preserve
   candidate sources/patches and all existing features. Any later feature cut or
   degradation needed to fit requires the project approval process.

## Compatibility and Later Migration

Keep firmware migration out of the initial implementation: legacy profiles remain
readable through READ_FLASH but inactive until a target-format profile is uploaded.
This retains the current update model and avoids adding a legacy decoder to tight
firmware flash. No automatic DataFlash rewrite occurs on boot or firmware update.

The later configurator should identify layout from the marker first: legacy `MP`
uses version byte 2; `B` uses version byte 1. This includes earlier `MP`/v15
development images; both layouts carry version 15, so the version alone is
insufficient. Validate the source CRC
with the source layout, decode to semantic settings/actions, and then encode and
seal the target layout. Reordering header bytes without source decoding and CRC
validation is insufficient.

GET_INFO continues advertising format 15 and transport 1. Supporting earlier
provisional v15 firmware or detecting it in the editor is unnecessary: the user
will erase the sole device running it after this firmware work is complete.
Marker-based source decoding remains relevant to any retained earlier image
files and to published legacy formats.

Legacy windows are 0–75ms in 5ms steps; the target is 20–90ms in 10ms steps.
Matching 20ms–70ms values can migrate exactly. Smaller values, intermediate values
and 75ms require a rounding/clamping policy. A zero window with saved chords
previously disabled them and cannot preserve that behavior merely by choosing a
new selector. The user approved nearest-10ms rounding with ties upward and clamping to
20ms–90ms, with a migration notice whenever a saved chord window changes.
An old zero window with saved chords retains all bindings and requires explicit
window selection before saving; migration must not silently activate them. Empty chord collections need no window conversion
to preserve recognition behavior.

The outgoing published v14 format is already frozen from finalized source
`0fb61321d64343b78ebacfb892c456101b15bac8` in
`webapp/public/versions/format-v14/`, with recorded source validation, provenance
and checksums as required by [Frozen Configurators](../webapp/archives/README.md).
The archive index and active editor routing include it; `npm run verify:archives`
passed on October 13, 2026. Preserve that archive unchanged. The current v15
editor already supports per-layer **Auto-Sleep**; this task continues its
development rather than advancing to v16 or freezing the provisional v15 layout.
Later work must update the
encoder, decoder, CRC helpers, simulator, JSON/drafts, device comparison/routing,
window controls and migration. Produce a complete standalone target-format
v15 reference; preserve the earlier header specification as development history. Run `npm run build`
after web changes and the final `npm run verify:deploy` gate after integration.
These follow-ups are outside this documentation-only task.

## Required Firmware Validation

- Verify header decoding/round trips and zero reserved bits on both variants;
  reject timer counts 5–7, unsupported layer counts/startup layers, wrong marker,
  version/hardware and malformed section bounds. Preserve the allowed character,
  action, macro and sorted unique chord-ID checks.
- Verify all eight windows at 20ms–90ms, immediately before/at/after expiry,
  uint16 timestamp wrap, early release, simultaneous presses, global/layer-specific
  precedence and the zero-chord immediate-input path. Adapt tests that previously
  used window zero with configured chords instead of weakening their purpose.
- Exhaust geometries and layer counts for chord-capacity bounds; demonstrate
  valid 30-chord six-key images, existing exact-capacity profiles, and rejection
  of structurally impossible counts. Test sections with zero/maximal timers and
  string/macro tails so shifted metadata cannot move their offsets incorrectly.
- Check CRC against an independent reference over bytes 0–6 and 9–127. Verify
  corruption detection across every single image bit, stored CRC bytes, reserved
  fields, allocated settings and unused tail. Keep the full 128-byte save comparison.
- Exhaust rainbow phase/speed and transparency combinations in saved and preview
  paths; verify configured-setting restores, speed-table bounds, startup and runtime
  LED commands with the new masks. Preserve renderer output for equivalent settings.
- Interrupt/fail every write position, including marker invalidation/restoration,
  version, body and CRC. Verify unsuccessful saves never activate the new image,
  interruptions after successful invalidation and before final marker restoration
  leave byte 0 invalid, unchanged retries perform no writes, and configuration
  erasure rejects both marker families. Keep final full-image verification even
  after marker restoration; do not claim the marker alone guarantees correctness
  under arbitrary hardware faults.
- Run complete host regressions with and without preview, both native builds
  using the real 14,336-byte flash limit, and unchanged layout/startup/IRQ parameter
  checks. Record the tested source and working-tree state. Hardware validation is
  outstanding until actual hardware results are provided; no per-build stack
  high-water requirement is added.

## Scope of This Task

This task records the target and implementation plan only. It does not implement
firmware, assign the five sleep-setting bits, create a release, flash hardware,
change the active configurator or publish a deployment. Marker `B` and version 15
are finalized; legacy window migration is defined above, while the five sleep-setting meanings
remain undecided.
