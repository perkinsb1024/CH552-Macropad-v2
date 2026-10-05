# Shortcut catalog

The catalog lives in `src/model/shortcuts.ts`. Each preset has a stable ID, a display name, OS/application/category tags, its action, and an optional binding and context note. App-specific display names include the app so identical-looking commands can be distinguished. Search matches all words across names, bindings, and tags, case-insensitively; try `word superscript`, `vim buffer`, or `media brightness`.

Only the action is copied into a profile. Library tags and notes do not consume device flash. The action list scrolls at a maximum of 300 px (or 40% of the viewport height on smaller screens), leaving the OS buttons and search outside the scrolling region.

## Context and supported actions

- Keyboard presets send one physical US-layout key with modifiers. Host/app versions, customized bindings, keyboard layouts, and focused controls can change their behavior. Word presets use the current Microsoft 365 bindings; older releases have different subscript bindings.
- macOS space navigation requires those shortcuts to be enabled in Keyboard > **Keyboard Shortcuts** > **Mission Control**.
- macOS screenshot presets cover selection/full screen, save/clipboard, and the capture/recording toolbar. After invoking a selection capture, press **Space** on the host keyboard to switch to window capture. The toolbar also provides window capture. The firmware cannot combine the capture shortcut and a subsequent **Space** into a single preset.
- Siri window/selection presets require macOS 27+ with Siri AI enabled. Classic Siri's double-Command/Fn triggers cannot be represented as a single firmware action. Spotlight can also start Siri conversations on supported systems.
- **Sleep**, power, brightness, and other consumer media actions are host/hardware-dependent. The **Sleep** media key is not the same as Apple's power-button sleep shortcut. Apple Fn/Globe, **Power**, and modified **Eject** shortcuts are not supported by this firmware's keyboard action format.
- Markdown presets insert literal markers/templates; they do not wrap selected text or place the cursor inside the inserted snippet. GFM marks GitHub Flavored Markdown extensions.
- Vim text presets start in **Normal** mode. Ex commands include a final **Enter**. Use the separate **Escape** preset to leave **Insert** mode first; strings cannot contain **Escape**. The library does not emulate arbitrary sequences of modified key combinations.
- Typed snippets share the firmware's existing string pool and storage limits. Adding many snippets to keys may fill the device's 128-byte configuration; the existing storage meter and validation still apply.

## Official references

Bindings reviewed on September 29, 2026:

- [Apple keyboard shortcuts](https://support.apple.com/en-us/102650) and [screenshots](https://support.apple.com/en-us/102646).
- [Windows keyboard shortcuts](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows).
- [Microsoft Word shortcuts](https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word) and [superscript/subscript](https://support.microsoft.com/en-us/word/format-text-as-superscript-or-subscript-in-word).
- [PowerPoint editing shortcuts](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations) and [slideshow shortcuts](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations).
- [Google Docs shortcuts](https://support.google.com/docs/answer/179738?hl=en) and [Chrome shortcuts](https://support.google.com/chrome/answer/157179?hl=en).
- [VS Code default keybindings](https://code.visualstudio.com/docs/reference/default-keybindings).
- [Vim quick reference](https://vimhelp.org/quickref.txt.html).
- [CommonMark syntax](https://commonmark.org/help/).

Standard keyboard usages and media usages reuse the configurator's existing HID catalogs in `src/keys/keyboard.ts` and `src/keys/consumer.ts`.
