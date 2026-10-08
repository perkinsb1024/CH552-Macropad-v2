# CH552 Firmware Updater

For this project, you will need:
- A [Waveshare RP2350-USB-A board](https://www.waveshare.com/rp2350-usb-a.htm) (also available on [Amazon](https://www.amazon.com/Waveshare-Development-Raspberry-Dual-Architecture-Microcontroller/dp/B0DW8Z2K7C/))
- A compatible CH552G-based 3- or 6-key macropad (see [the main README.md](../../README.md) for more information)
- A USB-A to USB-C cable to connect the RP2350 board to the macropad (make sure it supports data and not just power)
- Any USB-C cable to connect the RP2350 to your computer (make sure it supports data and not just power)

## Set Up

1. Leave the RP2350's USB-A port empty. Hold **BOOT** while connecting its USB-C port to your computer, then release **BOOT** when the boot drive appears
2. Copy [ch552_programmer.uf2](ch552_programmer.uf2) to the boot drive. The board restarts and the **CH552 FWUP** drive appears
3. [Download the firmware for your macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/webUploader/), selecting the correct 3- or 6-key model
4. Copy the downloaded `.hex` file directly onto **CH552 FWUP**. The drive must contain exactly one `.hex` file; remove any previous one. Do not reformat the drive
5. Wait for blinking green, then eject the drive. The `.hex` file will remain on the RP2350 even across power cycles

## Update Your Macropad

1. Power the RP2350 through USB-C, with its USB-A port empty. Wait for the LED to blink green
    - If it does not blink green, refer to [the color table](#led-color-meaning) below to see what it means
2. Press **BOOT**. When the LED turns solid cyan, plug* the macropad into the RP2350's USB-A port within 2 seconds
3. Leave everything connected while the LED is yellow. Solid green means programming completed; unplug the macropad and connect it normally to use it
4. If the LED turns solid red, unplug the macropad, press **RESET** on the RP2350, wait for blinking green, and repeat from step 2

> [!NOTE]
> *The connection timing is finicky, and will likely take several tries before it works. If it still fails after several attempts, eject the drive from the computer, then use a USB power brick to power the RP2350. Keep the macropad unplugged until the RP2350's LED turns cyan after pressing **BOOT**

## LED Color Meaning

| LED | Pattern | Meaning |
| --- | --- | --- |
| ![Blinking orange](led/orange-blinking.svg) Orange | Blinking | No `.hex` file loaded |
| ![Blinking red](led/red-blinking.svg) Red | Blinking | Invalid or multiple `.hex` files, or a save failure. Fix the file selection; reset if needed |
| ![Blinking blue](led/blue-blinking.svg) Blue | Blinking | Copying or saving; wait |
| ![Blinking green](led/green-blinking.svg) Green | Blinking | Firmware saved; press **BOOT** to begin |
| ![Solid cyan](led/cyan-solid.svg) Cyan | Solid | Plug in the macropad within 2 seconds |
| ![Solid yellow](led/yellow-solid.svg) Yellow | Solid | Programming; *do not unplog the macropad* |
| ![Solid red](led/red-solid.svg) Red | Solid | Attempt failed; unplug the macropad before resetting and retrying |
| ![Solid green](led/green-solid.svg) Green | Solid | Programming completed; unplug the macropad |
