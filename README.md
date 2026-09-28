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
the first three keys during startup. The Upload task always invokes the
programmer, even when the HEX file is already built.

The firmware configuration work has started with the version 1 image codec in
`src/config.c`. It validates a 128-byte image, provides built-in defaults for
both physical variants, and exposes layer, binding, chord, and palette accessors.
The byte format and palette are documented in `protocol/config-v1.md`. Run the
codec checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -I src \
  tests/config_test.c src/config.c -o /tmp/ch552-config-test
/tmp/ch552-config-test
```

The firmware now exposes the read-only HID protocol in `protocol/hid-v1.md`.
At startup it reads and validates DataFlash, falling back to built-in defaults
when flash is invalid. GET_INFO, GET_STATUS, READ_FLASH, and READ_ACTIVE are
implemented. Run the protocol checks with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -D__data= -I src \
  tests/protocol_test.c src/config.c src/protocol_firmware.c \
  -o /tmp/ch552-protocol-test
/tmp/ch552-protocol-test
```

The fixed action arrays and their blocking handlers have been removed. The
sketch now scans debounced buttons and complete encoder steps, while
`src/actions.c` resolves bindings from the active image. The runtime handles
keyboard and mouse holds, taps, toggles, scrolling, movement, consumer usages,
strings, and layer actions. Short USB reports are queued, and temporary mouse
movement and scrolling do not remain in later reports. Run the action checks
with:

```sh
cc -std=c99 -Wall -Wextra -Werror -D__xdata= -D__code= -I src \
  tests/actions_test.c src/config.c src/actions.c -o /tmp/ch552-actions-test
/tmp/ch552-actions-test
```

The default build targets six keys. Set `board_build.physical_variant = 1` in
`platformio.ini` for the three-key hardware, then run `pio run -t clean` and
`pio run`. The two variants were compiled separately; neither has been tested
on a physical pad yet. Chord recognition and DataFlash saving remain firmware
work. The action queue has eight entries and drops a new transient action when
full; long strings run one character at a time. USB discovery and control
report handling still need validation on a physical device and desktop host.

The baseline build before this work used 118 bytes of internal data, 128 bytes
of xRAM plus 130 initialized xRAM bytes, and a code image ending near `0x1C1F`.
The current six-key map uses 122 bytes of internal data, 652 bytes of xRAM
plus 29 initialized xRAM bytes, and its code image ends near `0x372C`. The
linker allows code through `0x37FF`; later milestones must continue checking
the map. The project-local PlatformIO adapter may cache an earlier builder
script, so clean before switching variants or after changing `src/*.c` files.

`platformio.ini` matches the Arduino settings: CH552 Board, 24 MHz internal
clock at 5 V, user USB code with 148 bytes reserved, and P3.6 (D+) pull-up
bootloader configuration. The project-local `pio-platform/` adapter is needed
because PlatformIO does not supply this CH55xDuino Arduino core as a standard
framework. The build and upload scripts currently target macOS, matching the
installed Arduino tool package.
