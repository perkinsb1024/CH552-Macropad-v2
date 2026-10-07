# V9 horizontal scroll implementation

Configuration format 9 adds auxiliary bit 3 to **Scroll** for **Horizontal**.
Bit 2 continues to select **Hold**; bits 0–1 remain reserved. The first action
byte is `07` (vertical tap), `47` (vertical hold), `87` (horizontal tap), or `C7`
(horizontal hold). Both axes retain signed -127–127 steps and emit unit reports.
Held repeats wait at least 100ms after the previous complete step. Encoder
rotation and timed actions allow taps on either axis; holds still require a
physical release.

## Flash and RAM

Ordinary source builds, without release generation:

| Resource | Six-key | Three-key |
| --- | ---: | ---: |
| Flash used / 14,336 bytes | 14,330 | 14,326 |
| Flash free | 6 | 10 |
| XSEG | 526 | 517 |
| PSEG | 107 | 107 |
| Linker stack reserve | 111 | 114 |

Hardware peak stack usage was not measured here.

Horizontal AC Pan occupies two previously unused bits in the mouse-button
byte. This preserves the five-byte report (including report ID 2) and existing
queue storage. Horizontal playback emits only -1 or +1, so the signed two-bit
field covers all transmitted steps. Mouse-button state masks out the internal
axis flag; GET_REPORT and idle reports zero both relative scroll axes.

The initial implementation exceeded flash and internal RAM. Packing AC Pan
into existing padding solved the RAM issue. Byte-sized validator arithmetic,
constant-index consumer report packing, and removing redundant descriptor
size, usage-page and logical-minimum items recovered flash. All existing features remain enabled.

## Compatibility and checks

The latest editor writes binary and JSON version 9. It imports older profiles
and recovers v8 drafts without changing their source. Existing v8 scroll records
remain vertical, including hold mode; multi-click counts remain unchanged.
Firmware preserves old flash but leaves inputs inactive until the migrated
profile is explicitly saved. Devices running v8 firmware use the frozen v8 editor. The checked-in HEX files
and bundled uploader now carry v9 builds from revision `8339b59a`:
[three-key](../releases/ch552-macropad-3-key-8339b59a.hex) and
[six-key](../releases/ch552-macropad-6-key-8339b59a.hex), for use with the latest editor.

Host regressions check all auxiliary nibbles, signed endpoints, both hardware
layouts, rotation/hold restrictions, chords, timer slots, binary/JSON migration,
mouse report packing and the descriptor's signed AC Pan field. Firmware action
tests check both axes with uneven polling, timer wraparound and USB stalls,
including the minimum 100ms repeat interval.

Browser event capture at `wheel-debug.html` records both deltaX and deltaY for
hardware testing. Physical horizontal scrolling and host compatibility still
need a flashed-device check; host tests do not establish OS behavior.

The final web regression suite passed 391 tests; TypeScript, the production
build and all frozen-archive hashes passed. Firmware config, actions, protocol,
USB and both physical-input host suites passed, along with build-layout checks.
A browser simulator check confirmed axis selection changes directions and
binding summaries while preserving wheel step.

Horizontal HID signs remain unchanged by host scroll preferences. A direction
hint opens **Scroll & click test**, with scrolling on both axes, a warning for
unsaved edits and separate mouse-button counters. Users can swap the selected
direction to match their computer without changing firmware HID conventions.
