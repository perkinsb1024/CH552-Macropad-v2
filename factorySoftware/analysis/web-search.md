# Published factory firmware search

Searched on 2026-10-07 for `1189:8890`, **MINI KeyBoard V02.1.1**, CH552 macropad factory/original firmware dumps, and Chinese factory-firmware terms. No confirmed factory application image for this pad was located. This is a search result, not proof that no copy exists.

## Closest leads

- [Original Firmware? — biemster/3keys_1knob issue 5](https://github.com/biemster/3keys_1knob/issues/5): explicitly requests the original firmware dump. The retrieved issue is open and shows no supplied dump or answer.
- [SIKAI CASE software downloads](https://sikaicase.com/blogs/support/setting-for-software): supplies newer/older Windows configurators, a Mac download, and a lighting-fix **refresh software** archive. The page's firmware-related title should not be taken as evidence that it supplies an MCU image.
- [Lighting-fix archive](https://cdn.shopifycdn.net/s/files/1/0655/8570/9299/files/release.7z?v=1689124878): downloaded to `/private/tmp/macropad-refresh.7z` and statically inspected. Contains a Qt application `lanague.exe`, DLLs, object files, generated Qt metadata/resource source, and translations. No separate `.hex` or `.bin` image is present. Preliminary executable/symbol/resource searches found HID configuration names, but no explicit firmware/bootloader/flash/upgrade command. This was not a complete native-code disassembly; an unidentified embedded image is not conclusively excluded. Compatibility with our CH552 pad is unconfirmed.
- [EScripts-content/mini-3key-configurator](https://github.com/EScripts-content/mini-3key-configurator): a reverse-engineered configurator specifically for `1189:8890`, useful protocol context rather than a confirmed factory image.

## Replacement firmware found

- [eccherda/ch552g_mini_keyboard](https://github.com/eccherda/ch552g_mini_keyboard): replacement source for the three-key/encoder CH552 pad.
- [MrGeorgeK55/Macropad-3-keys-1-knob](https://github.com/MrGeorgeK55/Macropad-3-keys-1-knob): replacement source, with configuration-data dumping instructions. Its `flashdata.bin` is configuration, not a stock application dump.
- [zevro-ai/ch552-text-macropad-firmware](https://github.com/zevro-ai/ch552-text-macropad-firmware): includes a prebuilt replacement HEX for a fixed text/consumer-control layout. It is not factory firmware.

## Identity caveat

[ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool) lists `0x1189` as Trisat Industrial Co., Ltd. and documents the ID across multiple keypad models. The VID/PID alone cannot establish the board manufacturer, MCU, pin mapping, or firmware compatibility. Treat a factory image as an analysis candidate until the actual board/revision is matched.

The most direct remaining source would be a seller/OEM application HEX/BIN for the exact board revision, specifically distinguished from the Windows configuration application. A published image from a related revision could still be useful for disassembly even when unsuitable for flashing this unit.

## Follow-up: WebHub software bootloader command

Knurl documents factory WebHub subcommand `0x5A` for bootloader entry. Its `1189:8890` support uses the separate Legacy protocol, so applicability to our pads is unconfirmed. See [the investigation notes and prototype test procedure](webhub-bootloader.md).
