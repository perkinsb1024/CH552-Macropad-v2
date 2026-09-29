# CH552 Universal Macropad

This is a PlatformIO build of the existing CH55xDuino sketch. The source stays in
`CH552_Universal_Macropad.ino`, and the USB HID code stays under `src/`.

Install PlatformIO Core and the CH55xDuino Arduino Boards Manager package
version **0.0.25**. The build uses that package's SDCC toolchain
(`build.13407_4`) and MCS51 tools (`2023.10.10`). On macOS it is normally
installed under `~/Library/Arduino15/packages/CH55xDuino`. If yours is
elsewhere, set `CH55XDUINO_PACKAGE_DIR` to the package directory.

Run `pio run` to build. The output is `.pio/build/ch552/firmware.hex`.
To flash over USB, run `pio run -t upload` and put the CH552 into bootloader
mode within ten seconds. Hold the encoder button for three seconds, or hold
the encoder button during startup. Holding the encoder button at power-up
always enters the bootloader and cannot be disabled in a profile. The Upload
task always invokes the programmer, even when the HEX file is already built.

To clear the saved profile for testing, run `pio run -t erase-config`. This
temporarily uploads a small utility that invalidates the profile, then uploads
the normal firmware again. With no profile, the keys and encoder stay inactive
and one red LED blinks at 1 Hz; hold the encoder button while powering up to
enter the recovery bootloader.

The firmware uses the version 2 image codec in `src/config.c`. It validates a
128-byte image and exposes layer, binding, chord, and palette accessors. It does
not provide a fallback profile: when DataFlash has no valid image, physical
inputs stay inactive and one red LED blinks at 1 Hz while USB configuration
access remains available.
The byte format and palette are documented in `protocol/config-v2.md`. Run the
codec checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= -I src \
  tests/config_test.c src/config.c -o /tmp/ch552-config-test
/tmp/ch552-config-test
```

The web app offers an editor starter profile with the original shortcuts,
encoder middle-click and scroll directions, the encoder-hold bootloader option,
and six original LED colors. A key's layer-selected LED color is shown while
that key is held and clears on release.

Palette version 3 adds a rainbow effect: choose **Always on** for a layer's
indicator behavior and **Rainbow** (palette index 15) for its indicator color.
Idle LEDs cycle through colors with an offset across the keys. On the six-key
board, the rainbow follows the perimeter (6 → 5 → 4 → 1 → 2 → 3 → 6).
The **Full
brightness for idle LEDs** option applies to both solid colors and Rainbow;
pressed keys still show their configured per-key colors. Index 15 remains Off
for per-key colors and other indicator behaviors. Configuration format version
2 uses bit 0 of each layer's option byte for full brightness. The updated
firmware will reject an existing version 1 profile; save a profile with the
updated editor after flashing.

Both web app color palettes offer **Preview Color** and **Cancel Preview** when
a device with preview support is connected. Preview lights every LED using the selected color, with
Rainbow and the full-brightness setting supported for always-on layer colors.
Per-key colors and blinking indicator colors preview at full brightness; their
Off swatch remains Off. Canceling or any physical input restores normal LEDs,
even when that input has no assigned action. Preview works with blank flash,
persists through saves, and never changes a profile or writes flash. Updated
firmware is required. On each connection, the editor sends one Cancel Preview
command to detect support, also ending any existing preview. Unsupported firmware
shows an availability message in place of both controls; a timeout or another
error leaves support unknown and the
controls usable. This probe adds no device flash overhead.

`ENABLE_COLOR_PREVIEW` in `src/protocol_firmware.h` defaults to `1`. Set it to
`0` (or add `build_flags = -DENABLE_COLOR_PREVIEW=0` to `platformio.ini`) to
exclude preview. Clean and rebuild after changing the flag. All flash
optimizations remain in effect. Disabling preview saves **204 flash bytes and
one xRAM byte** on either variant: the six-key build uses 14,110 code bytes
(226 free) and 624 application xRAM bytes; the three-key build uses 14,107 code
bytes (229 free) and 615 application xRAM bytes. Disabled firmware rejects both
Preview Color and Cancel Preview as unsupported.

The firmware exposes the HID configuration protocol in `protocol/hid-v1.md`.
At startup it reads and validates DataFlash. If flash is invalid, the firmware
keeps inputs inactive and blinks one red LED at 1 Hz until a valid profile is
uploaded. GET_INFO,
GET_STATUS, READ_FLASH, READ_ACTIVE, BEGIN_WRITE, WRITE_CHUNK, COMMIT_WRITE,
ABORT_WRITE, and PREVIEW_COLOR are implemented. Saves
validate the full image, avoid programming unchanged bytes, write validity last,
then verify actual DataFlash before applying the profile.

Run the focused firmware checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= -I src \
  tests/config_test.c src/config.c -o /tmp/ch552-config-test
/tmp/ch552-config-test
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= -I src \
  tests/protocol_test.c src/config.c src/protocol_firmware.c src/storage.c \
  -o /tmp/ch552-protocol-test
/tmp/ch552-protocol-test
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= -I src \
  tests/actions_test.c src/config.c src/actions.c -o /tmp/ch552-actions-test
/tmp/ch552-actions-test
cc -std=c99 -Wall -Wextra -Werror -Wno-unknown-pragmas \
  -Wno-pointer-to-int-cast -Wno-parentheses \
  -I "$CH55XDUINO_PACKAGE_DIR/hardware/mcs51/0.0.25/variants/ch552" \
  -I "$CH55XDUINO_PACKAGE_DIR/hardware/mcs51/0.0.25/cores/ch55xduino" \
  tests/usb_test.c -o /tmp/ch552-usb-test
/tmp/ch552-usb-test
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= \
  -I tests/stubs -I src tests/input_test.c src/config.c src/actions.c \
  -o /tmp/ch552-input-test
/tmp/ch552-input-test
```

The fixed action arrays and their blocking handlers have been removed. The
sketch now scans debounced buttons and complete encoder steps, while
`src/actions.c` resolves bindings from the active image. The runtime handles
keyboard and mouse holds, taps, toggles, scrolling, movement, consumer usages,
strings, and layer actions. Short USB reports are queued, and temporary mouse
movement and scrolling do not remain in later reports.

Chord recognition now uses the saved window (40 ms by default). Only physical
keys participating in a configured chord wait; the encoder button is independent.
A mapped second press before the window expires suppresses both single actions.
At the exact deadline the first key becomes a single action. Brief single holds
emit ordered press/release reports, even when the USB queue temporarily fills.
Chord holds release on either key, and both keys must be up before retriggering.
Layer changes resolve pending singles using their captured bindings.
Bit 7 of a chord identifier makes that three-byte chord active on every layer.
Layer-specific chords for the same key pair take precedence. Bit 6 remains
reserved; existing images have bit 7 clear and keep their original behavior.

The action queue has eight entries. Rotation is accepted only when the queue
is empty, reserving seven entries for button actions. Saturated drop counters
for button and rotation actions are available in GET_STATUS. Repeated button
taps can fill the queue during a long string; the newest transient action is
discarded and its counter advances. Held outputs and releases use a separate
path. Long strings run one character at a time.

The default build targets six keys. Set `board_build.physical_variant = 1` in
`platformio.ini` for the three-key hardware, then run `pio run -t clean` and
`pio run`. Both variants compile and the codec, protocol, USB, action, and input
host checks pass. USB discovery, control transfers, LED timing, DataFlash save,
and input behavior still need validation on physical hardware.

The build uses SDCC's small memory model for the sketch, core, and libraries.
Temporary values use internal RAM; large persistent buffers remain explicitly
in xRAM. Unused legacy HID buffers were removed, and fixed default lookup tables
now live in code memory. Momentary layer ordering uses bounded ranks, avoiding
a press counter wrapping while a layer key remains held.

The current six-key image uses 14,314 of 14,336 code bytes (22 free). It uses
625 of 876 application xRAM bytes (251 free). Add 148 separately reserved USB
bytes to the RAM total. The linker provides 133 bytes for the internal stack;
runtime stack high-water usage still needs measurement on hardware. The
128-byte staging buffer fits in application xRAM without a separate programming
mode.

The invalid-config indicator starts red on the first key and toggles every
500 ms. It reuses the encoder hold timer while inputs are inactive, and uses
the LED buffer itself for its on/off state, so no extra persistent RAM is needed.
The action queue stores only the two resolved action bytes per entry; unused
playback metadata was removed without changing queue capacity or behavior.
Preview adds one persistent byte and shares the existing LED renderer and
rainbow animation. Layer-address calculations and flash comparison loops are
shared to save code; string-pool address checks use overflow-checked byte
arithmetic. Both variants use a code-memory lookup table for rainbow offsets. The three-key
image uses 14,311 code bytes (25 free) and 616 application xRAM bytes, with
133 bytes available for the internal stack.

The project-local PlatformIO adapter may cache an earlier builder script, so
clean before switching variants or after changing `src/*.c` files.

`platformio.ini` matches the Arduino settings: CH552 Board, 24 MHz internal
clock at 5 V, user USB code with 148 bytes reserved, and P3.6 (D+) pull-up
bootloader configuration. The project-local `pio-platform/` adapter is needed
because PlatformIO does not supply this CH55xDuino Arduino core as a standard
framework. The build and upload scripts currently target macOS, matching the
installed Arduino tool package.
