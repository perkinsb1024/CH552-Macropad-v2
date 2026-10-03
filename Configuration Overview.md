# Configuration Overview

Using this macropad gives you quick access to the things you do most often: copy and paste, control music, scroll, type short phrases, take screenshots, or use the built-in LEDs as a reminder to take a break and stretch.

You configure it in your browser with the configurator tool. Once you click **Save to device**, the settings stay on the macropad — even when you unplug it or use it on a different computer. You do not need to keep the configurator open for the macropad to work.

This guide covers the current configurator and its supported three-key and six-key wired macropads with a clickable wheel. Your device needs this project's firmware installed first; factory settings cannot be edited with this tool. See the [setup instructions](README.md#how-to-upload-the-firmware) if it has not been installed yet. Some macropads do not have LEDs fitted.

## Index

1. [Get connected—or try a virtual macropad](#get-connectedor-try-a-virtual-macropad)
2. [Find your way around](#find-your-way-around)
3. [Configure your first shortcut](#configure-your-first-shortcut)
4. [Triggers: what starts an action](#triggers-what-starts-an-action)
5. [Available actions](#available-actions)
6. [Layers: several sets of controls](#layers-several-sets-of-controls)
7. [Chords: two keys together](#chords-two-keys-together)
8. [Timed actions and reminders](#timed-actions-and-reminders)
9. [LED colors and effects](#led-colors-and-effects)
10. [Shortcuts, copy and paste, and drag and drop](#shortcuts-copy-and-paste-and-drag-and-drop)
11. [The 128-byte limit](#the-128-byte-limit)
12. [Save, back up, and restore](#save-back-up-and-restore)
13. [Example configurations](#example-configurations)
14. [Troubleshooting](#troubleshooting)

## Get connected—or try a virtual macropad

### Connect your own device

1. Open the [Macropad Configurator](https://perkinsb1024.github.io/CH552-Macropad-v2/) in desktop **Chrome** or **Edge**
2. Plug in your macropad with a USB data cable
3. Click **Connect macropad**. Choose **Universal Macropad** in the browser's device chooser and connect
4. The configurator loads the saved profile—the complete collection of your settings. If the device has no valid profile, it offers a starter profile instead
5. Make your changes, click **Save to device**, and wait for **Saved** before unplugging it

If a new device blinks one red LED and its controls do nothing, save a valid profile to activate it.

### Practice without hardware

Open a [virtual three-key macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=three) or a [virtual six-key macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=six). You can also open **More connection options**, the arrow beside **Connect macropad**, and choose a simulated device.

The simulator lets you explore the editor and practice saving a profile. Saving there only updates the virtual device; it does not configure your physical macropad or send real keyboard and mouse actions to your computer. Export a profile you want to keep.

For editing without a connection, choose **edit offline** for a three-key or six-key device on the welcome screen. Safari and Firefox can edit and export profiles, but cannot save them directly to a USB macropad. To apply an offline profile, connect the matching physical device in a supported browser, import your exported profile, and save it.

## Find your way around

![The configurator with a simulated six-key macropad, profile settings, layers, and storage meter](images/configuration-overview/01-workspace.png)

*Screenshots in this guide use a simulated device. The controls work the same way when editing a connected macropad.*

| Area | What it does |
| --- | --- |
| Top bar | Connect, undo or redo edits, read saved settings, and save to the device |
| **Profile** | Choose the startup layer and chord timing. Rainbow settings and the meaning of an “Off” key LED appear when relevant. These settings apply across layers |
| Layer tabs | Choose which layer you are **editing**, add a layer, or rearrange layers |
| Macropad picture | Click a numbered key, **Turn left**, **Press**, or **Turn right** to select its action |
| **Action editor** | Choose what the selected control does and adjust its settings. For a numbered key, you can also pick its press color here |
| **Chords** | Assign actions to two-key combinations |
| **Layer options** | Set the current layer's indicator lighting |
| **Timed actions** | Run actions repeatedly or after inactivity, across all layers |
| **Shortcuts** | Search ready-made actions and apply them with a click or drag |
| **Device storage** | See how much of the 128-byte budget your profile uses |
| **Backup & restore** | Export, import, or reset the profile in the editor |

The right-hand column scrolls separately on a wide screen. Scroll over it, or use its arrow buttons, to reach sections farther down.

**Editing a layer is different from activating it on the device.** Clicking a layer tab changes the editor's view. Your physical macropad changes layers using a configured action. The **Active layer** readout in **Backup & restore** shows the layer the connected device is currently using.

## Configure your first shortcut

For example, make a key copy the selected text:

1. Select the layer you want to edit, then click a numbered key in the macropad picture
2. In **Action**, choose **Key tap**
3. Choose **C** in the **Key** list
4. Enable **Ctrl** for Windows, or **GUI (Win / Cmd)** for Mac. Leave the other modifiers off
5. Pick an **LED color on key press**, if desired
6. Click **Save to device** and wait for **Saved** to appear
7. Select some text in another application and press your macropad key

![Key tap settings showing C with the Mac Command modifier and the key LED palette](images/configuration-overview/02-key-editor.png)

You can also click **Capture**, then press the desired combination on your normal keyboard. The configurator fills in the key and modifiers. If your operating system or browser intercepts that combination, select it manually instead.

For a quicker route, select a macropad input, expand **Shortcuts**, choose **Mac** or **Windows**, search for “copy,” and click **Copy**.

## Triggers: what starts an action

An **action** is what the macropad does. A **trigger** is what makes it happen.

| Trigger | How it works |
| --- | --- |
| Numbered key | Press it to run its assigned action. A hold action stays active until you release it |
| Wheel button: **Press** | Push down on the wheel. It supports ordinary actions and hold actions, just like a key |
| Wheel: **Turn left / Turn right** | Each completed wheel click, also called a detent, runs that direction's action. Configure the two directions separately |
| Two-key chord | Press two numbered keys together within the chord window. The chord action replaces their individual actions |
| Timer | Runs its action whenever its interval expires. The timer can optionally restart when you click any button on the macropad |
| **On next input** after a timer | Runs once when you next press a key or use the wheel, after that timer has fired |

There are no separate user-configurable double-tap or long-press triggers for ordinary actions. **Key hold** means “keep this action held while I hold the button,” rather than “wait before starting.” The optional three-second wheel hold is specifically for entering firmware update mode.

Actions that need a button release—**Key hold**, **Mouse hold**, **Layer while held**, and pointer movement set to **Hold**—cannot be used for wheel rotation or either timer action. Those triggers have no button to release.

## Available actions

### Keyboard

| Action | What it does | Example |
| --- | --- | --- |
| **Key tap** | Presses and releases one key, optionally with modifiers. Holding the macropad key does not turn this into a hold action | Ctrl+C, Command+V, Enter, or F5 |
| **Key hold** | Keeps the chosen key and modifiers held until you release the macropad button. The application may repeat a held key as it would on a normal keyboard | Hold Shift, an arrow key, or a game movement key |

Choose one main key plus any combination of **Ctrl**, **Shift**, **Alt / Option**, and **GUI (Win / Cmd)**. “GUI” means the Windows key on Windows and Command on Mac. Choose **No key (modifiers only)** to use a modifier by itself.

The key list includes letters, numbers, punctuation, function keys, navigation keys, editing keys, keypad keys, and other standard keyboard keys. A shortcut's result depends on the application and operating system receiving it. The macropad sends the combination; it does not choose the application for you.

### Mouse

| Action | What it does |
| --- | --- |
| **Mouse click** | Clicks your selected mouse button or buttons once |
| **Mouse double-click** | Sends two clicks |
| **Mouse hold** | Keeps the selected mouse buttons down while you hold the macropad button; useful for dragging |
| **Mouse toggle** | Press once to keep the selected mouse buttons down; activate the same input again to release them. Changing layers also clears toggled mouse buttons |
| **Scroll** | Sends a vertical scroll step. Choose **Up** or **Down** and a **Wheel step** from 1–127 |
| **Move pointer X** | Moves left or right by the selected amount, from 1–127 |
| **Move pointer Y** | Moves up or down by the selected amount, from 1–127 |

Mouse button actions offer **Left**, **Middle**, and **Right**. You can select more than one.

For pointer movement on a button or chord, choose **Tap** for one step or **Hold** for repeated movement until release. Hold movement repeats very quickly; start with a small amount. Wheel rotation and timers send one step each time they run. Pointer speed and scroll distance can vary with your computer's settings and the application.

### Media and system

Choose **Media / system**, then a named **Control**:

| Group | Available named controls |
| --- | --- |
| Volume | Volume up, Volume down, Mute |
| Playback | Play / pause, Play, Pause, Stop, Next track, Previous track, Fast forward, Rewind, Eject |
| Display and system | Brightness up, Brightness down, Power, Sleep |
| Launch | Calculator, File browser, Email, Media player |
| Browser | Web search, Browser home, Browser back, Browser forward, Browser stop, Browser refresh, Bookmarks |

Your computer, application, or display must support the selected control. For example, a brightness action may have no effect on an external monitor. These are individual activations, rather than held media controls. The **Custom usage…** entry is an advanced option; use the named choices for ordinary configuration.

### Type text

**Type text** types a short saved phrase into the application that currently has focus. It works like typing on a keyboard, rather than pasting from your computer's clipboard.

Supported text includes ordinary English letters, numbers, spaces, standard punctuation, tabs, and line breaks. Accented letters, emoji, smart quotes, and other special characters are not supported. Replace curly quotes with straight quotes if needed.

Text is typed using the **US keyboard layout**. A different keyboard layout on your computer may produce different characters. Line breaks act like Enter and tabs act like Tab, so they may submit a form or move to another field depending on where you type.

The **Text** field shows its storage cost. **Reuse an existing string…** lets you select text already used elsewhere in your profile. Identical text shares storage, even when several controls use it. See [the storage limit](#the-128-byte-limit) before adding long phrases.

### Layers, lighting, and leaving an input empty

The layer actions are explained in [Layers](#layers-several-sets-of-controls), and every **LED control** option is explained in [LED colors and effects](#led-colors-and-effects).

Choose **Nothing** to leave an input unassigned. A numbered key can still have a press color when its action is Nothing. Unassigned inputs do not inherit an action from another layer.

Each input has one action. A keyboard shortcut can combine modifiers with one main key, and Type text can type a phrase, but the editor does not build arbitrary sequences of different actions or delays.

## Layers: several sets of controls

Think of a layer as another page of buttons on the same macropad. Layer 1 might contain editing shortcuts, while Layer 2 controls music. The same key can copy on one layer and mute on another.

A layer contains all numbered-key actions and press colors, the wheel button and both turn actions, and its layer options. Chords can belong to a layer or apply globally. Timers apply across all layers.

You can have up to **seven layers on a three-key macropad**, or **five on a six-key macropad**, provided everything fits in storage.

### Add, edit, and remove layers

![Layer 2 selected for editing while Layer 1 remains the startup layer](images/configuration-overview/06-layers.png)

- Click a layer tab to edit it
- **Add layer** copies the currently selected layer, including its key colors, wheel settings, options, and local chords. Change the copy to make it your new set of controls. Global chords and timers are already shared
- Choose the **Startup layer** in **Profile**. This is the layer used when the device starts and after a configuration save
- The trash button beside the layer tabs removes the selected layer, its bindings, and its attached chords after confirmation. This includes global chords attached to that layer, so review your shared controls before removing it. At least one layer must remain. If you remove the startup layer, Layer 1 becomes the startup layer
- After removing a layer, review all layer-switch actions. A target may become unavailable or now refer to another layer at that number

### Choose how to switch layers

| Action | Behavior |
| --- | --- |
| **Switch to layer** | Changes to your chosen layer and stays there until another layer action changes it |
| **Switch to layer (one-shot)** | Visits your chosen layer for the next action, then returns. You do not need to keep the switching button held |
| **Layer while held** | Uses the chosen layer while the switching button or chord is held, then returns when released |
| **Relative layer** | Moves forward or backward by your chosen number of layers. **+1** means next; **−1** means previous in numerical order. It wraps around at either end |
| **Relative layer (one-shot)** | Visits a layer at the chosen offset for the next action, then returns |

For **Switch to layer** and its one-shot version, the target list also includes **Previous layer**. This means the last layer you left through a lasting switch, rather than simply the next lower layer number. Repeating a lasting Previous layer action swaps between those two layers. Temporary one-shot and held visits do not replace that history.

An offset of **0** stays on the current layer and can replay its layer indicator. This is useful with **Blink by layer number** when you want a “which layer am I on?” button. With no indicator, or an always-on indicator, it has no visible new indication.

**Give yourself a route back.** Add a layer-switch button on every layer, or make a global chord that cycles layers. Clicking editor tabs does not provide a way to change layers during normal device use. Review any **Layer reachability** warnings before saving.

## Chords: two keys together

A chord assigns an extra action to a pair of numbered keys. For example, Key 1 can copy, Key 2 can paste, and **Keys 1 + 2** together can switch layers.

![Keys 1 and 2 form a global chord that cycles forward one layer](images/configuration-overview/07-chord.png)

1. Select the layer where you want the chord
2. In **Chords**, choose a **Key pair** and click **Add chord**
3. Click the chord row and choose its action in the Action editor
4. Leave it local to that layer, or click its **globe** button to make it global
5. Save the profile, then press the two keys together to try it

**Local** chords apply only on their layer. **Global** chords appear across layers and use the same action everywhere. A local chord for the same key pair takes priority on its layer. Only one global chord can use a given pair. The editor prevents conflicting choices.

Chords use exactly **two numbered keys**. The wheel button and wheel turns are not chord members. A three-key pad has three possible pairs; a six-key pad has fifteen, although storage limits how many you can assign.

### Chord timing

The **Chord window** in **Profile** is how long the first key waits for its partner. It ranges from **5–75 milliseconds**, in steps of 5; the starter setting is **40 ms**, or four hundredths of a second.

- A larger window makes chords easier to press but adds a small delay to individual keys that belong to a chord
- A smaller window makes those individual keys respond sooner, but requires more nearly simultaneous presses
- Keys that do not belong to an applicable chord do not wait
- **Off** disables chord recognition without deleting your saved chords. Keys then act immediately

A recognized chord runs its action instead of the two individual actions. For a hold action, releasing either chord key ends the hold. Release **both** keys before attempting the same chord again. If you miss the timing window, the keys act individually.

## Timed actions and reminders

You can add up to **four timed actions**, subject to storage. They operate across all layers and repeat automatically.

![A repeating amber lighting reminder with a roughly twenty-minute interval and a next-input action that clears it](images/configuration-overview/08-timed-actions.png)

1. Click **Add timed action**
2. Move the **Interval** slider to the approximate duration you want
3. Choose whether to enable **Restart on key / encoder input**
4. Click **When timer fires**, then choose its action in the Action editor
5. Optionally expand **On next input** and configure a follow-up action and **Consume this input**
6. Save to the device

### Repeating versus inactivity timers

| Setting | Result |
| --- | --- |
| **Restart on key / encoder input** off | Repeats at the selected interval, even while you use the macropad |
| **Restart on key / encoder input** on | Restarts whenever you press a macropad key, press the wheel button, or complete a wheel turn. Useful for an inactivity reminder |

“Input” means activity **on the macropad**. Using your computer's regular keyboard or mouse does not restart these timers. Keeping a button held is not a stream of fresh presses.

The interval uses steps of about **2 minutes 11 seconds**, up to about **140 minutes**. The configurator shows the approximate time next to the slider. Timing follows a shared clock: the **first firing after starting or restarting can be up to about 131 seconds early**. Later repetitions without a restart use the full interval. A one-step interval can therefore fire almost immediately. Use these for approximate reminders, rather than an exact countdown.

### On next input

After a timer has fired, its optional **On next input** action runs once when you next use a macropad input. It can restore the lighting after a reminder, for example.

- With **Consume this input** off, the follow-up action runs and then the input's normal action runs too
- With **Consume this input** on, the input dismisses the reminder without running its normal action. Press or turn again to use the normal action
- Consumption works even if the follow-up action is **Nothing**

This follow-up does not stop the repeating timer. Multiple timers can be waiting for the same next input, so plan their actions together. Both timer action slots support actions that do not need a release, including text, media controls, layer changes, mouse steps, and LED controls.

For a complete lighting reminder, see [the example configuration](#a-repeating-lighting-reminder).

## LED colors and effects

There are three main ways to use lighting: a color when a key is pressed, a layer indicator, and an LED control action that changes lighting during use.

The fixed color palette offers **Red, Coral, Orange, Amber, Yellow, Green, Leaf, Teal, Cyan, Azure, Blue, Violet, Magenta, Rose, and White**. The final swatch is **Off** for key press colors, or **Rainbow** for layer indicators and temporary effects. Custom colors are not available.

### Key press colors

Select a numbered key, then choose **LED color on key press** in the Action editor. **Apply to layer** copies that color to every numbered key on the current layer; it leaves their actions unchanged. Press colors normally use full brightness.

**Preview color** temporarily shows the selected color on the connected device without saving your profile. **Cancel preview** returns to its usual lighting. A preview is not a saved setting. If preview is unavailable on your device, use its saved settings to test the result.

### Layer indicators

In **Layer options**, set **Layer selection LEDs**:

| Mode | What you see |
| --- | --- |
| **Do not indicate** | No layer indication; key press colors can still work |
| **On for 1.5 seconds** | Shows the chosen layer color or rainbow briefly when selecting the layer |
| **Blink by layer number** | Blinks once for Layer 1, twice for Layer 2, and so on. Each blink is a quarter-second on and a quarter-second off |
| **Always on** | Idle keys show the layer color or rainbow; pressed keys show their individual press colors |

Choose the **Layer indicator color** and **Full Brightness** or **Dim**. The timed and blinking indications temporarily cover key press colors. The always-on background allows key press colors to show over it.

### Rainbow settings and an Off key

When a layer uses a rainbow indicator, **Profile** shows shared rainbow settings:

| Rainbow phase spacing | Appearance |
| --- | --- |
| **0° — All LEDs together** | All LEDs cycle through the same color together |
| **30° — Gentle color wave** | Neighboring LEDs have similar colors |
| **60° — Rainbow sweep** | A wider spread of colors across the keys |
| **Variable — Scattered colors** | A more scattered spread of colors |

**Rainbow speed** offers **Extra fast**, **Fast**, **Slow**, and **Extra slow**. These settings apply across layers. Save changes before expecting device color previews to use the new speed or spacing. An LED control action can also change them during use.

If you combine an **Always on** layer indicator with an **Off** key press color, **Profile** offers **For key LEDs, “Off” means**:

- **Transparent:** pressing an Off-colored key leaves the idle background visible
- **Black:** pressing it makes that key go dark over the always-on background

This setting applies across layers. Timed and blinking layer indications still cover the key colors while their indication runs.

### LED control actions during use

Choose **LED control** as an input's action, then select an **LED command**. These actions let you adjust lighting without reopening the configurator. The adjustments apply across layers and reset when you save a configuration or reset/reconnect the device.

| Command | What it changes |
| --- | --- |
| **Set rainbow phase spacing** | Selects a specific spacing, or restores **As configured** |
| **Relative rainbow phase spacing** | Steps through the spacing choices, wrapping around |
| **Set rainbow speed** | Selects a speed, or restores **As configured** |
| **Relative rainbow speed** | Steps through speeds. Positive steps move toward faster choices; negative steps toward slower ones, wrapping around. Follow the cycle shown in the editor |
| **Set layer-indicator brightness** | Forces the indicator off, dim, or bright, or restores its configured brightness |
| **Relative layer-indicator brightness** | Cycles through off, dim, and bright |
| **Set key-press brightness** | Forces key feedback off, dim, or bright, or restores configured behavior |
| **Relative key-press brightness** | Cycles key feedback through off, dim, and bright |
| **Set both brightnesses** | Applies the same brightness choice to both kinds of lighting |
| **Relative both brightnesses** | Advances each brightness separately through off, dim, and bright |
| **Set common brightness preset** | Applies one of the combinations listed below |
| **Relative common brightness preset** | Cycles through those preset combinations |
| **Toggle preset on/off** | Applies the chosen preset; when that preset is active, activating again restores configured layer and key brightness. Rainbow speed and spacing stay unchanged |
| **Set all LEDs** | Starts or clears a temporary color or rainbow effect; see below |
| **Restore all configured LED settings** | Restores configured lighting, including brightness, rainbow settings, and temporary effects |

The **common brightness presets** are:

1. **Both as configured**
2. **Layers dim, keys bright**
3. **Layers and keys dim**
4. **Layers off, keys dim**
5. **Both off**

Relative settings use a **Relative step** to choose direction and, for rainbow controls, whether to skip a choice. The editor shows the cycle order. Unlike a common preset, **Relative both brightnesses** changes each brightness from its own current setting, so they may remain different.

Indicator brightness preserves the selected indicator mode: making it bright does not turn **Do not indicate** into an always-on background. Forcing key feedback off lets the idle background show through.

### Temporary effects: Set all LEDs

![LED control configured to blink all LEDs three times in a dim rainbow](images/configuration-overview/09-led-effect.png)

With **LED command → Set all LEDs**, choose:

| Effect | Behavior |
| --- | --- |
| **As configured** | Clears the temporary effect and returns to normal lighting |
| **Always on** | Shows the chosen color or rainbow until another effect replaces it, you restore lighting, or the layer changes. Key feedback can appear over it |
| **Blink** | Blinks the chosen color or rainbow **1–8 times**, then returns to normal lighting. It covers key feedback during the effect |

Choose a color or **Rainbow**, plus **Full Brightness** or **Dim**, for Always on and Blink effects. These do not replace the layer's saved color settings.

Finishing or clearing an effect returns to normal lighting without replaying the layer's timed or blinking selection indication. Existing brightness overrides remain active when you clear an effect with **As configured**. Use **Restore all configured LED settings** to clear those overrides too.

## Shortcuts, copy and paste, and drag and drop

### Use the shortcut library

Expand **Shortcuts**, select **Mac** or **Windows**, and search for an action name or application. The library includes everyday editing, browser controls, window management, screenshots, media keys, standard keyboard keys, and application-specific shortcuts for Word, Google Docs, PowerPoint, VS Code, and Vim, plus short text snippets.

![Shortcut library filtered to copy actions, with Mac and Windows choices and matching presets](images/configuration-overview/05-shortcuts.png)

Select an input and click a shortcut, or drag the shortcut onto a numbered key, wheel input, chord, or timer action. Either method **replaces that input's action**. Dragging from the library copies the preset; it does not remove it from the library or change the key's press color.

Check the Action editor afterward to see the assigned combination or text. Application shortcuts depend on the application, its mode, and your computer's settings. Text snippets insert literal text; they do not automatically wrap a selection or move the cursor into a template.

### Copy or move an existing action

1. Click the input you want to copy in the macropad picture, chord list, or timer section
2. Press the usual copy shortcut below
3. Select the destination input, changing layer tabs first if needed
4. Press paste. The destination's previous action is replaced

| Edit | Windows | Mac |
| --- | --- | --- |
| Copy selected input | Ctrl+C | Command+C |
| Cut selected input | Ctrl+X | Command+X |
| Paste onto selected input | Ctrl+V | Command+V |
| Undo an editor change | Ctrl+Z | Command+Z |
| Redo an editor change | Ctrl+Shift+Z or Ctrl+Y | Command+Shift+Z |
| Clear selected action | Delete or Backspace | Delete or Backspace |

Click the **input itself** before copying or pasting an action. If you are typing in a text box or have ordinary page text selected, the shortcuts work on that text instead. Copying one action is different from **Export to Clipboard**, which copies the entire profile for backup.

Copying or cutting a numbered key also includes its press color. Pasting it onto another numbered key transfers that color; pasting onto a wheel input, chord, or timer transfers only the action. Cutting clears the original action and turns its key press color Off.

Delete or Backspace first changes the selected action to **Nothing**. On a numbered key whose action is already Nothing, another separate press turns its press color Off. Clearing a chord action does not delete the chord; use its trash button to remove the chord and reclaim its storage.

Use the top-bar **Undo** and **Redo** buttons if you prefer clicking. They undo editor changes; use **Save to device** to apply the resulting profile to hardware. While editing text, keyboard undo normally applies to the text field instead.

### Drag and drop existing actions

![Dragging to a key's center highlights a swap target; dragging to an edge shows an insertion line](images/configuration-overview/10-drag-drop.png)

| Where you drop | Result |
| --- | --- |
| Center of another input | **Swaps** the two actions. The destination's old action moves to the source |
| Edge of an input, or gap between inputs | **Inserts and reorders** within a supported group. Other actions shift along. A line marks the insertion point |
| Center of a layer tab | Swaps the two entire layers |
| Edge of a layer tab, or gap between tabs | Moves the entire layer into that position |

For numbered keys and layer tabs, use left/right edges. For the vertical wheel input list and chord rows, use top/bottom edges. Numbered keys reorder within their layer, wheel inputs within their list, and chords within their displayed list. Reordering chord actions changes which key pair runs each action; it does not change the pair labels.

Key-to-key swaps and key reordering carry press colors along with the actions. Swapping between different kinds of input transfers actions only. Timer action slots support **swapping**, rather than edge insertion; dragging their actions does not move the timer's interval or checkboxes.

Layer moves carry their bindings, colors, options, and attached chords. The configurator updates explicit layer targets and the startup layer to follow the moved layers. Relative switches still follow numerical order, so review them after rearranging layers.

An invalid destination is not accepted. In particular, a swap must leave **both** inputs with allowed actions: you cannot swap a hold action into a timer or wheel-turn input. Use copy and paste when you want a duplicate rather than a swap.

## The 128-byte limit

Your **entire saved device profile has only 128 bytes of space**. A byte is a tiny unit of storage; for the plain text this macropad supports, one character—including a space—takes one byte.

For scale, **“The quick brown fox jumps over the lazy dog” contains 43 characters, so the text itself takes 43 bytes.** A Type text action also needs one extra byte to mark the end, making **44 bytes**. That one short sentence uses **over a third** of the macropad's entire configuration space, before accounting for your layers and other settings! Three saved copies of different phrases that size would already exceed 128 bytes on their own.

You do not have to calculate everything manually. **Device storage** adds it up as you edit, shows the free space, and reports when you go over the limit. Its “Header” line simply means the space reserved for basic profile settings.

![Device storage meter showing a two-layer profile with 75 of 128 bytes free](images/configuration-overview/03-storage.png)

| Item | Space used |
| --- | --- |
| Basic profile settings | 9 bytes, always |
| Each three-key layer | 15 bytes, including all its regular input assignments, key colors, and layer options |
| Each six-key layer | 22 bytes, including all its regular input assignments, key colors, and layer options |
| Each chord | 3 bytes, whether local or global |
| Each timed action | 5 bytes, including its interval, options, and both action assignments |
| Each different text phrase | One byte per character, plus one extra byte |

Ordinary actions fit into the space already reserved for their layer, chord, or timer. For example, changing a key from Nothing to a keyboard shortcut, mouse action, or LED control does not need extra space. **Type text** adds the phrase's storage cost.

The starter two-layer profile uses **39 bytes on a three-key pad** or **53 bytes on a six-key pad**, leaving **89** or **75 bytes** respectively. On the six-key starter, adding the fox sentence leaves just **31 bytes** for any more layers, chords, timers, or different text.

### Make the most of the space

- Use keyboard and media actions for shortcuts instead of typing a text sequence when either would do the job
- Keep text phrases short. Spaces, tabs, and line breaks count too
- Reuse **exactly identical** text. Assigning the same phrase to several inputs stores it only once; changing its capitalization or punctuation makes it a different phrase
- Use a global chord for an action you want on every layer, instead of adding identical local chords everywhere
- Remove unused chords and timers with their trash buttons. Setting their actions to Nothing keeps the chord or timer and its storage cost
- Remove unused layers. Clearing a layer's inputs does not reduce the layer's fixed cost
- Review storage after **Add layer**, because it copies local chords and may add more than just the layer's basic cost

The 128-byte limit is shared by everything. Reaching the advertised maximum number of layers does not guarantee room for all the chords, timers, and text you want. If you run out, simplify the profile until **Fix before saving** clears.

An exported backup file may be much larger than 128 bytes because it is a readable description of the settings. That file size is not your device storage usage; the **Device storage** meter is the one to follow.

## Save, back up, and restore

### Save to device

Edits stay in the browser until you click **Save to device**. Wait for **Saved** before disconnecting. Saving applies the whole profile and restarts device operation on the startup layer, including timers and configured lighting.

The configurator disables saving if the profile is invalid, over capacity, for the wrong key count, or incompatible with the connected device. **Fix before saving** lists profile problems; click a listed input to edit it. Advisory warnings about layer routes or encoder holds are worth reviewing even when they do not block saving.

### Back up or share a profile

In **Backup & restore**:

![Backup and restore controls for exporting, importing, and resetting a profile](images/configuration-overview/04-backup.png)

- **Export JSON** downloads your current editor profile as a file. Give the file a useful name, such as “Macropad – Photo editing.json.” You do not need to open or edit its contents
- **Export to Clipboard** copies the same complete profile so you can keep or share it as text
- Both exports include the editor's current settings, including unsaved edits

Save an export somewhere you can find it again. A device save and a backup serve different purposes: the device save applies settings to hardware; the export gives you a separate copy to restore later.

### Import or start again

- **Import profile** opens an exported profile file in the editor
- **Import from Clipboard** opens a dialog where you paste a complete exported profile and click **Import**
- **Read from device** replaces the editor profile with the device's saved settings and clears undo history. The confirmation warns that unsaved edits will be lost
- **Reset to starter profile** replaces the editor settings with the starter configuration after confirmation. It does not immediately reset the device

**Importing or resetting does not change your macropad until you save.** Import a profile for the correct three-key or six-key model. Export your current work first if you want to keep both versions.

The browser also keeps a local draft. On reconnect, it may ask whether to use the draft or load from the device. Choose the draft to continue browser edits, or the device copy to start from what is already saved on hardware. Browser drafts can disappear when browser data is cleared and are separate from the device's saved profile; keep an exported backup for anything you want to preserve.

### Optional firmware update shortcut

Under **Layer options → Advanced**, **Allow bootloader entry by long-pressing the encoder button** enables firmware update mode when you hold the wheel button for three seconds. It uses the layer active when the hold begins.

This option is for updating the device software, not editing a profile. It can interrupt an encoder hold action, so leave it disabled on layers where you regularly hold that button. If you enter update mode accidentally, unplug and reconnect normally. Holding the wheel button while plugging in also enters update mode, independently of this setting. See the [firmware setup instructions](README.md#how-to-upload-the-firmware) when you actually need an update.

## Example configurations

### Everyday editing with a useful wheel

- Assign **Key tap** shortcuts for Copy, Paste, and Undo. Use Ctrl on Windows or Command on Mac
- Set **Turn left** to **Scroll → Up**, and **Turn right** to **Scroll → Down**, with a small Wheel step such as 2
- Give the keys different press colors to help identify them
- Save, then test in a document with some text selected

### Two layers: editing and music

1. Configure your editing layer
2. Click **Add layer** to copy it, then replace the new layer's keys with **Play / pause**, **Next track**, and **Mute**
3. On the music layer, use **Volume down** and **Volume up** for the wheel turns
4. Give each layer an **Always on** indicator in a different color
5. Add a **Keys 1 + 2** chord with **Relative layer → +1**, then click its globe to make it global
6. Save. Press Keys 1 and 2 together to cycle between the two layers

If you start from the two-layer starter, customize its existing layers instead of adding a third one. Check that local chords do not override your global switching pair.

### A repeating lighting reminder

1. Click **Add timed action**. Choose an interval of **9 × 131 seconds**, about **19 minutes 40 seconds**
2. Leave **Restart on key / encoder input** off for a repeating reminder. Turn it on if you want the reminder only after macropad inactivity
3. Select **When timer fires → LED control → Set all LEDs → Always on**. Choose **Amber** and **Dim**
4. Expand **On next input**, select its action, and choose **LED control → Set all LEDs → As configured**
5. Enable **Consume this input** if the first press or turn should only dismiss the reminder
6. Save. The reminder turns the LEDs amber; your next macropad input clears the effect

The first reminder may arrive about two minutes early because of the timer's shared clock. If you prefer an alert that clears itself, choose **Blink** and a blink count instead of Always on. A layer change also clears an always-on temporary effect.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Device does not appear in the chooser | Use desktop Chrome or Edge, the hosted configurator, a USB data cable, and a device running this project's firmware. Reconnect after installing firmware. Some boards require a USB-A to USB-C cable to power correctly. Linux users may need the [device access setup](webapp/README.md#linux-device-access) |
| One red LED blinks and controls do nothing | Connect and save a valid profile |
| My edits have no effect | Click **Save to device** and wait for Saved. Check that you are connected to hardware, rather than a simulator |
| Clicking a layer tab does not switch the device | Tabs choose what you edit. Use a saved layer-switch action on the macropad |
| I cannot get back to my usual layer | Configure a return action or a global layer-cycle chord. Reconnecting starts on the saved startup layer |
| Save is disabled | Check the connection, key count, storage meter, and **Fix before saving**. Follow any compatibility notice for older firmware |
| A chord runs two ordinary actions | Increase the chord window slightly, check that it is not Off, press the pair nearly simultaneously, and release both keys before trying again. Check the chord's layer or global setting |
| Copy or paste acts on text instead of a binding | Click the actual key, wheel input, chord row, or timer action first. Do not leave focus in an editor field or a page-text selection |
| A dragged action is rejected | A hold action cannot go onto a wheel turn or timer. For swaps, check that the action moving back is also allowed at its destination |
| Typed text contains wrong characters | Check your computer's keyboard layout; Type text expects US layout. Replace unsupported characters with plain letters and punctuation |
| A media or brightness control does nothing | Your operating system, application, or display may not support it. Try the matching keyboard shortcut if one is available |
| A reminder fires earlier than expected | The first firing after a start or restart can be up to about 131 seconds early. Choose a longer interval if needed |
| An inactivity timer ignores my regular keyboard | Only macropad presses and completed wheel turns restart it |
| My first press after a reminder does nothing | **Consume this input** may be enabled. That input dismisses the reminder; the next one runs normally |
| Holding the wheel disconnects the device | Disable the three-second bootloader option on that layer if you need ordinary wheel-button hold actions. Reconnect normally to leave update mode |
| The mouse seems stuck dragging | Activate the same Mouse toggle input again, or change layers to clear toggled buttons |
| LEDs do not look like the editor | Check layer indicators, key colors, temporary effects, and brightness overrides. Use **Restore all configured LED settings** to restore saved behavior. Confirm that your board has LEDs |
| My device has older firmware | Follow the configurator's compatibility notice or use **Older firmware configurators**. Older editors may have fewer features than this guide |

[Back to index](#index)
