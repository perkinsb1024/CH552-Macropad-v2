# CH552 firmware updater

For the Waveshare RP2350-USB-A board. Its USB device name is **CH552 FW UPDATER**; the firmware drive appears as **CH552 FWUP**.

## Set up

1. Leave the RP2350's USB-A port empty. Hold **BOOT** while connecting its USB-C port to your computer, then release **BOOT** when the boot drive appears.
2. Copy [ch552_programmer.uf2](ch552_programmer.uf2) to the boot drive. The board restarts and the **CH552 FWUP** drive appears.
3. [Download the firmware for your macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/webUploader/), selecting the correct three-key or six-key model.
4. Copy the downloaded `.hex` file directly onto **CH552 FWUP**. The drive must contain exactly one `.hex` file; remove any previous one. Do not reformat the drive.
5. Wait for blinking green, then eject the drive. The firmware is saved and survives power loss.

## Update a macropad

1. Power the RP2350 through USB-C, with its USB-A port empty. Wait for blinking green.
2. Press **BOOT**. When the LED turns solid cyan, plug the macropad into the RP2350's USB-A port within 2000ms.
3. Leave everything connected while the LED is yellow. Solid green means programming completed; unplug the macropad and connect it normally to use it.
4. If the LED turns solid red, unplug the macropad, press **RESET** on the RP2350, wait for blinking green, and repeat from step 2.

The connection timing is finicky, but the process does work and may take several tries. If it still fails after several attempts, eject the drive and disconnect USB-C from the computer, then use a USB-C power brick to power the RP2350. Keep the macropad unplugged until the LED turns cyan after pressing **BOOT**.

## LED colors

Rays around a swatch indicate blinking; plain circles indicate solid light. The swatches are not animated.

| LED | Pattern | Meaning |
| --- | --- | --- |
| ![Blinking orange](led/orange-blinking.svg) Orange | Blinking | No `.hex` file loaded. |
| ![Blinking red](led/red-blinking.svg) Red | Blinking | Invalid or multiple `.hex` files, or a save failure. Fix the file selection; reset if needed. |
| ![Blinking blue](led/blue-blinking.svg) Blue | Blinking | Copying or saving; wait. |
| ![Blinking green](led/green-blinking.svg) Green | Blinking | Firmware saved; ready for **BOOT**. |
| ![Solid cyan](led/cyan-solid.svg) Cyan | Solid | Plug in the macropad within 2000ms. |
| ![Solid yellow](led/yellow-solid.svg) Yellow | Solid | Programming; leave connected. |
| ![Solid red](led/red-solid.svg) Red | Solid | Attempt failed; unplug the macropad before resetting and retrying. |
| ![Solid green](led/green-solid.svg) Green | Solid | Programming completed; unplug the macropad. |
