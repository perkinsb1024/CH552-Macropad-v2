# RP2350 Firmware Updater for CH552G-Based Macropads

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
5. Wait for blinking green, then eject the drive. The `.hex` file will remain on the RP2350 even if you unplug it

## Update Your Macropad

1. Power the RP2350 through USB-C, with its USB-A port empty. Wait for the LED to blink green
    - If it does not blink green, refer to [the color table](#led-color-meaning) below to see what it means
2. Press **BOOT**. When the LED turns solid cyan, plug* the macropad into the RP2350's USB-A port within 2 seconds
3. Leave everything connected while the LED is yellow. A solid green LED means programming completed successfully. You can now plug the macropad directly into your computer and use [the configurator](https://perkinsb1024.github.io/CH552-Macropad-v2/) to set it up
4. If the LED turns solid red, unplug the macropad, press **RESET** on the RP2350, wait for blinking green, and repeat from step 2

> [!NOTE]
> *The connection timing is finicky, and will likely take several tries to get it right. Plugging the cable in quickly can help, as the power pins are slightly longer than the data pins and you need them to make contact at the same time. If it still fails after several attempts, eject the drive from the computer, then use a USB power brick to power the RP2350. Keep the macropad unplugged until the RP2350's LED turns cyan after pressing **BOOT**

## LED Color Meaning

| Pattern | Color | Meaning |
| --- | --- | --- |
| Blinking | ![Blinking orange](led/orange-blinking.svg) Orange | No `.hex` file loaded |
| Blinking | ![Blinking red](led/red-blinking.svg) Red | Invalid or multiple `.hex` files, or a save failure.<br>Delete all files on the **CH552 FWUP** drive and try again |
| Blinking | ![Blinking blue](led/blue-blinking.svg) Blue | Copying or saving; wait |
| Blinking | ![Blinking green](led/green-blinking.svg) Green | Firmware saved; press **BOOT** to begin |
| Solid | ![Solid cyan](led/cyan-solid.svg) Cyan | Plug in the macropad within 2 seconds |
| Solid | ![Solid yellow](led/yellow-solid.svg) Yellow | Programming; *do not unplog the macropad* |
| Solid | ![Solid red](led/red-solid.svg) Red | Attempt failed; unplug the macropad, reset the RP2350 and try again |
| Solid | ![Solid green](led/green-solid.svg) Green | Success! Programming completed |
