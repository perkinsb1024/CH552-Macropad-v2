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

Chord recognition now uses the saved window (40 ms by default). Only physical
keys participating in a configured chord wait; the encoder button is independent.
A mapped second press before the window expires suppresses both single actions.
At the exact deadline the first key becomes a single action. Brief single holds
emit ordered press/release reports, even when the USB queue temporarily fills.
Chord holds release on either key, and both keys must be up before retriggering.
Layer changes resolve pending singles using their captured bindings.

The action queue has eight entries. Rotation is accepted only when this queue
is empty, reserving the other seven slots for one action per button.
Excess rotation events are discarded. Repeated button taps can still exhaust
all eight entries during a long string; in that case the newest transient action
is discarded. Held outputs and their releases do not use this action queue.
Long strings run one character at a time.

The default build targets six keys. Set `board_build.physical_variant = 1` in
`platformio.ini` for the three-key hardware, then run `pio run -t clean` and
`pio run`. Both variants compile and pass host action checks. DataFlash upload,
saving, and verification remain firmware work. USB discovery, control transfers,
LED timing, and input behavior still need validation on physical hardware.

The build uses SDCC's small memory model for the sketch, core, and libraries.
Temporary values use internal RAM; large persistent buffers remain explicitly
in xRAM. Unused legacy HID buffers were removed, and fixed default lookup tables
now live in code memory. Momentary layer ordering uses bounded ranks, avoiding
a press counter wrapping while a layer key remains held.

The current six-key image uses 13,566 of 14,336 code bytes (770 free), including
chord recognition, compared with 14,124 before this phase. It uses 558 of 876
application xRAM bytes (318 free), plus the separately reserved 148 USB bytes.
The three-key build uses the same code size and 549 application xRAM bytes.
Both maps leave 141 bytes for the internal stack, starting at `0x73`; runtime
stack high-water usage has not yet been measured. A 128-byte staging buffer
would leave 190 application xRAM bytes on the six-key board before upload
bookkeeping, so a dedicated programming mode is not currently needed for RAM.
Flash-code space still needs checking as persistence is added.

The project-local PlatformIO adapter may cache an earlier builder script, so
clean before switching variants or after changing `src/*.c` files.

`platformio.ini` matches the Arduino settings: CH552 Board, 24 MHz internal
clock at 5 V, user USB code with 148 bytes reserved, and P3.6 (D+) pull-up
bootloader configuration. The project-local `pio-platform/` adapter is needed
because PlatformIO does not supply this CH55xDuino Arduino core as a standard
framework. The build and upload scripts currently target macOS, matching the
installed Arduino tool package.
