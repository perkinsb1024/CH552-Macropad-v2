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
the first three keys during startup. Holding the first three keys at power-up
always enters the bootloader and cannot be disabled in a profile. The Upload
task always invokes the programmer, even when the HEX file is already built.

To clear the saved profile for testing, run `pio run -t erase-config`. This
temporarily uploads a small utility that invalidates the profile, then uploads
the normal firmware again. With no profile, the keys and encoder stay inactive
and one red LED blinks at 1 Hz; hold the first three keys while powering up to
enter the recovery bootloader.

The firmware uses the version 1 image codec in `src/config.c`. It validates a
128-byte image and exposes layer, binding, chord, and palette accessors. It does
not provide a fallback profile: when DataFlash has no valid image, physical
inputs stay inactive and one red LED blinks at 1 Hz while USB configuration
access remains available.
The byte format and palette are documented in `protocol/config-v1.md`. Run the
codec checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -I src \
  tests/config_test.c src/config.c -o /tmp/ch552-config-test
/tmp/ch552-config-test
```

The web app offers an editor starter profile with the original shortcuts,
encoder middle-click and scroll directions, the encoder-hold bootloader option,
and six original LED colors. A key's layer-selected LED color is shown while
that key is held and clears on release.

The firmware exposes the HID configuration protocol in `protocol/hid-v1.md`.
At startup it reads and validates DataFlash. If flash is invalid, the firmware
keeps inputs inactive and blinks one red LED at 1 Hz until a valid profile is
uploaded. GET_INFO,
GET_STATUS, READ_FLASH, READ_ACTIVE, BEGIN_WRITE, WRITE_CHUNK, COMMIT_WRITE,
and ABORT_WRITE are implemented. Saves
validate the full image, avoid programming unchanged bytes, write validity last,
then verify actual DataFlash before applying the profile.

Run the focused firmware checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -I src \
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

The current six-key image uses 14,074 of 14,336 code bytes (262 free). It uses
635 of 876 application xRAM bytes (241 free). Add 148 separately reserved USB
bytes to the RAM total. The linker provides 138 bytes for the internal stack;
runtime stack high-water usage still needs measurement on hardware. The
128-byte staging buffer fits in application xRAM without a separate programming
mode.

The project-local PlatformIO adapter may cache an earlier builder script, so
clean before switching variants or after changing `src/*.c` files.

`platformio.ini` matches the Arduino settings: CH552 Board, 24 MHz internal
clock at 5 V, user USB code with 148 bytes reserved, and P3.6 (D+) pull-up
bootloader configuration. The project-local `pio-platform/` adapter is needed
because PlatformIO does not supply this CH55xDuino Arduino core as a standard
framework. The build and upload scripts currently target macOS, matching the
installed Arduino tool package.
