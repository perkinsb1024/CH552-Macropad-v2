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

`platformio.ini` matches the Arduino settings: CH552 Board, 24 MHz internal
clock at 5 V, user USB code with 148 bytes reserved, and P3.6 (D+) pull-up
bootloader configuration. The project-local `pio-platform/` adapter is needed
because PlatformIO does not supply this CH55xDuino Arduino core as a standard
framework. The build and upload scripts currently target macOS, matching the
installed Arduino tool package.
