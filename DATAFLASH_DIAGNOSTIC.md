# DataFlash Diagnostic Capture Plan

## Purpose and Scope

Create an investigation firmware that records the first trapped event in the
128 logical DataFlash bytes normally used for the profile. The record replaces
the profile, survives application restarts, and remains until a valid profile
is uploaded. This document is a proposed implementation and record format;
the firmware does not implement it yet.

Remove the diagnostic HID bootloader command (`0x72`) from this test build.
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

Use CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, no
reflection, no final XOR. Process offsets 0 through 127 in order, skipping
offsets 14 and 15. Compute against the final image with byte four equal to
`0xA5`. Store the CRC little-endian at offsets 14 and 15.

## Proposed Schema 1 Layout

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

### Packed Flags

- Byte 7: bit 0 stack high-water instrumentation present; bit 1 macro repeat
  compiled in; bit 2 scroll acceleration compiled in; bit 3 color preview
  compiled in; bit 4 active CRC available; bit 5 saved CRC available;
  bit 6 entry register/stack snapshot available; bit 7 uptime available.
- Byte 41: bit 0 `flashValid`; bit 1 `activeConfigValid`; bit 2 `resetPending`;
  bit 3 `layerSelectionPending`; bit 4 `colorPreviewActive`; bit 5
  `consumerReleasePending`; bit 6 `tempReady`; bit 7 reserved, zero.
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
fields `FF`.

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
3. Build the record in external RAM, preferably reusing `stagedConfig` after
   capturing any relevant upload evidence. Do not allocate a 128-byte local
   array on the stack. Freeze the protocol so its ISR and main-loop paths
   cannot modify the buffer. Compute configuration CRC evidence only after
   copying volatile runtime state.
4. Write and verify byte zero first. Set byte four to pending, then write the
   remaining signature, metadata, payload, and final-image CRC. There is no
   preliminary full erase. Do not use `storageSave()`, which restores the
   normal profile signature.
5. Read back and verify the body with completion still pending. Write and
   verify `A5` at byte four last, then verify the final record CRC. A stale
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
fill instrumentation. Inspect generated assembly and linker allocations for
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

## Implementation and Validation Plan

1. Implement the schema, capture shim, bounded writer, decoder, and recovery
   signature handling as an investigation-only feature. Remove opcode `0x72`
   from that build while retaining configuration uploads.
2. Add reason-coded capture sites and narrowly defined invariant checks.
   Route explicit bootloader requests through capture before cleanup.
3. Verify layout coverage, CRC decoding, first-record preservation, pending
   records, bad CRCs, interrupted writes, and writer failures with focused
   host tests where possible.
4. Build both hardware variants using temporary outputs; inspect flash size,
   stack allocation, shim assembly, and buffer ownership. Preserve checked-in
   release artifacts.
5. On hardware, deliberately trigger startup and runtime bootloader entry,
   invalid saved configuration, and a controlled invariant fault. Download
   and decode each record before replacing the profile.
6. Verify that an existing complete or incomplete record survives bootloader
   entry, power cycles, USB resets, and configuration reapplication. Confirm
   subsequent application startup blinks the error LED and accepts a valid
   profile through HID. Verify recovery after an interrupted profile upload.
7. Confirm all-red feedback and actual bootloader enumeration separately,
   then run the intermittent-fault workload with a retained known-good profile.

If uploader or configurator changes are needed for decoding or recovery,
run `npm run build` from `webapp/` after those changes. This planning task does
not generate releases or modify firmware.
