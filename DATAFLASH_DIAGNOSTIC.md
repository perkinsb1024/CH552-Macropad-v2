# DataFlash Diagnostic Capture Plan

## Purpose and Scope

Create an investigation firmware that records the first trapped event in the
128 logical DataFlash bytes normally used for the profile. The record replaces
the profile, survives application restarts, and remains until a valid profile
is uploaded. Firmware capture, recovery, an artifact builder, and a dump
parser are implemented. The default artifact build uses the compact schema-1
layout described below to fit the CH552 application area.

The diagnostic HID bootloader command (`0x72`) is disabled in this test build.
Retain the normal HID configuration transport, startup encoder-button
bootloader entry, and runtime encoder-hold bootloader entry.

## Agreed Device Behavior

1. With a normal saved profile, the first trapped event calls
   `logDiagnostics(reason, site, detail)` before bootloader cleanup changes
   the evidence.
2. If no diagnostic reservation marker exists, freeze and capture state,
   replace the profile with the diagnostic record, verify the writes, set all
   LEDs red, and hand control to the bootloader.
3. If a reservation marker already exists, preserve the entire DataFlash
   record, including an incomplete record. Do not retry or improve it.
4. On subsequent application startup, a diagnostic reservation marker means
   invalid-config recovery mode: blink the normal red error LED, run the HID
   configuration transport, and accept a replacement profile. Do not
   automatically capture again or enter the bootloader.
5. Holding the encoder button during startup still enters the bootloader.
   An existing diagnostic record remains untouched. Runtime encoder-hold
   entry also remains available under the existing permission rules,
   including recovery mode.
6. A successful valid-profile upload replaces the record and restores normal
   operation. Download the diagnostic record before uploading the profile.

The existing-record exception must apply to later configuration reapplication
and main-loop invalid-state checks as well as startup. Recovery must not call
configuration accessors on diagnostic bytes as if they described a profile.
Initialize recovery LEDs and input handling from safe defaults.

A blank, incompatible, or otherwise invalid profile without a diagnostic
marker also triggers a first capture. Install with a known-good profile if
the objective is to observe a later intermittent fault.

### Reading Diagnostics Through the Configurator

After application startup enters invalid-config recovery mode, **Read from
device** retrieves the same 128 logical DataFlash bytes as the bootloader
uploader. The existing configurator rejects the diagnostic signature as a
missing profile and loads a starter profile into the editor without writing
it to the device. **Export raw flash bytes** downloads the original bytes for
the diagnostic decoder. Reading and exporting preserve the record;
**Save to device** replaces it with the editor's profile.

The bootloader uploader remains an alternative while the device is actually
in bootloader mode. The configurator requires the application HID interface,
so it cannot read the device while the bootloader owns USB. A diagnostic-aware
configurator message or integrated decoder would improve presentation but is
not required for raw export or profile recovery.

## Record Identification and Write Integrity

Use the four-byte signature `D7 44 46 A6`. Byte zero, `0xD7`, is the reservation
marker. It differs from the normal profile's first byte, `0x4D` (`M`). The
remaining signature bytes identify the record more strongly for decoding.

Firmware preservation depends on byte zero alone. Otherwise power loss while
writing the remaining signature could cause the next startup to overwrite
the first capture. A damaged profile that coincidentally starts with `0xD7`
therefore enters recovery conservatively; the decoder must not identify it
as a verified diagnostic record without the other checks.

Byte four is `0x00` while writing and `0xA5` when complete. A record is verified
only when the complete signature, supported schema, completion marker, and
CRC all agree. Neither a completion marker nor a magic byte alone establishes
that the payload is trustworthy.

The compact build verifies every byte immediately after writing it, then
verifies the completion-byte write. The parser checks the complete record's
CRC after download. The detailed capture additionally recomputes the saved
record CRC on the device. Preservation always applies to incomplete and
corrupt reserved records, regardless of parser verification.

Use CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, no
reflection, no final XOR. Process offsets 0 through 127 in order, skipping
offsets 14 and 15. Compute against the final image with byte four equal to
`0xA5`. Store the CRC little-endian at offsets 14 and 15.

## Schema 1 Layout

The table below specifies the detailed layout. Byte 41 bit 7 selects the
compact layout used by the default builder. Its replacements are specified
immediately after the table; those bytes must not be decoded as detailed
fields.

All offsets are decimal and inclusive. Multibyte integers are little-endian.
Capture raw state without repairing, masking, or clamping suspicious values,
except where a field explicitly packs Boolean inputs. Missing optional
fields contain `0xFF`; feature and context fields identify their availability.
Unused physical input bits are zero. Layer and input indices remain zero-based
unless the original runtime variable uses another encoding.

| Offsets | Bytes | Contents |
| --- | ---: | --- |
| 0–3 | 4 | Signature: `D7 44 46 A6` |
| 4 | 1 | Completion: `00` pending, `A5` complete |
| 5 | 1 | Record schema: `01` |
| 6 | 1 | Physical variant: `00` six keys, `01` three keys |
| 7 | 1 | Feature flags, defined below |
| 8–9 | 2 | Diagnostic build ID, mapped to retained source, HEX, and linker map |
| 10 | 1 | Reason code |
| 11 | 1 | Capture-site ID, mapped to a source location in the build manifest |
| 12–13 | 2 | Reason-specific detail, defined below |
| 14–15 | 2 | Record CRC |
| 16–19 | 4 | Uptime in milliseconds at capture |
| 20 | 1 | Stack pointer at the instrumented capture entry |
| 21–24 | 4 | Raw entry `PSW`, `IE`, `IP`, and `PCON`, respectively |
| 25 | 1 | Linked stack base |
| 26 | 1 | Stack high-water address, only with stack instrumentation enabled |
| 27 | 1 | Number of valid stack-window bytes, 0–4 |
| 28–31 | 4 | Stack window ending at entry SP, in ascending RAM-address order |
| 32–40 | 9 | Original `activeConfig[0..8]`, including its stored CRC |
| 41 | 1 | State flags, defined below |
| 42 | 1 | Configuration validation failure category |
| 43 | 1 | First offending configuration byte offset, or `FF` if not applicable |
| 44–45 | 2 | Computed active-image CRC, before DataFlash modification |
| 46–47 | 2 | Computed saved-image CRC, before DataFlash modification |
| 48 | 1 | Raw button-state mask |
| 49 | 1 | Debounced button-state mask |
| 50 | 1 | Action-engine `inputDown` |
| 51–52 | 2 | Raw `P1` and `P3` port values |
| 53–54 | 2 | `encoderState` and signed `encoderMovement` |
| 55 | 1 | `allowRunBootloader`, encoded as 0 or 1 |
| 56–57 | 2 | `encoderPressedMs` |
| 58–59 | 2 | Encoder-button `rawChanged[NUM_LEDS]` |
| 60–61 | 2 | `pendingInput` and `pendingLayer` |
| 62–63 | 2 | `pendingSince` |
| 64–67 | 4 | `baseLayer`, `effectiveLayer`, `previousLayer`, `oneShotReturnLayer` |
| 68–70 | 3 | `currentFirst`, `currentSecond`, `phase` |
| 71–74 | 4 | `macroNext`, `macroStart`, optional `macroRepeat`, `stringIndex` |
| 75–76 | 2 | Action `deadline` |
| 77–80 | 4 | `tempFirst`, `tempSecond`, `tempOn`, `tempMouse` |
| 81 | 1 | `persistentMouse` |
| 82–84 | 3 | Action FIFO `eventHead`, `eventTail`, `eventUsed` |
| 85–87 | 3 | `droppedButtons`, `droppedRotation`, `consumerOwner` |
| 88–103 | 16 | Raw `eventData[8][2]`, in physical slot order |
| 104 | 1 | `UsbConfig` |
| 105 | 1 | USB flags, defined below |
| 106–109 | 4 | USB `reportHead`, `reportTail`, `reportCount`, `reportGeneration` |
| 110–111 | 2 | `protocolState` and `uploadState` |
| 112–115 | 4 | `ledSettings[0..3]` |
| 116–119 | 4 | `previewOptions`, `layerIndicatorPhasesLeft`, `layerIndicatorDeadline`, `rainbowHue` |
| 120–127 | 8 | Reason-specific context block, defined below |

This allocates all 128 bytes. It prioritizes encoder-entry evidence and queued
actions over a broad RAM dump. It cannot retain the full original profile,
full USB report queue, every timer, or the full six-key LED buffer. Retain the
exact test profile externally for comparison. Matching CRCs are evidence, not
proof that the complete images match.

### Compact Layout Replacements

To fit flash, the approved test build disables timed actions and reduces
capture detail. It also retains the existing investigation's disabled live
color preview and **Type text**. Normal firmware defaults remain enabled.
Profiles containing disabled actions are rejected; the retained original
reproduction profile has no timed actions or text actions.

| Offsets | Compact Contents |
| --- | --- |
| 20–25 | Entry SP, PSW, IE, IP, PCON, and linked stack base are retained |
| 26–31 | High-water address is `FF` unless enabled; stack-window count is zero and its bytes are `FF` |
| 41 | Bits 0–2 retain validity/reset flags; bit 4 retains preview-active state; bit 7 is one; other state flags are unavailable |
| 42–43 | `FF`, except byte 43 holds the observed readback byte for reason `09` |
| 44–45 | Computed active-image CRC is retained |
| 46–47 | `FF`; saved-image computed CRC is unavailable and byte 7 bit 5 is zero |
| 48–59 | Button masks, input-down mask, ports, encoder state/movement, boot permission, press time, and raw-change time are retained |
| 60–103 | Raw internal RAM addresses `0x50` through `0x7B`, in ascending order, captured in the assembly entry shim |
| 104–111 | USB/protocol state is retained |
| 112–127 | All eight raw action FIFO slots, two bytes per slot, in physical slot order, captured in the entry shim |

All other table entries retain their detailed meanings. The compact record
does not contain structured pending-input/action state, LED state, validation
failure categories, or the detailed reason-specific context block. Its raw
RAM window often includes layer, playback, and FIFO-count variables; their
addresses depend on the exact linked build. Use that build's manifest to
label captured bytes rather than assuming fixed variable addresses.

Host register-stub tests cannot capture actual CH552 internal RAM. They use
`FF` for this window and clear byte 7 bit 6. The parser marks it unavailable.
The physical firmware sets that bit and captures the window before calling
any C logger functions.

### Packed Flags

- Byte 7: bit 0 stack high-water instrumentation present; bit 1 macro repeat
  compiled in; bit 2 scroll acceleration compiled in; bit 3 color preview
  compiled in; bit 4 active CRC available; bit 5 saved CRC available;
  bit 6 entry register/stack snapshot available; bit 7 uptime available.
- Byte 41: bit 0 `flashValid`; bit 1 `activeConfigValid`; bit 2 `resetPending`;
  bit 3 `layerSelectionPending`; bit 4 `colorPreviewActive`; bit 5
  `consumerReleasePending`; bit 6 `tempReady`; bit 7 compact capture layout.
- Byte 105: bit 0 `UpPoint1_Busy`; bit 1 `configWaiting`; bit 2 `configTurn`;
  bits 3–7 reserved, zero.
- Button masks: physical keys occupy bits 0 through key-count minus one;
  the encoder button occupies bit 6 for both hardware variants.

Capture a separate early startup snapshot if actual reset-cause evidence is
available and useful on this hardware. `PCON` in this schema is a raw register
snapshot, not a claimed reset-cause decoder.

### Reasons and Context

| Code | Reason | Detail at 12–13 | Context at 120–127 |
| --- | --- | --- | --- |
| `01` | Invalid saved configuration at startup | Failure category and offending offset | Original saved configuration bytes 0–7 |
| `02` | Active validity flag unexpectedly false | Observation-site state, or zero | LED context |
| `03` | Startup encoder-button bootloader entry | Raw startup button sample, then zero | LED context |
| `04` | Runtime encoder-hold bootloader entry | Elapsed hold time, modulo 65536ms | LED context |
| `05` | Invalid runtime layer state | Offending layer and validated layer count | LED context |
| `06` | Invalid action FIFO state | Offending value and field ID | Trigger context |
| `07` | Invalid macro cursor/action state | Offending value and field ID | Trigger context |
| `08` | Invalid protocol or USB FIFO state | Offending value and field ID | Trigger context |
| `09` | Configuration save/readback failure | Failed logical address and expected byte | Observed byte, then up to seven relevant staged bytes |
| `0A` | Optional active-image integrity failure | Previously expected active CRC | Up to eight bytes around a known mismatch, otherwise LED context |
| `0B` | Invalid timer state | Timer index and offending field ID | Timer context |

The compact build captures reasons `01` through `06`, `08` for USB FIFO bounds,
and `09`. It checks action FIFO head/tail/count and effective-layer bounds
before ordinary action queuing and polling, and USB FIFO head/tail/count
before report polling. Detailed macro/phase/protocol/encoder checks and timer
checks are omitted. Reason `0A` is reserved; periodic integrity trapping is
not implemented in the shipped capture build. The active CRC remains useful
for offline comparison against the original header and retained profile.

For compact captures, invalid-startup detail is zero; action/USB FIFO detail
is zero; layer detail contains the effective layer and layer count. Reasons
`03`, `04`, and `09` retain the table's detail encodings. Site IDs are stable:
`01` startup validation, `02` configuration reapplication, `03` main-loop
validity observation, `04` startup button, `05` encoder hold, `06` other
`enterBootloader()` caller, `08` action-state check, `0C` USB FIFO check,
and `0D` configuration save. The parser includes the complete site map.

LED context is `lastLayer`, `rainbowChanged`, then the first two LEDs' six
pre-trap GRB bytes. It records the buffer before all-red feedback is written.
It does not prove what the physical LEDs displayed.

Trigger context is the triggering action's two bytes, rotation argument,
input argument, and four bounded surrounding source/queue bytes. Define the
source and starting offset per capture site in the build manifest. Unavailable
bytes are `FF`; never index memory using an unchecked suspect value.

Timer context is timer index, `timedClock`, `timedAge`, `timedHigh`,
`timedFraction`, `timedPending`, and the timer's two-byte action. Validate the
index before reading timer arrays. An invalid index leaves the dependent
fields `FF`. The current detailed implementation leaves timer action bytes
unavailable; compact builds have no timers. Detailed trigger rotation/input
arguments are also unavailable, and its four surrounding bytes are the two
FIFO slots starting at the captured tail, wrapping at slot seven. These
exceptions are represented explicitly by the parser.

Validation categories distinguish header/signature, version, variant, layer
layout, capacity/counts, action encoding, chord encoding/order, timer encoding,
text encoding, macro encoding, and CRC. Assign stable numeric values during
implementation and retain them in the decoder. Record the first failed check
without running a second validator that might change the evidence.

## Capture and Write Sequence

1. Enter a small assembly capture shim at each instrumented site. Save entry
   SP and registers before ordinary logger calls change them. The captured
   SP includes the shim call's return address; document that convention in
   the decoder. Copy at most four valid stack bytes without reading below
   the linked stack base or wrapping the address.
2. Disable interrupts and snapshot runtime evidence before action cleanup,
   report polling, LED changes, or flash writes. Capture uptime from a safe
   timer snapshot or already sampled clock; do not call an interrupt-dependent
   delay after disabling interrupts. Check for an existing reservation marker
   before any DataFlash mutation.
3. Build the record in external RAM, reusing `stagedConfig` after
   capturing any relevant upload evidence. Do not allocate a 128-byte local
   array on the stack. Freeze the protocol so its ISR and main-loop paths
   cannot modify the buffer. Compute configuration CRC evidence only after
   copying volatile runtime state.
4. Write and verify byte zero first. Set byte four to pending, then write the
   remaining signature, metadata, payload, and final-image CRC. There is no
   preliminary full erase. Do not use `storageSave()`, which restores the
   normal profile signature.
5. Verify each body byte while completion is pending. Write and verify `A5`
   at byte four last. Detailed capture also checks the final saved CRC;
   compact capture relies on byte readback and the parser's CRC check. A stale
   completion byte left by an interrupted early write must never count as a
   valid record without the CRC and signature checks.
6. Set every LED red using the safe physical LED count, detach application
   USB, and enter the bootloader through a minimal handoff. Avoid
   `actionsClear()`, `actionsPoll()`, and report draining before capture.

Bound every write attempt and verification loop. On failure, preserve whatever
was written and proceed to red feedback and bootloader entry. Do not invoke
the logger recursively for its own write failure. If the reservation byte
itself fails to persist, preservation across restart cannot be guaranteed.
Power loss before that first successful write also cannot preserve the event.

Stack high-water capture is optional and only valid with the existing startup
fill instrumentation. Its scan includes logger calls made before the scan;
it is not a separate measurement of stack use just before the trap. Inspect
generated assembly and linker allocations for
both variants. Prefer preserving stack capacity; explicitly report any
reduction below the project's 75-byte six-key and 78-byte three-key baselines.

## Capture Checks and Limits

Add checks at startup, bootloader call sites, configuration reapplication,
and before runtime indices or counts are used. Check layer bounds, action and
USB FIFO bounds, macro cursor legality, protocol state, and timer bounds.
Account for valid sentinels, empty macro terminators, and intermediate states;
checks must only run where their invariants actually hold.

Ordinary rejected uploads, malformed HID requests, USB resets, report
backpressure, and intentional queue drops are not automatic traps. Count or
snapshot them when useful. Keep periodic active-configuration CRC checking
optional because it changes timing. Expected CRC state must update after a
successful profile upload.

Faults must reach an instrumented path to be captured. Arbitrary control-flow
corruption, an unusable stack, a hang, or sudden loss of power may prevent
capture. Keep this build close to the reproduction firmware and retain exact
build artifacts so recorded addresses and field availability can be decoded.

## Building, Reading, and Parsing

Build retained artifacts for both pad variants with:

```sh
python3 tools/investigation/build_dataflash.py
```

The tool prints its new directory under `/private/tmp/`. It saves source,
the build flags, HEX files, linker maps, memory reports, the parser, the
target builder, and a manifest. It builds without uploading or changing
`releases/`. Default build ID 10 retains the existing USB helper parameter
declarations; `--fix-usb-overlap` selects corrected declarations and build ID
11. Instrumentation changes the call graph and memory layout even with the
original declarations, so this is not a binary-matched reproduction of the
earlier firmware.

The optional `--stack-test`, `--with-text`, and `--full-capture` flags are
explicit experiments and may exceed flash capacity. The builder rejects an
oversized image; it does not silently drop additional features. It verifies
the assembly capture prefix against linked HEX instructions and records
stack capacity. A manifest build-ID/variant match helps select addresses;
it does not authenticate which firmware was flashed.

To install a default artifact, select the correct physical pad variant in
the browser firmware installer and drop that variant's local `firmware.hex`
file into its local-file area. Use the encoder or hardware bootloader entry;
this capture firmware rejects **Enter bootloader via HID**. Firmware upload
alone does not arm or clear a diagnostic record: upload a valid profile to
replace an old record. Remove disabled actions from the test profile first.

After a trap, download DataFlash in the bootloader uploader, or restart the
application and use **Read from device** followed by **Export raw flash bytes**
in the configurator. Parse either tool's 128-byte `.bin` dump with:

```sh
python3 tools/investigation/parse_dataflash.py /path/to/macropad-flash.bin
python3 tools/investigation/parse_dataflash.py /path/to/macropad-flash.bin --json --manifest /path/to/artifacts/manifest.json
```

The parser also accepts a file containing the configurator's copied hex
string or whitespace-separated hex bytes. It reports signature, schema,
completion, and CRC status; incomplete/corrupt fields are marked tentative.
Exit status is zero for a verified record with a matching manifest when
supplied, two for an unverified record or manifest mismatch, and two with an
argument error for malformed input. Keep the original dump even if incomplete.

With the matching manifest, compact captures also show the captured byte
at each named internal-RAM symbol in the `0x50`–`0x7B` window. This is a raw
byte view, including the first byte of any multibyte symbol; use the map and
adjacent raw bytes for full-width values. FIFO slots are shown in physical
order; their logical order uses the captured head/tail/count when available.

## Automated Validation and Hardware Follow-Up

Run the firmware and parser checks with:

```sh
python3 tests/run_host_tests.py
python3 tests/run_diagnostic_tests.py
```

The diagnostic suite exercises both pad variants and both capture layouts,
reads the saved record through the real HID protocol handler, restores a
profile, and simulates capture interruption after every byte write. It checks
write failure, first-record preservation, normal rejection of opcode `0x72`,
action/layer traps, the real USB FIFO trap, and parser corruption/hex handling.
Generated C records must pass the Python parser's independent CRC check.

Default builds measured 14,330 bytes of flash and 87 bytes of stack reserve
for six keys, and 14,328 bytes of flash and 90 bytes of stack reserve for three
keys. The 14,336-byte application limit leaves 6 and 8 bytes, respectively.
Both stack reserves exceed the project's 75/78-byte baselines. The manifest
and linked memory reports are the authority for a particular build.

Hardware testing remains necessary; host stubs cannot establish physical LED
output, USB enumeration, flash behavior during real power loss, or the original
glitch's cause. Software implementation and automated checks are complete;
the following checklist separates that work from physical validation:

1. Completed: schema, assembly shim, bounded writer, decoder, signature
   recovery, reason-coded capture sites, and compact invariant checks.
2. Completed: byte-write interruption/failure tests, record preservation,
   CRC and decoding checks, HID reads and profile replacement, and rejection
   of the removed HID bootloader command.
3. Completed: both capture builds and both ordinary firmware builds using
   temporary outputs, with linked memory checks and capture-shim verification.
   Checked-in release artifacts are preserved.
4. Hardware follow-up: deliberately trigger startup and runtime bootloader entry,
   invalid saved configuration, and a controlled invariant fault. Download
   and decode each record before replacing the profile.
5. Hardware follow-up: verify that an existing complete or incomplete record survives bootloader
   entry, power cycles, USB resets, and configuration reapplication. Confirm
   subsequent application startup blinks the error LED and accepts a valid
   profile through HID. Verify recovery after an interrupted profile upload.
6. Hardware follow-up: confirm all-red feedback and actual bootloader enumeration separately,
   then run the intermittent-fault workload with a retained known-good profile.

The configurator and uploader need no changes to export the raw record or
restore a profile. No release-generation command is part of this workflow.
