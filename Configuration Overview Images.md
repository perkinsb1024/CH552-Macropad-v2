# Configuration Overview Images

Image inventory and capture notes for [Configuration Overview.md](Configuration%20Overview.md). All ten images are captured and included in the guide, with no remaining placeholders. They show the current configurator using a simulated six-key device. Images #1–#4 were captured through Chrome's native interface; #5–#10 were captured with Playwright in a separate headless Chrome session.

## Captured and included

| Screenshot | File | Contents |
| --- | --- | --- |
| #1 — Workspace | [01-workspace.png](images/configuration-overview/01-workspace.png) | Simulated connection, top-bar buttons, Profile, layer tabs, six keys, wheel inputs, storage, and backup controls. |
| #2 — Key editor | [02-key-editor.png](images/configuration-overview/02-key-editor.png) | Key 5 assigned to Command+C using Key tap; Capture, modifiers, press-color palette, Apply to layer, and preview buttons. |
| #3 — Storage | [03-storage.png](images/configuration-overview/03-storage.png) | Two six-key layers using 53 bytes, with 75 of 128 bytes free and the full storage breakdown. |
| #4 — Backup | [04-backup.png](images/configuration-overview/04-backup.png) | Export JSON, Export to Clipboard, Import profile, Import from Clipboard, and Reset to starter profile. |
| #5 — Shortcut library | [05-shortcuts.png](images/configuration-overview/05-shortcuts.png) | Expanded Shortcuts with Mac selected, a copy search, matching presets, and the drag/click hint. |
| #6 — Layers and startup | [06-layers.png](images/configuration-overview/06-layers.png) | Profile settings and layer tabs; Layer 2 is selected for editing while Layer 1 remains the startup layer. |
| #7 — Global chord | [07-chord.png](images/configuration-overview/07-chord.png) | Keys 1 + 2 with the global globe enabled, beside its Relative layer +1 action editor. |
| #8 — Timed actions | [08-timed-actions.png](images/configuration-overview/08-timed-actions.png) | Approximately twenty-minute repeating dim amber reminder, expanded next-input restore action, and input consumption. |
| #9 — Temporary LED effect | [09-led-effect.png](images/configuration-overview/09-led-effect.png) | Set all LEDs with Blink, three repeats, Rainbow, and Dim selected. |
| #10 — Drag and drop | [10-drag-drop.png](images/configuration-overview/10-drag-drop.png) | Two live drag captures: center swap highlighting and the edge insertion line. |

## Recreating images #5–#10

### #5 — Shortcut library

- **Guide location:** Shortcuts, copy and paste, and drag and drop → Use the shortcut library.
- **Filename:** `images/configuration-overview/05-shortcuts.png`.
- **Setup:** Select a numbered key, expand Shortcuts, choose Mac or Windows, and search for `copy`.
- **Include:** Shortcuts heading, operating-system selector, search field, matching preset buttons, and the drag/click hint.
- **Crop:** The complete Shortcuts card. Scroll the sidebar until every relevant control is visible.
- **Suggested alt text:** “Shortcut library filtered to copy actions, with Mac and Windows choices and matching presets.”

### #6 — Layers and startup

- **Guide location:** Layers: several sets of controls → Add, edit, and remove layers.
- **Filename:** `images/configuration-overview/06-layers.png`.
- **Setup:** Start from the two-layer profile. Select Layer 2 for editing while keeping Layer 1 as the Startup layer.
- **Include:** Startup layer selection, layer tabs, the start badge on Layer 1, selected Layer 2, Add layer, and the layer trash button.
- **Crop:** The Profile card and layer-tab area, placed together vertically at a consistent scale.
- **Suggested alt text:** “Layer 2 selected for editing while Layer 1 remains the startup layer.”

### #7 — Global chord

- **Guide location:** Chords: two keys together.
- **Filename:** `images/configuration-overview/07-chord.png`.
- **Setup:** On Layer 2, add Keys 1 + 2, assign Relative layer with offset +1, and enable the globe button to make it global.
- **Include:** The two key numbers, chord action, enabled globe, remove button, and the matching Action editor with Relative layer and +1. Include the chord window if it fits clearly.
- **Crop:** Chords card plus the relevant Action editor controls. Avoid unrelated sidebar cards.
- **Suggested alt text:** “Keys 1 and 2 form a global chord that cycles forward one layer.”

### #8 — Timed actions

- **Guide location:** Timed actions and reminders.
- **Filename:** `images/configuration-overview/08-timed-actions.png`.
- **Setup:** Add a timer with interval 9, approximately 19 minutes 40 seconds. Leave Restart on key / encoder input off. Assign When timer fires to LED control → Set all LEDs → Always on, Amber, Dim. Expand On next input, assign LED control → Set all LEDs → As configured, and enable Consume this input.
- **Include:** Timer heading, interval and approximate time, restart checkbox, When timer fires action, expanded On next input action, Consume this input, and the timing explanation.
- **Crop:** The complete timer card with readable labels. This illustrates the guide's repeating lighting reminder example.
- **Suggested alt text:** “A repeating amber lighting reminder with a roughly twenty-minute interval and a next-input action that clears it.”

### #9 — Temporary LED effect

- **Guide location:** LED colors and effects → Temporary effects: Set all LEDs.
- **Filename:** `images/configuration-overview/09-led-effect.png`.
- **Setup:** Select a timer's When timer fires action and choose LED control → Set all LEDs → Blink. Set Blink count to 3, choose Rainbow, and choose Dim. Use a separate demonstration state from the amber reminder shown in #8.
- **Include:** Action, LED command, Effect, Blink count, color palette with Rainbow selected, and Full Brightness/Dim buttons.
- **Crop:** The complete Action editor. Using a timer input keeps the illustration focused on the effect controls without a separate key press color section.
- **Suggested alt text:** “LED control configured to blink all LEDs three times in a dim rainbow.”

### #10 — Drag and drop

- **Guide location:** Shortcuts, copy and paste, and drag and drop → Drag and drop existing actions.
- **Filename:** `images/configuration-overview/10-drag-drop.png`.
- **Setup:** Give three numbered keys clearly different actions and colors. Take one capture while dragging over another key's center, then a second while dragging to an edge or a gap so the insertion line appears. Capture before dropping.
- **Include:** The dragged action, highlighted swap destination in the first capture, and insertion line in the second.
- **Crop:** Just the keys and relevant drag feedback. Put the two crops side by side with simple labels, “Center: swap” and “Edge: insert.”
- **Suggested alt text:** “Dragging to a key's center highlights a swap target; dragging to an edge shows an insertion line.”

## Capture notes

1. Use the [simulated six-key device](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=six) or [simulated three-key device](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=three). The six-key layout matches the existing screenshots.
2. Use a disposable demonstration profile. Export anything you want to preserve before replacing or resetting it.
3. Keep controls large enough to read. On a wide screen, scroll the right-hand sidebar separately to reveal the whole card you want to capture.
4. Crop away browser tabs, the address bar, desktop content, the technical footer, and unrelated status information. Keep enough surrounding UI to make the selected input and setting clear.
5. Save replacements under the same filenames to update the guide's existing Markdown image links, for example:

   ```markdown
   ![Shortcut library filtered to copy actions, with Mac and Windows choices and matching presets.](images/configuration-overview/05-shortcuts.png)
   ```

6. Check the rendered guide after replacing each image. Crop or resize if labels are hard to read. The layers, chord, and drag illustrations combine separate real captures; the drag comparison adds only the two explanatory labels.

The screenshot numbers are identifiers, not the order in which the images appear in the guide.
