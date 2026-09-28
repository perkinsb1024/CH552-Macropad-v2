# Macropad HID transport, version 1

The USB device retains VID `0x1209` and PID `0xC55D`. Its product string is
`Universal Macropad`. Keyboard and mouse reports use IDs 1 and 2; consumer
controls use ID 5.
A separate vendor-defined Application collection uses usage page `0xFF00`,
usage `0x0001`. Report ID 3 carries 31-byte Output requests and report ID 4
carries 31-byte Input replies. The USB interrupt endpoint packet size is 32
bytes, including the report ID. WebHID passes the report ID separately.

Each request and reply payload has this layout:

| Payload byte | Meaning |
| ---: | --- |
| 0–1 | ASCII `UM` signature |
| 2 | Transport version, currently 1 |
| 3 | Opcode, echoed in the reply |
| 4 | Sequence number, echoed in the reply |
| 5 | Image offset, echoed in the reply |
| 6 | Data length, at most 23 |
| 7 | Reply status; zero in requests |
| 8–30 | Data, padded with zero |

Use one outstanding request at a time. The device accepts requests via
interrupt OUT or HID SET_REPORT(Output) on interface 0, and sends replies via
interrupt IN. SET_REPORT must include report ID 3 and exactly 32 USB bytes.
Report ID 1's two-byte keyboard LED Output is also accepted by both
delivery paths. The USB interface is report protocol HID, without boot
subclass support.

The action mask reports all sixteen action types. Chord recognition uses the
saved profile window; zero disables it. A second press must arrive strictly
before the window expires to activate a mapped chord.

| Opcode | Request | Reply data |
| ---: | --- | --- |
| 1 | GET_INFO, offset and length zero | `UMAC`, transport version, format version, physical variant, key count, LED count, maximum layers, image capacity, palette version, 16-bit action mask |
| 2 | GET_STATUS, offset and length zero | Flash-valid flag, current layer, startup layer, upload state, saturated dropped button-action count, saturated dropped rotation-action count |
| 3 | READ_FLASH, offset and length 1–23 | Actual DataFlash bytes |
| 4 | READ_ACTIVE, offset and length 1–23 | Active image bytes, including built-in defaults if flash is invalid |
| 5 | BEGIN_WRITE, offset zero, length 3 | Data bytes: image size 128, expected CRC low byte, expected CRC high byte. Starts a new upload and discards any prior staging. |
| 6 | WRITE_CHUNK, next offset, length 1–23 | Copies the next sequential chunk. Identical duplicate chunks are acknowledged; conflicting or partially overlapping chunks are rejected. |
| 7 | COMMIT_WRITE, offset and length zero | Validates the full image and CRC, saves changed DataFlash bytes, verifies all 128 bytes, then activates the configuration. Repeated commit is safe. |
| 8 | ABORT_WRITE, offset and length zero | Discards staging without changing flash or the active profile. |

Status codes are 0 success, 1 unsupported transport version, 2 unsupported
opcode, 3 invalid offset or length, 4 malformed packet, 5 incomplete upload,
6 invalid configuration, 7 CRC mismatch, 9 flash verification failure, and
10 out-of-order or conflicting chunk. Status 8 is reserved. Error replies have zero data length
and zero data bytes. Request padding and the request status byte must be zero.
Reads ending exactly at image byte 127 are legal. GET_INFO
is the application identity check because VID/PID alone do not distinguish
this firmware from other CH55xDuino devices.

The upload state is 0 idle, 1 receiving, or 2 committed. It expires after five
seconds without a valid upload command. Bus reset, interface reconfiguration,
and ABORT_WRITE discard it. A new BEGIN_WRITE always starts over. COMMIT_WRITE
may be retried after a lost reply; a repeated successful commit does not write
flash again. After commit, the host should independently read all 128 flash
bytes and compare them with the image it sent.

For a changed image, firmware invalidates the two-byte magic, writes and checks
the body, restores the magic last, and compares the stored image byte for byte.
If a write fails, the previous active RAM configuration remains in use so the
host can retry. An interrupted save may leave invalid flash; startup then loads
built-in defaults without writing flash. Configuration activation releases
held outputs, cancels pending actions, resets encoder state, and suppresses
inputs that remain held until they are released.

After a bus reset, an incomplete request is discarded. Configuration reports
share the input endpoint with short keyboard, mouse, and consumer reports. The
scheduler alternates them under sustained traffic so neither class can wait
indefinitely. Endpoint halt status and CLEAR_FEATURE are supported. Remote
wake-up is not advertised. HID GET_REPORT returns current keyboard, mouse
button, and consumer state; relative mouse movement is always returned as zero.
GET_IDLE and SET_IDLE support report IDs 1, 2, and 5, plus report ID 0 to set
all three idle rates. Idle rates use the standard four millisecond units, and
the scheduler sends unchanged reports when their configured interval expires.
