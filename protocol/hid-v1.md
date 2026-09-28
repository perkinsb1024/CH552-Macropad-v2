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
Report ID 1's existing two-byte keyboard LED Output is also accepted by both
delivery paths. The USB interface is report protocol HID, without boot
subclass support.

The current firmware phase implements these read-only opcodes:

| Opcode | Request | Reply data |
| ---: | --- | --- |
| 1 | GET_INFO, offset and length zero | `UMAC`, transport version, format version, physical variant, key count, LED count, maximum layers, image capacity, palette version, 16-bit action mask |
| 2 | GET_STATUS, offset and length zero | Flash-valid flag, current layer, startup layer, upload-active flag |
| 3 | READ_FLASH, offset and length 1–23 | Actual DataFlash bytes |
| 4 | READ_ACTIVE, offset and length 1–23 | Active image bytes, including built-in defaults if flash is invalid |

The action mask reports the sixteen implemented action types. Chord recognition
uses the saved profile window; zero disables it. A second press must arrive
strictly before the window expires to activate a mapped chord.

Status codes are 0 success, 1 unsupported transport version, 2 unsupported
opcode, 3 invalid offset or length, and 4 malformed packet. Error replies have
zero data length and zero data bytes. Request padding and the request status
byte must be zero. Reads ending exactly at image byte 127 are legal. GET_INFO
is the application identity check because VID/PID alone do not distinguish
this firmware from other CH55xDuino devices.

Write, commit, and abort opcodes are reserved for a later firmware phase.
The web editor should not offer saving until those opcodes and readback
verification are implemented. After a bus reset, an incomplete request is
discarded. If an interrupt reply is delayed by a keyboard or mouse report,
the device retains the reply and sends it when the endpoint becomes free.
