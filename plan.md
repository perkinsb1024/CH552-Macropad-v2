# HID configuration implementation plan

This plan covers firmware and a browser configurator for the existing CH552 macropad. Configuration remains on the device and works without the web app after saving. The design uses the 128-byte DataFlash region and requires no hardware changes or application-code flash storage.

## 1. Agreed scope

- Support a configurable count of one through four layers.
- Support two physical variants: one with six keys and one with three. Each has one RGB LED per key and the same encoder with a push button.
- Give each layer one independent binding per physical key and one for the encoder button.
- Allow optional two-key chord bindings between physical keys on the same layer. Encoder rotation and its button never participate in chords.
- Give each layer independent clockwise and counterclockwise encoder bindings.
- Support keyboard combinations, mouse actions, scrolling, volume, display brightness, layer changes, and optional strings.
- Give each layer one LED color selection per physical key from a fixed, predefined 16-color palette.
- Preserve every setting currently between USER CONFIGURATION START and USER CONFIGURATION END, with its equivalent available per layer.
- Store sparse chord bindings after the configured layers, then strings in the remaining space; share identical strings across bindings and layers.
- Read existing configuration into the editor and verify saves by reading actual DataFlash back.
- Use one persistent configuration image. An interrupted save may invalidate it; the user can reconnect and save again.
- Keep VID 0x1209 and PID 0xC55D. Advertise the USB product name as Universal Macropad.
- Use WebHID from a static web app. No account, server-side device service, or continuously running host application is required.

Physical pin assignments, encoder electrical decoding parameters, and button debounce timing remain board/firmware definitions. Header information such as variant, layer count, startup layer, and chord window describes the whole profile; action and LED settings belong to individual layers.

## 2. Persistent format: version 1

Use explicit byte serialization rather than writing C structs. This avoids compiler padding, bitfield layout, and pointer-size dependencies. All multibyte integers are little-endian.

Every upload and flash readback is a canonical 128-byte image. Unused bytes are zero. Unsupported versions and malformed images are rejected before they can become active.

### Header: nine bytes

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 2 | Magic/validity marker: ASCII MP |
| 2 | 1 | Format version: 1 |
| 3 | 1 | Bits 0–1: layer count minus one; bits 2–3: startup layer; bits 4–7: zero |
| 4 | 1 | Used string-pool length, including terminators |
| 5 | 1 | Bit 0: physical variant (0 for six keys/LEDs, 1 for three); bits 1–6: chord-entry count; bit 7: zero |
| 6 | 2 | CRC16-CCITT-FALSE over bytes 0–5 followed by bytes 8–127 |
| 8 | 1 | Low nibble: chord window in 5 ms units (0–75 ms); high nibble: reserved, zero |

Specify CRC parameters in the protocol document: polynomial 0x1021, initial value 0xFFFF, no reflection, final XOR zero. Store the resulting CRC low byte first. A low-nibble value of 8 gives the initial 40 ms window. Zero disables chord recognition while retaining saved chord bindings.

### Layer records: 22 or 15 bytes

The six-key variant uses a 22-byte layer record; the three-key variant uses a 15-byte record. Layer N starts at byte 9 + record size × N. Layer and input indices start at zero. The encoder button follows the physical keys in each record, then clockwise and counterclockwise rotation bindings. This variant-specific layout gives the three-key device seven more string-pool bytes per layer.

| Field | Six-key offset/size | Three-key offset/size |
| --- | --- | --- |
| Physical key bindings | 0–11 / 12 bytes | 0–5 / 6 bytes |
| Encoder-button binding | 12–13 / 2 bytes | 6–7 / 2 bytes |
| Clockwise encoder binding | 14–15 / 2 bytes | 8–9 / 2 bytes |
| Counterclockwise encoder binding | 16–17 / 2 bytes | 10–11 / 2 bytes |
| LED palette indices | 18–20 / 3 bytes | 12–13 / 2 bytes |
| Layer options | 21 / 1 byte | 14 / 1 byte |

Each binding occupies two bytes. Pack two LED palette indices per byte, with the even-numbered LED in the low nibble and the odd-numbered LED in the high nibble. The unused high nibble of the three-key variant's second LED byte must be zero.

Layer-option bits are: bit 0 reserved and zero, bit 1 allows bootloader entry by holding the encoder, bits 2–3 select layer-indicator behavior, and bits 4–7 select the indicator color. Holding the first three keys at power-up always enters the bootloader.

For the encoder-button hold gesture, capture the originating layer's bootloader-from-run setting when the button is pressed. This prevents a layer change during a hold from unexpectedly enabling the gesture. Preserve the unconditional first-three-keys power-up recovery gesture documented in README.md.

### Sparse two-key chord table

The chord table begins immediately after the final layer and has the count encoded in header byte 5. Each configured chord uses three bytes: one key-pair/layer identifier followed by a normal two-byte action record. Unlisted pairs retain their separate single-key bindings. A six-key layer has 15 possible pairs; a three-key layer has three. Chords do not include the encoder button or rotation.

In the identifier, bits 0–3 encode the unordered physical-key pair in lexicographic order (for six keys: (0,1), (0,2), ... (4,5)); bits 4–5 encode the layer index; bits 6–7 must be zero. For three keys only pair indices 0–2 are valid. Store entries in ascending identifier order, with no duplicate pair on a layer. Validate that all layer and pair indices exist, the table fits before the string pool, and each action is legal for a button press.

### Two-byte action record

Byte 0 holds the action type in its low nibble and auxiliary data in its high nibble. Byte 1 holds the parameter. For keyboard actions, auxiliary bits represent Ctrl, Shift, Alt, and GUI, in that order. There is one modifier category per key; independent left/right modifier selection is outside version 1.

| Type | Action | Parameter and auxiliary data |
| --- | --- | --- |
| 0x0 | None | Both parameter and auxiliary data zero |
| 0x1 | Keyboard tap | One raw keyboard HID usage plus modifier mask; press then release |
| 0x2 | Keyboard hold | Same encoding; release when the physical button is released |
| 0x3 | Mouse click | Left/right/middle button mask; auxiliary data zero |
| 0x4 | Mouse double-click | Mouse button mask; auxiliary data zero |
| 0x5 | Mouse hold | Mouse button mask; release with physical button |
| 0x6 | Mouse toggle | Mouse button mask; alternate latched press/release |
| 0x7 | Scroll step | Signed 8-bit vertical wheel-count magnitude; firmware emits one-count reports; auxiliary data zero |
| 0x8 | Consumer-control tap | 12-bit usage: auxiliary nibble is high four bits, parameter is low eight bits |
| 0x9 | String | Offset relative to string-pool start; auxiliary data zero |
| 0xA | Set layer | Destination layer index; auxiliary data zero |
| 0xB | Momentary layer | Destination layer while the physical button is held |
| 0xC | Toggle layer | Toggle selected base layer between destination and startup layer |
| 0xD | Next layer | Advance selected base layer cyclically; remaining fields zero |
| 0xE | Mouse X step | Signed 8-bit relative X delta; auxiliary data zero |
| 0xF | Mouse Y step | Signed 8-bit relative Y delta; auxiliary data zero |

Use a zero keyboard usage to allow modifier-only bindings. Keyboard usage values must be supported non-modifier key usages or zero; modifiers use the mask. Consumer-control usages cover volume, mute, media controls, and display brightness without needing strings. Do not promise that every host or monitor honors brightness usages.

Limit mouse X/Y and wheel parameters to -127 through +127 to match the HID report range and permit safe direction inversion. Reject -128. Reserved auxiliary bits must be zero for action types that do not use them.

Encoder rotation accepts actions that complete on a detent, including key taps, clicks, scrolling, consumer taps, strings, and persistent layer changes. Reject keyboard hold, mouse hold, and momentary layer actions for rotation because there is no corresponding physical release. The encoder button supports normal button actions.

All 16 action codes are allocated. Future action families require a versioned extension or a revised encoding, rather than silently reinterpreting saved data.

### String pool and capacity

The pool begins immediately after the chord table. Strings are zero-terminated, and the pool is shared by all layers. Multiple bindings, including chords, may point to the same string. Offsets must reference the start of a complete string within the declared used pool; embedded zero bytes are forbidden.

| Layers | Six-key header plus layers | Six-key bytes for chords and strings | Three-key header plus layers | Three-key bytes for chords and strings |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 31 | 97 | 24 | 104 |
| 2 | 53 | 75 | 39 | 89 |
| 3 | 75 | 53 | 54 | 74 |
| 4 | 97 | 31 | 69 | 59 |

Each chord consumes three bytes from the remaining capacity. Thus the six-key, four-layer profile can hold up to 10 configured chords across its layers with one byte left; with all 10 chords, that byte can hold only an empty string's terminator. Fewer chords leave more room for strings. A complete set of 15 chord bindings on every six-key layer would require at least 217 bytes even with a dense two-byte action per pair (9-byte header + four 22-byte layers + 60 two-byte actions), so it cannot fit in 128 bytes. The three-key, four-layer profile can hold all 12 possible chords and still leave 23 string bytes. The editor must show this shared budget rather than promise every possible six-key pair can be assigned at once.

Each distinct string consumes its encoded length plus one terminator. The web app deduplicates identical strings and rebuilds offsets deterministically in layer/input order, followed by chord-identifier order. Empty strings may share a single terminator. With no string actions, pool-used length is zero.

Version 1 supports printable ASCII plus tab and newline. Normalize pasted line endings to LF. The firmware translates these bytes into keyboard events using a documented keyboard-layout mapping, initially US. Reject unsupported characters in the editor and firmware; do not silently truncate or substitute Unicode text. Typed output still depends on the host keyboard layout.

## 3. Firmware work

### Establish resource and build limits

Record the current CH55xduino version, board options, USB RAM setting, and build procedure. Compile a baseline and retain code, xRAM, and internal RAM/stack usage. The CH552 has approximately 14 KiB available for application code with its bootloader, 1 KiB xRAM, and 256 bytes internal RAM; USB buffers already consume part of that budget.

Keep configuration and transport buffers in explicitly assigned SDCC memory spaces. Plan for a 128-byte active image and a 128-byte upload buffer, plus small fixed USB inbox/outbox and action-state structures. Keep the palette and lookup tables in code memory. Avoid allocation, recursion, full-size per-layer RAM structures, and an additional flash-readback image. Compile and inspect the memory map after each milestone; firmware size and RAM fit remain implementation checks.

### Configuration access and invalid flash behavior

Add a configuration module that validates, loads, and accesses the serialized image. Read bindings directly from the selected layer record. Do not expand all four layers into separate arrays in RAM.

Do not synthesize a fallback profile when flash is invalid. Keep keys, encoder actions, and LEDs inactive until the host uploads a valid profile, while preserving USB configuration access. Define a 16-entry firmware palette, including the six existing LED colors and ten documented additional choices. The web app uses the same palette indices and appearance-matched display hex colors; its hex values may intentionally differ from the firmware RGB triplets. Palette entries are not uploaded.

Replace the existing parallel configuration arrays with accessors into the active image. Replace the preprocessor test of INVERT_SCROLLING with a runtime check: the current bool variable cannot control a preprocessor #if expression.

### Input and action engine

Separate physical input scanning, logical actions, and USB report construction. Initialize all configured key pins, including the currently omitted KEY3–KEY5 pullups. Initialize state from actual pin readings.

Use elapsed-time button debouncing and a quadrature transition decoder that produces complete logical encoder steps. Replace blocking double-click, tap, and string delays with a small bounded scheduler so USB configuration and input scanning remain responsive. Use explicit queue/backpressure rules for fast rotation and long strings; completed actions must always release their temporary outputs.

For a physical key that belongs to at least one configured chord on the effective layer, defer its single-key action for the profile's chord window, measured from its debounced press. A second physical key pressed within that window triggers a chord only if the pair is configured on the first key's captured layer; then suppress both single-key actions. If the pair is unconfigured, execute the first single-key action and handle the second key normally. If the first key is released before the window expires, execute its single-key press and release in order so short taps are not lost. A zero window disables chord recognition and removes this delay. Keys with no chord participation and the encoder button act without this delay. Start with 40 ms and tune the default on hardware; the selected value is stored once per profile, not per layer.

Activate a chord on the second debounced press. For hold and momentary-layer actions, release the chord action when either constituent key is released; do not fire either constituent single-key action afterward. Both keys must be released before the same chord can activate again. When a third key is pressed, treat it independently of the active chord. Keep pending key and active chord state bounded by the physical key count, and process it without blocking USB traffic.

Provide raw keyboard-usage APIs for configurable bindings instead of passing raw usages into the current ASCII/special-key encoding. Emit clean mouse reports: X, Y, and wheel are temporary relative deltas and must never be replayed by a later button report. Preserve the behavior fixed by the existing Mouse_scroll(0) workaround when refactoring the report layer.

Track ownership of pressed keys, modifiers, and mouse buttons so releasing one action does not release an output still held by another action. Use bounded key slots and counts rather than a 256-entry keyboard table. Define and test behavior at the existing six-key rollover limit.

### Layer behavior

Maintain a selected base layer and bounded momentary overrides. The most recently pressed, still-held momentary layer takes precedence; releasing it restores the next override or the base layer.

Resolve each immediate button binding on its debounced press; for a chord-eligible key, capture the effective layer and its single-key binding while awaiting the second press. Retain a triggered single-key or chord action until its defined release. Releasing a key after switching layers must release the original action, not look up a different action in the new layer. On an effective layer change, resolve any pending single-key action from its captured layer and stop matching it against new-layer chords. Set/toggle/next-layer actions change the selected base layer. After any effective layer change, update LED colors and discard partial encoder movement so it cannot trigger an action in the new layer.

Clear latched mouse toggles on effective layer changes, releasing only the outputs they own. Cancel pending string/tap sequences from the previous layer cleanly. Ordinary held physical key and mouse actions keep their original ownership until release. Momentary-layer bookkeeping survives the transition it caused.

Applying a new configuration, entering the bootloader, or resetting clears all output ownership and pending actions. After applying a configuration, suppress already-held inputs until their next release. Do not persist active-layer changes; power-up starts at the configured startup layer and does not consume flash writes.

### USB descriptors and report handlers

Retain the existing VID/PID and rename the product descriptor to Universal Macropad, updating its length. Keep keyboard report ID 1 and mouse report ID 2. Add a vendor-defined top-level Application collection on usage page 0xFF00, usage 0x0001, for configuration. Keep it outside the protected keyboard and mouse collections.

Proposed report IDs:

| ID | Direction | Purpose |
| ---: | --- | --- |
| 1 | Input and existing LED Output | Keyboard and host lock LEDs |
| 2 | Input | Mouse |
| 3 | Output | Configuration requests |
| 4 | Input | Configuration replies |
| 5 | Input | Consumer controls, with a 16-bit usage field |

Use the existing interrupt IN/OUT endpoint pair, increasing its advertised maximum packet size from 9 to 32 bytes. Configuration reports are exactly 32 bytes on USB: one report-ID byte and 31 payload bytes. Existing keyboard, mouse, and consumer reports keep their own shorter lengths. Audit endpoint buffers, USB RAM settings, and report-descriptor length handling; the expanded descriptor must not be truncated through an 8-bit length variable.

The OUT interrupt handler only validates packet length, copies into a bounded inbox, and marks it pending. Process commands, run validation, and write flash in the main loop. Share the IN endpoint through a scheduler that preserves keyboard/mouse releases while allowing configuration replies. Handle busy/error returns instead of reporting unconditional success.

Support output delivery through interrupt OUT and the HID SET_REPORT control-transfer path, including EP0 packet assembly and length checks. Preserve keyboard LED output handling. Audit other HID class requests against the interface's advertised boot/report capabilities. Feature reports are not needed for this protocol.

Early in implementation, confirm that the vendor collection can be opened in Chrome/Edge on Windows, macOS, and Linux while normal keyboard/mouse operation continues. If a target OS requires a separate configuration HID interface, make that adjustment before building the full editor and account for its endpoint/RAM cost.

### DataFlash persistence

Use CH55xduino's DataFlash byte API with explicit offsets 0–127 and readback checks. The write API currently returns no success indication, so verification must read the stored bytes. Keep hardware register access and short interrupt-critical operations confined to the storage module.

Only an explicit Save operation writes flash. Upload chunks go into staging RAM. Validate the complete image, its variant against the physical board, chord identifiers/count/order, all action parameters, layer references, string boundaries, unused bits, and CRC before writing.

If the staged image already matches flash, skip programming. Otherwise invalidate the persistent magic, write changed body/header bytes, and restore the magic last. Read back all 128 bytes, compare against the upload, and validate CRC before acknowledging success and activating the new configuration. An interrupted save may lose the previous profile; retaining a second copy is not required.

At boot, invalid flash or an image for the other physical variant leaves physical inputs and LEDs inactive while configuration access remains available. Do not automatically rewrite flash or select a fallback profile. Interrupted uploads never affect flash. A reported save failure leaves the last active RAM configuration available until a retry or reset.

## 4. Configuration protocol

Publish a versioned protocol specification and shared golden byte fixtures before implementing both ends. Transport version and persistent-format version are separate.

The 31-byte request/reply payload contains a two-byte protocol signature, one-byte transport version, opcode, request sequence, image offset, data length, status, and up to 23 data bytes. The eight header bytes occupy payload positions 0–7; data starts at position 8. Pad unused bytes with zero. WebHID receives/sends the report ID separately from this payload.

The host uses one outstanding request at a time. Replies echo opcode and sequence. Define timeouts, bounded retries, and idempotent retry behavior so a lost acknowledgement cannot cause unnecessary flash writes. Upload data must arrive at the expected next offset; duplicate chunks may be acknowledged only if they match already-staged bytes. A new BEGIN_WRITE discards an incomplete upload. Disconnect or an upload timeout abandons staging.

| Command | Behavior |
| --- | --- |
| GET_INFO | Return protocol identity, firmware/config versions, action support, 128-byte capacity, layer limits, palette ID, and the physical variant with its key/LED count |
| GET_STATUS | Return flash validity, active/startup layer, and upload/save state |
| READ_FLASH | Read a bounded slice directly from DataFlash, including invalid images for diagnosis |
| READ_ACTIVE | Read the active RAM image; invalid flash means no active profile |
| BEGIN_WRITE | Start an exact 128-byte upload with expected image CRC |
| WRITE_CHUNK | Copy a validated, bounded chunk into the upload buffer |
| COMMIT_WRITE | Validate the complete staged profile, persist, verify, activate, then reply |
| ABORT_WRITE | Discard staging without modifying active settings or flash |

GET_INFO may be returned in chunks if necessary. Use an application-specific identity in its response because VID/PID is shared with other CH55xduino devices. The host must verify that identity and supported protocol version before offering edits or writes.

Return explicit error statuses for unsupported version/opcode, invalid length/offset, incomplete upload, invalid configuration, CRC mismatch, busy, and flash verification failure. Reset-to-defaults can use the normal upload/save flow. After a COMMIT timeout, read flash and status before retrying; the save may already have completed.

## 5. Web app work

Build a small TypeScript app with Vite and ordinary HTML/CSS controls. Keep the configuration model, binary codec, transport, and UI separate. Serve it over HTTPS, with localhost supported for development. Provide a browser capability check and instructions for desktop Chrome/Edge; document Linux device-access permissions where needed.

### Connect and load

The Connect button calls navigator.hid.requestDevice with VID/PID and the vendor usage-page/usage filter. Open the selected device, install reply listeners, query identity/capabilities, and display its product name. Reading must not change the device configuration.

Read the full flash image and decode it only after validation. If flash is invalid, explain that no valid saved profile exists and load an editor starter profile without implying that the device is using it. If the format is unsupported, prevent writes and preserve the bytes for export rather than guessing their meaning.

### Editor

Provide layer tabs, a one-to-four layer count, startup-layer selection, a chord-window setting in 5 ms steps from 0 to 75 ms, and a layout matching the connected variant: three or six keys with their LEDs, plus the encoder button and both rotation directions. Offer optional actions for pairs of physical keys on each layer and explain the delay applied to keys used in chords; zero disables chord recognition. Encode the corresponding variant-specific layer size; reject a profile whose variant does not match the device.

Selecting a control opens an action editor with the applicable fields. Provide explicit key selection and optional shortcut capture using physical KeyboardEvent.code mappings; some OS/browser shortcuts cannot be captured, so selection must always remain available. Display Ctrl/Shift/Alt/GUI clearly and explain the supported string keyboard layout.

Provide per-layer palette selectors and scroll/bootloader options. Represent layer destinations explicitly. When removing layers, require dangling layer actions and startup-layer references to be corrected. Changing the layer count must rebuild the string pool and offsets.

Show a live storage meter: variant-specific layer bytes, chord-table bytes, string bytes including terminators, and remaining bytes. Deduplicate identical strings during encoding. Disable Save with a precise capacity or validation explanation when the profile is too large. Adding a layer must never silently delete or truncate chords or strings.

Keep layer names and other optional editor annotations in browser storage or exported JSON; they do not consume device storage. Label such annotations as local metadata if introduced.

### Save, verify, and backups

Serialize and validate a canonical image, upload it sequentially, then commit. Show separate uploading, saving, and verifying states. After firmware success, independently READ_FLASH all 128 bytes and compare them byte-for-byte with the uploaded image. Only then show Saved and replace the editor's last-saved baseline.

Keep unsaved changes on disconnect or save failure. Reconnecting must not automatically overwrite either the local draft or device configuration; offer Reload from device or retain the draft. Persist drafts locally, keyed by the app/device context, without assuming VID/PID uniquely identifies one physical unit.

Support versioned JSON import/export with readable action names and strings, plus explicit Reset to defaults. Validate imports using the same constraints as interactive edits. Browser backups are useful but not required for normal operation after a successful save.

## 6. Suggested source organization

- Firmware: keep the sketch as setup/loop orchestration; introduce C-compatible configuration, action, input, storage, and protocol modules under src.
- USB: update the existing src/userUsbHidKeyboardMouse descriptor, handler, and report files, keeping changes local to this repository.
- Web app: webapp/src modules for model, codec, protocol, HID transport, key mappings, palette, and UI.
- Shared contract: protocol/config-v2.md, protocol/hid-v1.md, and golden JSON/binary fixtures for both physical variants used by firmware-side host tests and TypeScript tests.
- Documentation: update README.md with build instructions, one-time firmware upgrade, configuration workflow, palette, string/layout limits, and interrupted-save recovery by reconnecting and saving again.

## 7. Implementation sequence and acceptance checks

1. **Freeze format and prove resource fit.** Implement the 128-byte codec/validator, compile the firmware, and record memory headroom. Establish golden fixtures for every action type, both board variants, sparse chords, and one through four layers.
2. **Prove browser transport.** Add the vendor collection and GET_INFO/read commands. Confirm discovery, access, descriptor correctness, and continued keyboard/mouse use on the target desktop operating systems.
3. **Implement runtime configuration and actions.** Add raw keyboard and consumer reports, encoder actions, layers, ownership tracking, and the bounded scheduler. Use a RAM-loaded test image before enabling flash writes.
4. **Implement persistence.** Add staged upload, validation, explicit commit, readback, inactive behavior on invalid flash, and host retry handling.
5. **Build the editor.** Add connection/loading, layer and action controls, LED palette, string allocation, import/export, and Save with readback comparison.
6. **Run focused integration checks and document the result.** Confirm the following behaviors on hardware, then finish the user/build documentation.

Required checks:

- Every binding type round-trips through the TypeScript codec and firmware decoder; negative deltas, consumer high bits, and modifier-only combinations retain their meaning.
- Chord-plus-string capacity matches 97/75/53/31 bytes for six keys and 104/89/74/59 bytes for three keys. Test exact fits, one-byte overflow, maximum chord counts, shared strings, empty strings, invalid offsets, missing terminators, and layer-count changes.
- Chord-window values 0–15 round-trip as 0–75 ms in 5 ms steps; reject a nonzero reserved high nibble. Confirm zero disables chord recognition and 8 selects 40 ms.
- Chord tests cover mapped and unmapped pairs, both press orders, a brief single-key tap, threshold boundaries, hold release by either key, a third pressed key, layer changes while a key is pending, and invalid or duplicate pair identifiers.
- Corrupt headers, unsupported versions, bad CRCs, invalid action parameters, and malformed HID packets never cause out-of-bounds reads or writes.
- A click after scrolling produces no additional scroll; mouse movement is not replayed by later clicks or media events.
- Fast rotation, strings, double-clicks, and configuration traffic do not leave keys/buttons pressed. Test overlapping modifiers, rollover, momentary-layer release order, latched toggles, and layer changes while buttons are held.
- Volume/brightness emit the intended consumer usages. Record observed host behavior separately from firmware report correctness.
- Save, unplug, reconnect, and edit reproduces the same configuration. Verification reads physical DataFlash, not the active RAM image.
- An interrupted upload preserves flash; an interrupted save is detected on restart and leaves device inputs inactive until a profile is uploaded. Retrying a completed save does not rewrite unchanged data.
- Test all one-to-four layer counts and both three-key and six-key board definitions as available. Reject cross-variant images and a nonzero unused LED nibble. Confirm bootloader gestures follow the defined layer policy.
- Record final code/RAM usage and confirm stack, USB DMA buffers, active configuration, staging buffer, and action queues do not overlap.

## 8. Reference constraints

- [WCH CH552 datasheet, sections 6.2 and 6.5](https://cdn-learn.adafruit.com/assets/assets/000/129/847/original/CH552DS1.PDF?1715004485=): DataFlash capacity, byte programming, memory map, and endurance. Save explicitly and skip unchanged bytes; do not autosave each editor change.
- [CH55xduino DataFlash implementation](https://github.com/DeqingSun/ch55xduino/blob/ch55xduino/ch55xduino/ch55x/cores/ch55xduino/eeprom.c): current eeprom_read_byte/eeprom_write_byte implementation and address mapping.
- [Chrome WebHID guide](https://developer.chrome.com/docs/capabilities/hid): device selection, report APIs, vendor collections, protected keyboard/mouse collections, and Linux permissions.
- [USB HID Usage Tables](https://www.usb.org/hid): keyboard and consumer usages; usage definitions do not guarantee support by every host.

This document is the implementation plan. The byte layout is designed to fit; final firmware resource use and behavior on the physical pad must be demonstrated during implementation.
