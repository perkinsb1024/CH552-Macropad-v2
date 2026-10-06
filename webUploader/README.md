# Macropad Firmware Installer — Beta

*This tool is a beta prototype. macOS has been tested and verified; Windows and Linux hardware validation is still pending.* It programs the published three-key or six-key CH552 firmware through WebUSB, with no PlatformIO or Arduino installation needed by the user. Preservation of on-device profiles in DataFlash has been verified during a macOS web firmware upload.

The bundled firmware uses configuration format v9, built from revision `8339b59a`: [three-key](../releases/ch552-macropad-3-key-8339b59a.hex) and [six-key](../releases/ch552-macropad-6-key-8339b59a.hex). Use the frozen [v9 configurator](https://perkinsb1024.github.io/CH552-Macropad-v2/versions/format-v9/) after installation. The installer reads the configuration format from each bundled HEX and links to its matching editor. Current source and the latest editor target v10; v10 release generation awaits hardware validation. Back up your profile before updating; older profiles remain in DataFlash but inputs stay inactive until the matching editor migrates and saves them as v9.

The static page is built into `webapp/dist/webUploader/` for the existing GitHub Pages site. When this branch is merged and deployed, it will be available at:

https://perkinsb1024.github.io/CH552-Macropad-v2/webUploader/

## Attribution and Upstream Pin

The programming routine is from Deqing Sun's [CH55xDuino bootloader web tool](https://github.com/DeqingSun/ch55xduino/tree/ch55xduino/bootloaderWebtool). `upstream/` is a Git submodule; the parent repository records the exact commit. The initial pin is `c9f9a2a6516255284064a9dd248670545f25a322`.

Upstream supplies the [GNU Lesser General Public License 2.1](upstream/LICENSE). The published page includes its license, original source, patched adapter source, and patch. The build includes only the connection/programming portion of `ch55xbl.js`; it excludes upstream's DOM handlers and its Intel HEX parser (which credits bminer/intel-hex.js). Our strict HEX parser is separate.

## Verification Bug Patched

In the upstream verification loop, this line sends the write buffer instead of the populated verification buffer:

```javascript
await device.transferOut(endpointOut, (new Uint8Array(bootloaderWriteCmd.slice(0, bootloaderVerifyCmd[1] + 3))).buffer)
```

[`patches/0001-fix-verification-buffer.patch`](patches/0001-fix-verification-buffer.patch) changes it to:

```javascript
await device.transferOut(endpointOut, (new Uint8Array(bootloaderVerifyCmd.slice(0, bootloaderVerifyCmd[1] + 3))).buffer)
```

`build.mjs` copies the pinned file to a temporary directory and applies the patches with `git apply`. It does not modify the submodule checkout. The build fails if a patch no longer applies. Once a fix is merged upstream, update the submodule pin and remove its patch application after confirming tests still pass.

A second fix, [`patches/0002-fix-final-packet-alignment.patch`](patches/0002-fix-final-packet-alignment.patch), changes `parseInt((lastPacketSize + 7) / 8 * 8)` to `Math.ceil(lastPacketSize / 8) * 8`. The original expression adds seven rather than rounding up to an eight-byte boundary. It also turns a zero remainder into seven, preventing the following zero-remainder check from selecting a full 56-byte final packet. This could truncate firmware whose length is a multiple of 56 or send extra bytes for other lengths. Keeping this patch separate allows either fix to be removed independently after upstream accepts it.

The generated adapter scopes upstream's globals and replaces its status sink and USB entry point. Our wrapper rejects non-CH552 chips, checks USB transfer results and command status, adds timeouts, and closes failed sessions. Response checks are command-specific: configuration replies `0x0000` and the observed `0x0040` are accepted provisionally, then the following `A7` readback must confirm the requested boot options before key setup or application erase. A missing, malformed, or mismatched readback stops installation. Key setup checks the returned XOR-key checksum; erase, write, and verification require zero status. Programming and verification still use upstream's command sequence and XOR masking.

The init command retains upstream's boot configuration value `0x03`, matching this project's P3.6 (D+) setting. Readback checks bits 0–1 of the boot-options byte at `A7` reply offset 10. The [native CH55xDuino uploader](https://github.com/DeqingSun/vnproch551/blob/master/main.cpp) documents that only those boot-option bits are effective on CH552; unused fields and reserved bits are not required to echo the write packet. This confirms the requested effective configuration, without treating `0x0040` alone as proof of success. Preservation of on-device profiles in DataFlash has been verified on the tested macOS setup; additional hardware coverage still needs validation.

## Use

1. Open the beta page in desktop Chrome or Edge over HTTPS or localhost.
2. Follow the platform setup instructions below or on the page.
3. **Enter** bootloader mode. With this project's firmware, hold the encoder while connecting USB. Stock firmware may require boot pads or a physical boot button; see the [repository instructions](../README.md#how-to-upload-the-firmware).
4. Click **Connect bootloader** and select USB ID `4348:55E0`.
5. Select the three-key or six-key variant, then click **Install firmware**.
6. Keep USB connected through programming and verification. After restart, use the configurator to load/save your profile.

The bootloader identifies the CH552 chip, not the board's key count. Selecting the correct variant is the user's responsibility. This beta accepts the same bootloader range as the pinned source: 2.3.1–2.5.0. Other versions are rejected before erase. Only the bundled published HEX files are selectable.

### Windows

WebUSB requires **WinUSB** on the bootloader interface. If necessary, download [Zadig from its official site](https://zadig.akeo.ie/), enter bootloader mode, enable **Options → List All Devices**, and select only USB ID `4348:55E0`. Choose **WinUSB** and Install/Replace Driver. Do not replace the normal keyboard/macropad driver. Administrator access may be needed, and the change may affect compatibility with other WCH programming tools.

Sources: [Chrome's Windows WebUSB requirements](https://developer.chrome.com/docs/capabilities/build-for-webusb#windows), [official Zadig guide](https://github.com/pbatard/libwdi/wiki/Zadig).

### macOS

Tested and verified: a successful hardware firmware installation was confirmed on macOS on October 1, 2026, including boot configuration readback, firmware verification, and preservation of the on-device profile in DataFlash.

No extra USB driver is normally necessary. Close other tools using the device before connecting.

Source: [Chrome's macOS WebUSB requirements](https://developer.chrome.com/docs/capabilities/build-for-webusb#macos).

### Linux

Your account may need permission to open the bootloader's USB device. On distributions using `plugdev`, an administrator can put this rule in `/etc/udev/rules.d/70-ch552-bootloader.rules`:

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="4348", ATTR{idProduct}=="55e0", MODE="0660", GROUP="plugdev"
```

Check group membership with `id -nG`. If appropriate for your distribution, add your account with `sudo usermod -aG plugdev "$USER"`, then log out and back in. Reload rules with `sudo udevadm control --reload-rules`, then reconnect the device in bootloader mode. Group names and account-management commands can vary by distribution. Do not run the browser as root.

Sources: [Chrome's Linux WebUSB permissions](https://developer.chrome.com/docs/capabilities/build-for-webusb#linux), [udev rule reference](https://www.freedesktop.org/software/systemd/man/latest/udev.html), [udevadm reference](https://www.freedesktop.org/software/systemd/man/latest/udevadm.html).

## Build and Test

Requires Node.js 22+ and Git. Initialize the pinned source after cloning:

```sh
git submodule update --init webUploader/upstream
node webUploader/build.mjs
node --test webUploader/tests/*.test.mjs
```

To serve the standalone prototype locally:

```sh
python3 -m http.server 8080 --directory webUploader/dist
```

Open `http://localhost:8080/`. The configurator backlink is intended for the combined Pages deployment. To build the complete site, run `npm run build` in `webapp/`; it adds the uploader to `webapp/dist/webUploader/`.

The build requires exactly one generated HEX per variant in `releases/` (including the release tool’s `dirty-` filename marker for uncommitted firmware), validates record checksums and the 14 KiB application boundary, copies those files into `firmware/`, and writes a SHA-256 manifest. The page checks each download against that manifest before enabling install. The Pages workflow watches `releases/`, `webUploader/`, and `.gitmodules` as well as the configurator.

## Beta Validation Still Required

macOS hardware installation has been tested and verified. Windows and Linux hardware installation remain unverified. This macOS result does not establish coverage of every board variant or bootloader version, or profile preservation on untested setups.

Automated tests exercise the patched routine with a simulated USB bootloader, including real HEX files, verification command selection, failure responses, and timeouts. They do not establish hardware compatibility. Before recommending this installer for general use, test each supported OS, both board variants, the bootloader versions in use, reconnection after failure, and preservation of bootloader access and saved profiles.
