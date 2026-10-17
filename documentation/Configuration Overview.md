# Configuration Overview

Using this macropad gives you quick access to the things you do most often: copy and paste, control music, scroll, type short phrases, take screenshots, or use the built-in LEDs as a reminder to take a break and stretch.

You configure it in your browser with the configurator tool. Once you click **Save to Device**, the settings stay on the macropad — even when you unplug it or use it on a different computer. You do not need to keep the configurator open for the macropad to work.

This guide covers the current configurator and its supported three-key and six-key wired macropads with a clickable wheel. Your device needs this project's firmware installed first; factory settings cannot be edited with this tool. See the [setup instructions](../README.md#how-to-upload-the-firmware) if it has not been installed yet. Some macropads do not have LEDs fitted. The active editor targets format 16. The bundled v16 firmware matches the active editor and supports per-key idle colors and key-press **Rainbow**. Older v15 firmware uses the [frozen v15 editor](https://perkinsb1024.github.io/CH552-Macropad-v2/versions/format-v15/).

## Index

1. [Get Connected—Or Try a Virtual Macropad](#get-connectedor-try-a-virtual-macropad)
2. [Find Your Way Around](#find-your-way-around)
3. [Configure Your First Shortcut](#configure-your-first-shortcut)
4. [Triggers: What Starts an Action](#triggers-what-starts-an-action)
5. [Available Actions](#available-actions)
6. [Layers: Several Sets of Controls](#layers-several-sets-of-controls)
7. [**Chords**: Two Keys Together](#chords-two-keys-together)
8. [Timed Actions and Reminders](#timed-actions-and-reminders)
9. [LED Colors and Effects](#led-colors-and-effects)
10. [**Shortcuts**, **Copy** and **Paste**, and Drag and Drop](#shortcuts-copy-and-paste-and-drag-and-drop)
11. [**Macros**](#macros)
12. [The 128-Byte Configuration Size Limit](#the-128-byte-configuration-size-limit)
13. [Save, Back Up, and Restore](#save-back-up-and-restore)
14. [Example Configurations](#example-configurations)
15. [Troubleshooting](#troubleshooting)
16. [Advanced: Gotchas and Things to Watch Out for with Timed Actions](#timed-action-gotchas)

## Get Connected—Or Try a Virtual Macropad

### Connect Your Own Device

1. Open the [Macropad Configurator](https://perkinsb1024.github.io/CH552-Macropad-v2/) in desktop Chrome or Edge
2. Plug in your macropad with a USB data cable
3. Click **Connect Macropad**. Choose **Universal Macropad** in the browser's device chooser and connect
4. The configurator loads the saved profile from your device. If the macropad has no valid profile, the configurator defaults to a starter profile instead
5. Make your changes, click **Save to Device**, and wait for **Saved** before unplugging it

If the macropad blinks one red LED, that indicates there is no saved profile (or an invalid saved profile). Save a new profile to activate it. V12 firmware also accepts the **Enter Bootloader** command from the firmware installer in this state.

With a valid profile, the macropad stays dark while the computer recognizes it
over USB. If that takes more than one second, **Key 1** starts blinking yellow.
The warning clears automatically when USB enumeration completes, and normal
operation starts with the configured layer indication. You can also press
**Key 1** to dismiss the warning; that press does not run its assigned action.
Release the key before pressing it again. Manual dismissal allows local actions
and lighting, but keyboard and mouse output still require USB enumeration.
The yellow warning only applies at startup. An invalid profile displays the red
error indication instead and requires saving a valid profile.

### Practice without Hardware

Open a [virtual three-key macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=three) or a [virtual six-key macropad](https://perkinsb1024.github.io/CH552-Macropad-v2/?sim=six). You can also open **More Connection Options**, the arrow beside **Connect Macropad**, and choose a simulated device.

The simulator lets you explore the editor and practice saving a profile. Saving there only updates the virtual device; it does not configure your physical macropad or send real keyboard and mouse actions to your computer. Export a profile you want to keep.

For editing without a connection, choose **Edit Offline** for a three-key or six-key device on the welcome screen. Safari and Firefox can edit and export profiles, but cannot save them directly to a USB macropad. To apply an offline profile, connect the matching physical device in a supported browser, import your exported profile, and save it.

## Find Your Way Around

![The configurator with a simulated six-key macropad, profile settings, layers, and storage meter](../images/configuration-overview/01-workspace.png)

*Screenshots in this guide use a simulated device. The controls work the same way when editing a connected macropad.*

| Area | What It Does |
| --- | --- |
| Top bar | Connect, undo or redo edits, read saved settings, and save to the device |
| **Profile** | Choose the startup layer and chord timing. **Rainbow** settings and the meaning of an “**Off**” key LED appear when relevant. These settings apply across layers |
| Layer tabs | Choose which layer you are editing, add a layer, or rearrange layers |
| Macropad layout | Click a numbered key, **Turn Left**, **Press**, or **Turn Right** to select its action |
| **Action Editor** | Choose what the selected control does and adjust its settings. For a numbered key, you can also pick its key-press color here |
| **Chords** | Assign actions to two-key combinations |
| **Layer Options** | Set the current layer's indicator lighting and **Auto-Sleep** |
| **Timed Actions** | Run actions repeatedly or after inactivity, across all layers or on one selected layer |
| **Shortcuts** | Search ready-made actions and drag them onto an input |
| **Device Storage** | See how much of the 128-byte budget your profile uses |
| **Backup & Restore** | Export, import, or reset the profile in the editor |

Clicking a layer tab changes the editor's view, it does not update the physical macropad, which changes layers using a configured action. The **Active Layer** readout in **Backup & Restore** shows the layer the connected device is currently using.

## Configure Your First Shortcut

For example, make a key copy the selected text:

1. Select the layer you want to edit, then click a numbered key in the macropad picture
2. In **Action**, choose **Key Tap**
3. Choose **C** in the **Key** list
4. Enable **Ctrl** for Windows, or **GUI (Win / Cmd)** for Mac. Leave the other modifiers off
5. Pick an **LED Color on Key Press**, if desired
6. Click **Save to Device** and wait for **Saved** to appear
7. Select some text in another application and press your macropad key

![Key Press settings showing C with the Mac Command modifier and the key LED palette](../images/configuration-overview/02-key-editor.png)

Instead of selecting the individual keyboard keys your macropad should send, you can also click **Capture**, then press the desired combination on your normal keyboard. The configurator fills in the key and modifiers automatically. If your operating system or browser intercepts that combination, select it manually instead.

For a quicker option, expand the **Shortcuts** section, choose **Mac** or **Windows**, search for “copy,” and drag **Copy** onto a numbered key in the macropad picture. The correct keys will automatically be assigned to that key.

## Triggers: What Starts an Action

An action is what the macropad does. A trigger is what makes it happen.

| Trigger | How It Works |
| --- | --- |
| Numbered key (1 - 3 or 1 - 6)| Press it to run its assigned action. A hold action stays active until you release the key |
| Wheel button: **Press** | Push down on the wheel. It supports ordinary actions and hold actions, just like a key |
| Wheel: **Turn Left / Turn Right** | Each completed wheel click, also called a detent, runs that direction's action. Configure the two directions separately |
| Two-key chord | Press two numbered keys together within the chord window. The chord action replaces their individual actions (a small delay is required for individual keys that are part of a chord) |
| Timer | Runs its action whenever its interval expires. The timer can optionally restart when you interact with the macropad |
| **On Next Input** after a timer | Runs once when you next press a key or use the wheel, after that timer has fired |

There are no separate user-configurable double-tap or long-press triggers for ordinary actions. **Key Hold** means “keep this action held while I hold the button,” rather than “wait before starting.” In v12, firmware update mode is entered through the installer or by holding the encoder while connecting USB.

Actions that need a button release—**Key Hold**, **Mouse Hold**, and media, layer, scroll or pointer actions set to **Hold**—cannot be used for wheel rotation, either timer action, or macro steps as those contexts have no physical release.

## Available Actions

### Keyboard

| Action | What It Does | Example |
| --- | --- | --- |
| **Key Tap** | Presses and releases one key, optionally with modifiers. Holding the macropad key does not turn this into a hold action | **Ctrl+C**, **Command+V**, **Enter**, or F5 |
| **Key Hold** | Keeps the chosen key and modifiers held until you release the macropad button. The application may repeat a held key as it would on a normal keyboard | Hold **Shift**, an arrow key, or a game movement key |

Choose one main key plus any combination of **Ctrl**, **Shift**, **Alt / Option**, and **GUI (Win / Cmd)**. “**GUI**” means the Windows key on Windows and Command on Mac. Choose **No Key (Modifiers Only)** to use a modifier by itself.

The key list includes letters, numbers, punctuation, function keys, navigation keys, editing keys, numpad keys, and other standard keyboard keys. A shortcut's result depends on the application and operating system receiving it. The macropad sends the key or key combination exactly how an ordinary keyboard would.

### Mouse

| Action | What It Does |
| --- | --- |
| **Mouse Click** | Clicks your selected mouse button or buttons 1–16 times: choose **Single**, **Double**, or **Custom** |
| **Mouse Hold** | Keeps the selected mouse buttons down while you hold the macropad button; useful for dragging |
| **Mouse Down** | Sets selected persistent button bits; repeated down leaves them down |
| **Mouse Up** | Clears selected persistent bits from any input or macro; repeated up leaves them released |
| **Mouse Toggle** | Flips the selected mouse buttons between down and released. All toggle actions share the same state, so another input or macro can toggle them off. Changing layers also clears toggled mouse buttons |
| **Scroll** | Sends a scroll step. Choose **Vertical** with **Up**/**Down**, or **Horizontal** with **Left**/**Right**, and a **Wheel Step** from 1–127 (horizontal requires v9 firmware) |
| **Move Mouse** | Choose **Axis**: **X** moves left or right, **Y** moves up or down, and **Both** moves both axes together |

In v12, **Mouse Toggle**, **Mouse Down** and **Mouse Up** share one persistent state
across keys, wheel inputs, chords, timers and macros. Each selected bit operates
independently. Down sets bits, up clears them, and toggle flips them. Repeated
down/up is idempotent. For example, one key can start a drag with **Mouse Down**
and another can end it with **Mouse Up**. A macro can use **Mouse Down** →
**Move Mouse** → **Mouse Up**, with **Pause** steps as needed.
A physical **Mouse Hold** or temporary click keeps its buttons down independently.
Macro completion and physical release leave persistent state intact; layer
changes and resets clear it. Direct bindings act immediately, while macro steps
run in playback order. Down/up are available for rotation and both timer slots.

Mouse actions offer **Left**, **Middle**, **Right** and **Button 4** through
**Button 8**, including combinations. Extra-button support depends on the host
and application. Buttons 4/5 often mean Back/Forward; those meanings are not
guaranteed. Browsers commonly expose at most five buttons, so **Scroll & Click Test**
may not observe buttons 6–8 even when another application can use them.
Buttons 4–8 and down/up require v12 firmware. The bundled v16 release supports all eight buttons and these persistent
actions; older firmware uses its matching frozen configurator.

**Custom** shows a 3–16 click-count slider. Its last count is remembered per action
slot when you switch to **Single** or **Double** and back. The duration hint is rounded
to one decimal: about 0.4 seconds for three clicks and 3.1 seconds for sixteen.
Each press lasts at least 8ms, with a 200ms pause between clicks; USB delays can
extend the sequence. Subsequent queued actions wait for it to finish, while holds,
media controls and layer/LED actions use independent handling. Your computer
decides whether the sequence is recognized as a double-click or another gesture.

Some computers invert scroll directions. If the selected direction behaves
backwards, swap **Up**/**Down** or **Left**/**Right**. Under **Scroll Direction**,
**Click Here** opens **Scroll & Click Test** with a scrollable area on both axes
and click counters for each mouse button. Save edits to the macropad before
testing; the modal warns if you have unsaved changes.

Under **Move Mouse**, choose **Behavior** (**Tap** or **Hold**) for a button
or chord, then **Axis**. For **X** or **Y**, choose
**Direction** and an **Amount** from 1–127. **Both** provides separate
horizontal and vertical directions and amounts from 4–64 in steps of 4, sending
both axes in one report. Use **X** or **Y** to move only one axis. When first
switching to **Both**, the current amount is rounded to a multiple of 4 and capped
at 64; the other axis starts at 4. Switching back restores that axis's previous
settings when available. Pointer movement uses relative mouse counts; screen
distance depends on the computer's pointer speed and acceleration.

For scrolling or pointer movement on a button or chord, choose **Tap** for one step
or **Hold** for repeated movement until release. Start with a small amount. Held
scrolling waits at least 100ms after the complete previous step and repeats when
playback and USB output are idle (about ten steps per second at step 1); release stops
new repeats, while an accepted step finishes. Wheel rotation and timers send one
step each time they run. Pointer speed and scroll distance can vary with your
computer's settings and the application.

### Media and System

Choose **Media / System**, then a named **Control**:

| Group | Available Named Controls |
| --- | --- |
| Volume | **Volume Up**, **Volume Down**, **Mute** |
| Playback | **Play / Pause**, **Play**, **Pause**, **Stop**, **Next Track**, **Previous Track**, **Fast Forward**, **Rewind**, **Eject** |
| Display and system | **Brightness Up**, **Brightness Down**, **Power**, **Sleep** |
| Launch | **Calculator**, **File Browser**, **Email**, **Media Player** |
| Browser | **Web Search**, **Browser Home**, **Browser Back**, **Browser Forward**, **Browser Stop**, **Browser Refresh**, **Bookmarks** |

Your computer, application, or display must support the selected control. For example, a brightness action may have no effect on an external monitor (though if you're on MacOS, I recommend checking out [Lunar](https://lunar.fyi/), which allows these keys to control many external monitors). The **Custom Usage...** entry is an advanced option; use the named choices for ordinary configuration.

Choose **Media / System** or **Media / System with Modifiers**, then use
**Behavior** to select **Tap** or **Hold**. With v13 firmware, taps can include
**Ctrl**, **Shift**, **Alt** and **GUI** modifiers when the usage fits in eight bits
(`0x01–0xFF`). Larger custom usages use unmodified actions.
With v14 firmware, **Media / System with Modifiers** also supports **Hold** to
keep an eight-bit control and its modifiers active until physical release; this
behavior is available on keys, chords and the wheel button. Published v13 firmware supports
modified taps through its matching archived editor. The firmware presses the modifiers before the media
report and clears them after its release, preserving independently held keys.
For example, macOS fine brightness adjustment uses Option + Shift with a
brightness tap. Host support determines the result.

Choose **Hold** under **Behavior** to keep the control
held until release; the selected **Control** and modifiers are preserved when
switching between **Tap** and **Hold**. The host decides whether a sustained control repeats. Holds are
available on keys, chords and the wheel button, but not wheel turns, either timer action, or macro steps.
The newest media action wins, including a tap interrupting a hold. Releasing it
does not restore a previous still-held control. Keyboard and media holds retain
their original binding across layer changes until physical release. Releasing
either key of a chord ends its hold.

### Type Text

**Type Text** types a short saved phrase into the application that currently has focus. It works like typing on a keyboard, rather than pasting from your computer's clipboard.

Supported text includes ordinary English letters, numbers, spaces, standard punctuation, tabs, and line breaks. Accented letters, emoji, smart quotes, and other special characters are not supported. Replace curly quotes with straight quotes if needed.

Text is typed using the US keyboard layout. A different keyboard layout on your computer may produce different characters. Line breaks act like **Enter** and tabs act like Tab, so be careful when using them. They may submit a form or move to another field depending on where you type.

**Type Text** waits 32ms after each character's key release before continuing, including after tabs, newlines and the final character. Inputs and USB continue to be serviced during the wait. Applications may still need an explicit **Pause** before Enter in a macro.

The **Text** field shows its storage cost. **Reuse an Existing String…** lets you select text already used elsewhere in your profile. Identical text does not use additional storage, even when several controls use it. See [the storage limit](#the-128-byte-configuration-size-limit) before adding long phrases.

> [!WARNING]
> While it is technically possible to use the **Type Text** feature to save and enter your password, you should *never* do this. This device does not feature any encryption or protection. Anyone with access to this device would have access to your password. This is the job of a password manager.

### Leaving an Input Empty

Choose **Nothing** to leave an input unassigned. A numbered key can still have a key-press color when its action is **Nothing**. Unassigned inputs do not inherit an action from another layer.

## Layers: Several Sets of Controls

Think of a layer as another page of buttons on the same macropad. **Layer 1** might contain editing shortcuts, while **Layer 2** controls music. The same key can copy on one layer and mute on another. The most common example of keyboard layers is the **Shift** or Caps Lock key. Think of the lowercase letters and numbers as one layer, while pressing shift or caps lock activates a second layer containing the uppercase letters and punctuation. **Shift** is a momentary layer change, while caps lock is persistent. Both types of layer changes ([and more!](#choose-how-to-switch-layers)) are supported by this macropad.

A layer contains all numbered-key actions and key-press colors, the wheel button and both turn actions, and its layer options. **Chords** and **Timed Actions** can belong to a layer or apply globally to all layers

You can have up to seven layers on a three-key macropad, or five on a six-key macropad, unless you are using optional features like **Chords** and text strings, which will reduce the available space for layers.

### Add, Edit, and Remove Layers

![Layer 2 selected for editing while Layer 1 remains the startup layer](../images/configuration-overview/06-layers.png)

- Click a layer tab to edit it
- **Add Layer** creates a new blank layer with unassigned keys and wheel controls, LEDs off, and no local chords. The new layer is selected immediately
- To copy the selected layer, open the arrow beside **Add Layer** and choose **Duplicate Current Layer**. This copies its key colors, wheel settings, options, and local chords to a new layer and selects it. **Global** chords and timers assigned to **All Layers** are already shared. Layer-specific timers keep their original assignment
- Choose the **Startup Layer** in **Profile**. This is the layer used when the device starts and after a configuration save
- The trash button beside the layer tabs removes the selected layer, its bindings, and its local chords after confirmation. **Global** chords are preserved. At least one layer must remain. If you remove the startup layer, **Layer 1** becomes the startup layer
- After removing a layer, review all layer-switch actions. A target may become unavailable or now refer to another layer at that number

### Choose How to Switch Layers

Choose **Switch to Layer** for a specific target or **Relative Layer** for an
offset, then select **Switch**, **One-Shot** or **Hold** under **Behavior**.
Changing behavior preserves the target layer or offset.

| Action | Behavior | Result |
| --- | --- | --- |
| **Switch to Layer** | **Switch** | Changes to your chosen layer and stays there until another layer action changes it (like the caps lock key in the earlier example) |
| **Switch to Layer** | **One-Shot** | Visits your chosen layer for the next action, then returns. You do not need to keep the switching button held |
| **Switch to Layer** | **Hold** | Uses the chosen layer while the switching button or chord is held, then returns when released (like the shift key in the earlier example) |
| **Relative Layer** | **Switch** | Moves forward or backward by your chosen number of layers. +1 means next; −1 means previous in numerical order. It wraps around at either end |
| **Relative Layer** | **One-Shot** | Visits a layer at the chosen offset for the next action, then returns |
| **Relative Layer** | **Hold** | Resolves the offset from the selected base layer at press time and keeps that target until physical release; requires v14 firmware |

**Hold** is available on keys, chords and the wheel button. It is disabled for
wheel turns, both timer actions and macro steps because they have no physical release.

For **Switch to Layer** with **Switch** or **One-Shot** behavior, the target list
also includes **Previous Layer**. This means the previously selected layer on the
device, rather than simply the next lower layer number. Repeating a
**Previous Layer** action swaps between those two layers. Temporary one-shot and
held visits do not affect the previous layer history. **Hold** is disabled while
**Previous Layer** is selected; choose a specific target layer to enable it.

An offset of 0 stays on the current layer and will replay its layer indicator. This is useful with **Blink by Layer Number** when you want a “which layer am I on?” button. With no indicator, or an always-on indicator, it has no effect.

*Give yourself a route back.* Add a layer-switch button on every layer, or make a global chord that cycles layers. Clicking layer tabs in the configurator does not change the selected layer on your macropad. Review any **Layer Reachability** warnings before saving.

The reachability check tracks persistent layer history and pending one-shot returns. It warns when a reachable layer cannot return to startup, including when only some histories leave you trapped. **Previous Layer** is one remembered layer, not a stack: with **Layer 1** → **Layer 2** → **Layer 5**, Previous on **Layer 5** returns to **Layer 2**; another Previous returns to **Layer 5**, not **Layer 1**. A direct jump from **Layer 1** to **Layer 5** can still return to **Layer 1**, so the warning for **Layer 5** depends on history. A simple two-layer Previous toggle with a reliable route back does not need a warning.

This is a route check, not a complete simulation of physical inputs: timer actions are treated as possible transitions without enforcing their timing, order or input consumption, and multiple held-layer inputs are approximated. Having no reachability warnings does not guarantee that every input sequence is safe.

## Chords: Two Keys Together

A chord assigns an extra action to a pair of numbered keys. For example, Key 1 can copy, Key 2 can paste, and **Keys 1 + 2** together can switch layers.

![Keys 4 and 5 form a local chord on Layer 1 that runs Macro 1](../images/configuration-overview/07-chord.png)

1. Select the layer where you want the chord
2. In **Chords**, choose a **Key Pair** and click **Add Chord**
3. Click the chord row and choose its action in the **Action Editor**
4. Leave it local to that layer, or click its **Globe** button to make it global
5. Save the profile, then press the two keys together to try it. Make sure you press the two keys nearly simultaneously. By default the **Chord Window** (the time duration you get to press both keys) is just 40ms

**Local** chords apply only on their layer. **Global** chords appear across layers and use the same action everywhere. A local chord for the same key pair takes priority on its layer. Only one global chord can use a given pair. The editor prevents conflicting choices.

**Chords** use exactly two numbered keys. The wheel button and wheel turns are not chord members. A three-key pad has three possible pairs; a six-key pad has fifteen, although storage limits how many you can assign.

### Chord Timing

The **Chord Window** in **Profile Settings** is how long the first key waits for its partner. The active v16 editor offers 20ms–90ms in 10ms steps; the starter setting is 40ms, or four one-hundredths of a second. The frozen v14 editor retains its earlier 5ms–75ms choices and **Off** setting.

- A larger window makes chords easier to press but adds a small delay to individual keys that belong to a chord
- A smaller window makes those individual keys respond sooner, but requires more nearly simultaneous presses
- Keys that do not belong to a chord on the selected layer have no delay
- With no saved chords, keys act immediately without waiting for a window
- Imported windows round to the nearest supported value, with ties upward and a minimum of 20ms; changed values show a migration notice
- Previously disabled imported chords keep their bindings and require a **Chord Window** selection before saving to enable them

A recognized chord runs its action instead of the two individual actions. For a hold action, releasing either chord key ends the hold. Release both keys before attempting the same chord again. If you miss the timing window, the keys act individually.

## Timed Actions and Reminders

You can add up to four timed actions, depending on remaining configuration storage space. They repeat automatically and can operate across all layers or on one selected layer.

![An inactivity timer turns both lighting brightnesses off after roughly thirty minutes; the next input restores configured lighting and is consumed](../images/configuration-overview/08-timed-actions.png)

1. Click **Add Timed Action**
2. Choose **All Layers** or a specific layer in **Run On**, then set **Interval** with the slider
3. Set **Reset Timer on Input** to **Yes** or **No**
4. Click **When Timer Fires**, then choose its action in the **Action Editor**
5. Optionally expand **On Next Input** and configure a follow-up action and **Consume This Input**
6. Save to the device

### Repeating Versus Inactivity Timers

| Setting | Result |
| --- | --- |
| **Reset Timer on Input** set to **No** | Repeats at the selected interval, even while you use the macropad |
| **Reset Timer on Input** set to **Yes** | Resets the timer whenever you press a macropad key, press the wheel button, or turn the wheel. Useful for actions based on inactivity |

“Input” means activity on the macropad. Using your computer's regular keyboard or mouse does not restart these timers. Keeping a button held only resets the timer when you first press the button.

The interval uses steps of 4.096 seconds, up to 2 hours 19 minutes 48.608 seconds.
Use the slider to select the interval; its label shows the approximate duration
in hours, minutes and seconds as needed. Each timer measures from its own last start or restart,
with less than 16ms of early clock quantization. A one-step interval becomes
due about 4.080–4.096 seconds after its reset. Polling, queued output and the
device clock can add timing error. Each timer uses six bytes of device storage.

A timer assigned to a layer advances only while that layer is active. Every
actual layer change resets layer-specific intervals, so returning to the layer
starts a fresh interval. Global timers continue through layer changes. Already
armed **On Next Input** actions remain armed and run on the next macropad input,
even if their timer's assigned layer is no longer active.

### On Next Input

After a timer has fired, its optional **On Next Input** action runs once when you next use a macropad input. It can restore the lighting after a reminder, for example.

- With **Consume This Input** off, the follow-up action runs and then the input's normal action runs too
- With **Consume This Input** on, the input dismisses the reminder without running its normal action. Press or turn again to use the normal action
- Consumption works even if the follow-up action is **Nothing**

This follow-up does not stop the repeating timer. Multiple timers can be waiting for the same next input, so plan their actions together. Both timer action slots support actions that do not need a release, including text, media controls, layer changes, mouse steps, and LED controls.

For a complete lighting reminder, see [the example configuration](#create-a-reminder-to-take-a-break).

For interactions between multiple timers and layer changes, see [Gotchas and Things to Watch Out for with Timed Actions](#timed-action-gotchas) at the end of this guide. Expand the section to read it.

## LED Colors and Effects

There are three main ways to use lighting: a color when a key is pressed, a layer indicator, and an **LED Control** action that changes lighting during use.

The fixed color palette offers **Red**, **Coral**, **Orange**, **Amber**, **Yellow**, **Green**, **Leaf**, **Cyan**, **Azure**, **Blue**, **Violet**, **Magenta**, **Rose**, and **White**. The first swatch is **Off** for key-press, idle and temporary-effect colors, or **Per-Key Colors** for layer indicators. The final swatch is **Rainbow** in every palette. Older profiles migrate **Teal** to **Cyan** with brightness unchanged. Custom colors are not available.

### Key-Press Colors

Select a numbered key, then choose **LED Color on Key Press** in the **Action Editor**. **Apply to Layer** copies that color to every numbered key on the current layer; it leaves their actions unchanged. Key-press colors always use full brightness (unless altered by an [**LED Control** command](#led-control-actions-during-use)).

**Preview Color** temporarily shows the selected color on the connected device without saving your profile. **Cancel Preview** returns to its usual lighting. A preview is not a saved setting. If preview is unavailable on your device, use its saved settings to test the result.

### Layer Indicators

In **Layer Options**, set **Layer Indicator Mode**:

| Mode | What You See |
| --- | --- |
| **Do Not Indicate** | No layer indication; key-press colors can still work |
| **On for 1.5 Seconds** | Shows the chosen layer color or rainbow briefly when selecting the layer |
| **Blink by Layer Number** | Blinks once for **Layer 1**, twice for **Layer 2**, and so on. Each blink is a quarter-second on and a quarter-second off |
| **Always On** | Idle keys show the layer color or rainbow; pressed keys show their individual key-press colors |

Choose the **Layer Indicator Color** and **Full Brightness** or **Dim**. The timed and blinking indications temporarily cover key-press colors. The always-on background allows key-press colors to show over it.

### Per-Key Idle Colors

Choose **Per-Key Colors** under **Layer Indicator Color**, then select a numbered
key and set **LED Idle Color** above **LED Color on Key Press**. The first use
copies the uniform layer color to every idle key. All idle colors, including
**Off** and **Rainbow**, follow the layer's indicator mode and shared brightness.
Timed and blinking indications use this palette too.

For idle colors, **Apply to Layer** selects a uniform layer color and reclaims
3 bytes on a six-key pad or 2 bytes on a three-key pad. Applying **Off** instead
turns every idle color off while retaining per-key mode. A sidebar warning
identifies identical non-black idle colors that could use a uniform color.

Selecting a uniform layer color hides the idle palette and retains its colors
for later reuse. Drafts and JSON exports preserve these inactive colors; device
storage contains only active palettes. Reading a profile from the device cannot
recover inactive colors. Keep a JSON backup when moving between browsers.

The device visualization blends the idle colors around the layer border and
shows rainbow within each rainbow key's portion. Key-press strips show their
selected solid color or rainbow. **Device Storage** lists active layer palettes
separately; hover, focus or tap a bar segment for its byte count.

### Auto-Sleep

With format 15 or later firmware, enable **Auto-Sleep** in **Layer Options**, or choose
**On** in **Profile Settings** to enable every layer. **Per Layer** keeps
individual layer choices; **Off** disables every layer. During editing, choosing
**On** or **Off** remembers your per-layer choices; choose **Per Layer** again
to restore them. Undo and redo restore both the mode and those choices.
The remembered choices belong to the current editing session; saving writes
the active choices to the device. Sleep adds no profile bytes and leaves all
four **Timed Actions** available.

The profile-wide settings apply to every enabled layer:

| Setting | Behavior |
| --- | --- |
| **Sleep Timeout** | **15 Minutes**, **30 Minutes** (default), **1 Hour** or **2 Hours** of inactivity |
| **Consume Wake Input** | Enabled by default. The first press or complete encoder turn wakes the pad and is consumed, including its release. Disable to wake and execute the same binding. |
| **Show Layer Indicator** | Enabled by default. Restart **On for 1.5 Seconds** or **Blink by Layer Number** on wake; **Always On** and **Do Not Indicate** keep their configured behavior. |
| **Dim Instead of Off** | Disabled by default. Use **Layers and Keys Dim** during sleep instead of **Both Off**, retaining configured indicator behavior at the existing fixed dim brightness. |

Presses and completed encoder turns restart the timer, even when unbound.
Releases, held inputs, partial turns and USB traffic do not. Switching between
enabled layers preserves elapsed sleep time. Entering a disabled layer clears
the timer and, if asleep, restores awake lighting immediately without
consuming the next input. That layer stays awake; returning to an enabled layer
starts a full timeout. This applies even to switches made by **Timed Actions**
or macros. Other timed actions and macro output do not restart the timer.
Explicit LED commands still work on disabled layers. A consumed wake preserves
an armed one-shot layer; an
executed wake uses it normally. A consuming user timer can still consume the
input. Format 16 firmware restores the indicator and key-press brightness policies
selected before sleep, including manual overrides and mixed policies, before an
executed binding runs. Repeated sleep timeouts preserve that selection. Published
v15 firmware restores **Both as Configured**. Timed or macro LED commands can
change lighting while asleep, but do not end sleep or replace the remembered
selection. Applying a profile or resetting USB clears it and restores configured
brightness.
Brightness preservation is automatic with the updated format 16 firmware; it
requires no new setting or profile conversion. For example, **Layers and Keys Dim**
selected before sleep is restored even when sleep turns the LEDs off.
Dimming does not turn an inactive indicator on. USB, scanning and held output
continue during sleep. Use **Timed Actions** for other intervals or custom
sleep/wake actions.

### Rainbow Settings and an Off Key

When a layer uses a rainbow indicator, **Profile** shows settings to adjust the rainbow (applies to all layers):

| **Rainbow Phase Spacing** | Appearance |
| --- | --- |
| **0° — All LEDs Together** | All LEDs cycle through the same color at the same time |
| **30° — Gentle Color Wave** | Neighboring LEDs have similar colors |
| **60° — Rainbow Sweep** | A wider spread of colors across the keys |
| **Variable — Scattered Colors** | A more scattered spread of colors |

**Rainbow Speed** offers **Extra Fast**, **Fast**, **Slow**, and **Extra Slow**. These settings apply across layers. Save changes before expecting device color previews to use the new speed or spacing. An [**LED Control** action](#led-control-actions-during-use) can also change them during use.

If you combine an **Always On** layer indicator with an **Off** key-press color, **Profile** offers **For Key LEDs, “Off” Means**:

- **Transparent:** pressing an **Off**-colored key leaves the idle background visible
- **Black:** pressing it makes that key go dark over the always-on background

This setting applies across layers. Timed and blinking layer indications still cover the key colors while their indication runs.

### LED Control Actions During Use

Choose **LED Control** as an input's action, then select an **LED Command**. These actions let you adjust lighting without reopening the configurator. The adjustments apply across layers and reset when you save a configuration or reset/reconnect the device.

| Command | What It Changes |
| --- | --- |
| **Set Rainbow Phase Spacing** | Selects a specific spacing, or restores **As Configured** |
| **Relative Rainbow Phase Spacing** | Steps through the spacing choices, wrapping around |
| **Set Rainbow Speed** | Selects a speed, or restores **As Configured** |
| **Relative Rainbow Speed** | Steps through speeds. Positive steps move toward faster choices; negative steps toward slower ones, wrapping around. Follow the cycle shown in the editor |
| **Set Layer-Indicator Brightness** | Forces the indicator off, dim, or bright, or restores its configured brightness |
| **Relative Layer-Indicator Brightness** | Cycles through off, dim, and bright |
| **Set Key-Press Brightness** | Forces key feedback off, dim, or bright, or restores configured behavior |
| **Relative Key-Press Brightness** | Cycles key feedback through off, dim, and bright |
| **Set Both Brightnesses** | Applies the same brightness choice to both kinds of lighting |
| **Relative Both Brightnesses** | Starts from the brighter current brightness, applies the relative step, and sets both to the same result |
| **Set Common Brightness Preset** | Applies one of the combinations listed below |
| **Relative Common Brightness Preset** | Cycles through those preset combinations |
| **Toggle Preset On/Off** | Applies the chosen preset; when that preset is active, activating again restores configured layer and key brightness. This affects brightness only, rainbow speed and spacing stay unchanged |
| **Set All LEDs** | Starts or clears a temporary color or rainbow effect; see below |
| **Restore All Configured LED Settings** | Restores configured lighting, including brightness, rainbow settings, and temporary effects |

The common brightness presets are:

1. **Both as Configured**
2. **Layers Dim, Keys Bright**
3. **Layers and Keys Dim**
4. **Layers Off, Keys Dim**
5. **Both Off**

![The inactivity timer uses LED Control with Set Common Brightness Preset and Both Off](../images/configuration-overview/09-led-effect.png)

Relative settings use a **Relative Step** to choose direction and, for rainbow controls, whether to skip a choice. The editor shows the cycle order. **Relative Both Brightnesses** resolves each current brightness, starts from the brighter one, and applies the step once through **Off** → **Dim** → **Bright** → **Off** (backwards for a negative step). It sets both brightnesses to that same result.

For example, **Dim** indicator + **Bright** key feedback becomes both **Off** with +1, or both **Dim** with −1. **As Configured** resolves to the current layer's saved indicator brightness and **Bright** key feedback before comparing. This uses the brightness settings, regardless of whether an indicator or key is currently lit.

Earlier firmware advanced both brightnesses independently; update the firmware to get synchronized stepping. Existing profiles need no conversion.

Indicator brightness preserves the selected indicator mode: making it bright does not turn **Do Not Indicate** into an always-on background (use **Set All LEDs** to accomplish that). Forcing key feedback off lets the idle background show through.

### Temporary Effects: Set All LEDs

With **LED Command → Set All LEDs**, choose:

| Effect | Behavior |
| --- | --- |
| **As Configured** | Clears the temporary effect and returns to normal lighting |
| **Always On** | Shows the chosen color or rainbow until another effect replaces it, you restore lighting, or the layer changes. Key feedback can appear over it |
| **Blink** | Blinks the chosen color or rainbow 1–8 times, then returns to normal lighting. It covers key feedback during the effect |

Choose a color or **Rainbow**, plus **Full Brightness** or **Dim**, for **Always On** and **Blink** effects. These do not replace the layer's saved color settings.

Finishing or clearing an effect returns to normal lighting without replaying the layer's timed or blinking selection indication. Existing brightness overrides remain active when you clear an effect with **As Configured**. Use **Restore All Configured LED Settings** to clear those overrides too.

## Shortcuts, Copy and Paste, and Drag and Drop

### Use the Shortcut Library

Expand **Shortcuts**, select **Mac** or **Windows**, and search for an action name or application. The library includes everyday editing, browser controls, window management, screenshots, media keys, standard keyboard keys, and application-specific shortcuts for Word, Google Docs, PowerPoint, VS Code, Vim, and tmux, plus short text snippets.

![Shortcut library filtered to copy actions, with Mac and Windows choices and matching presets](../images/configuration-overview/05-shortcuts.png)

Drag a shortcut onto a numbered key, wheel input, chord, or timer action to replace that input's action. Clicking a shortcut does not apply it. Dragging from the library copies the preset; it does not remove it from the library or change the key's key-press color.

Check the **Action Editor** afterward to see the assigned combination or text. Application shortcuts depend on the application, its mode, and your computer's settings. Text snippets insert literal text; they do not automatically wrap a selection or move the cursor into a template.

### Copy or Move an Existing Action

1. Click the input you want to copy in the macropad layout, chord list, or timer section
2. Press the usual copy shortcut (shown below)
3. Select the destination input, changing layer tabs first if needed
4. Press paste. The destination's previous action is replaced

| Edit | Windows | Mac |
| --- | --- | --- |
| **Copy** selected input | **Ctrl+C** | **Command+C** |
| **Cut** selected input | **Ctrl+X** | **Command+X** |
| **Paste** onto selected input | **Ctrl+V** | **Command+V** |
| **Undo** an editor change | **Ctrl+Z** | **Command+Z** |
| **Redo** an editor change | **Ctrl+Shift+Z** or **Ctrl+Y** | **Command+Shift+Z** |
| Clear selected action | Delete or Backspace | Delete or Backspace |

**Copy**, cut and paste act on the highlighted input, even after you click another control such as its LED color. If you are typing in a text box or have ordinary page text selected, the shortcuts work on that text instead. Clicking anywhere clears existing page-text selection; dragging to select new text still lets you copy that text. A toast confirms the action and the trigger it was copied or cut from, or pasted to. Copying one action is different from **Export to Clipboard**, which copies the entire profile for backup.

Copying or cutting a numbered key also includes its key-press color. Pasting it onto another numbered key transfers that color; pasting onto a wheel input, chord, or timer transfers only the action. Cutting clears the original action and turns its key-press color **Off**.

Delete or Backspace first changes the selected action to **Nothing**. On a numbered key whose action is already **Nothing**, another press turns its key-press color **Off**. Clearing a chord action does not **Delete** the chord; use its trash button to remove the chord and reclaim its storage.

Use the top-bar **Undo** and **Redo** buttons if you prefer clicking. They undo editor changes; use **Save to Device** to apply the resulting profile to hardware. While editing text, keyboard undo normally applies to the text field instead.

### Drag and Drop Existing Actions

![An action being dragged from Key 5, with its source key dimmed during the move](../images/configuration-overview/10-drag-drop.png)

| Where You Drop | Result |
| --- | --- |
| Center of another input | Swaps the two actions. The destination's old action moves to the source |
| Edge of an input, or gap between inputs | Inserts and reorders within a supported group. Other actions shift along. A line marks the insertion point |
| Center of a layer tab | Swaps the two entire layers |
| Edge of a layer tab, or gap between tabs | Moves the entire layer into that position |

Numbered keys reorder within their layer, wheel inputs within their list, and chords within their displayed list. Reordering chord actions changes which key pair runs each action; it does not change the pair labels.

Key-to-key swaps and key reordering carry key-press colors along with the actions. Swapping between different kinds of input transfers actions only. Timer action slots support swapping, rather than edge insertion; dragging their actions does not move the timer's interval or checkboxes.

Layer moves carry their bindings, colors, options, and attached chords. The configurator updates explicit layer targets and the startup layer to follow the moved layers. Relative switches still follow numerical order, so review them after rearranging layers.

An invalid destination is not accepted. In particular, a swap must leave both inputs with allowed actions: you cannot swap a hold action into a timer or wheel-turn input. Use copy and paste when you want a duplicate rather than a swap.

## Macros

Macros are supported by the [pre-built v16 release firmware](../README.md#how-to-compile-the-firmware)
and its [matching configurator](https://perkinsb1024.github.io/CH552-Macropad-v2/).
V16 hardware validation is complete. Older firmware uses its matching archived
editor; versions before v11 do not support macros.

1. Open **Macros** and choose **Add Macro**
2. Select a step to edit it in the **Action Editor**; choose **Add Step** to extend the sequence
3. Drag a step to the top or bottom edge of another step to insert it there, or to its center to swap. Use the trash control inside a step to remove it
4. Assign **Execute Macro** to a key, wheel input, chord or timer, choose **Macro**, and set **Repeat Count** from 1–16
5. Check **Device Storage**, then **Save to Device**

For opening Chrome through Spotlight (on MacOS), use these steps:

| Step | Action | Setting |
| --- | --- | --- |
| 1 | **Key Tap** | **GUI (Win / Cmd)** + **Space** |
| 2 | **Pause** | 256ms |
| 3 | **Type Text** | `chrome` |
| 4 | **Key Tap** | **Enter** |

**Pause Duration** adjusts in 16ms
steps up to 4 seconds. You can add successive pauses for if you need longer waits.
Tune the delay on your computer because applications take different amounts of time to open.

A macro can contain as many steps as fit within your [configuration budget](#the-128-byte-configuration-size-limit). Held
actions and nested **Execute Macro** steps are unavailable. Deleting a macro clears
its bindings and renumbers later macro references. **Undo** restores both.
Moving layers updates explicit targets in macro steps.

Switching layers immediately cancels any currently-running macros. This includes
layer-switching actions that occur within the macro itself. Therefore, any layer-switching
actions must be the final step, and that macro must have **Repeat Count** set to 1.
This applies to **Switch to Layer** and **Relative Layer**, including their one-shot variants,
even if the target layer is already active. **Add Step** and **Add Pause** stay
below the steps but insert new actions before the first layer switch. A labeled
divider marks that position. Any layer switch that is not the final step has a
red border. Additions are available while storage permits, even when the sequence
needs repair. Reordering, pasting or editing steps into an invalid
order blocks saving until you fix it.

For example, a tmux command-mode macro can prepare both tmux and your macropad:

| Step | Action | Setting |
| --- | --- | --- |
| 1 | **Key Tap** | **Ctrl** + **B** (tmux's default command prefix) |
| 2 | **Switch to Layer** | The layer containing your tmux command shortcuts |

Assign this macro to a button with **Repeat Count** set to 1. After pressing it,
the next macropad input uses your tmux command layer.

**Note:** Internally, a **Nothing** action signifies the end of a macro, so it is
unavailable for normal use within a macro. If you delete the action from a macro step,
it will be replaced with a 0-duration pause.

A macro continues running even after the key that triggered it is released and its steps
always run in order. If you trigger another action while a macro is still running,
some actions wait for the macro to finish, while others act immediately:

| Behavior | Actions Triggered While a Macro Is Running |
| --- | --- |
| Waits for the macro to finish | **Key Tap**, **Type Text**, **Mouse Click**, **Scroll** set to **Tap**, **Move Mouse** set to **Tap**, and another **Execute Macro** |
| Does not wait for the macro to finish | **Key Hold**, **Mouse Hold**, **Mouse Toggle**, **Mouse Down**, **Mouse Up**, **Media / System** and **Media / System with Modifiers** with either behavior, **LED Control**, **Switch to Layer**, and **Relative Layer** with any behavior |

Changing the active layer cancels the rest of the macro and clears waiting
actions. *This also applies to a layer-switching step inside a macro:* the layer
changes, but later steps and remaining repeats do not run. Selecting the layer
that is already active does not cancel playback.

Waiting actions share an eight-entry queue. Each macro invocation uses one
entry, regardless of its step or repeat count. If the queue is full, newly
triggered actions that need to wait are ignored. Avoid triggering long macros
faster than they finish.

## The 128-Byte Configuration Size Limit

The microchip this macropad is based on has only 128 bytes of space that can be used to save your entire device profile.

To put that into perspective, “The quick brown fox jumps over the lazy dog” takes up 43 bytes. That one short sentence uses over a third of the macropad's entire configuration space, even before accounting for your layers and other settings!

While space is limited, the configuration format is extremely efficient and can support dozens of unique actions. When building your configuration profile, you do not have to manually keep track of used and available space. **Device Storage** adds it up as you edit, shows the free space, and reports when you go over the limit. Its “Header” line simply means the space reserved for basic profile settings.

![Device storage meter showing two layers, a chord, a timed action, a macro, and a string, with 52 of 128 bytes free](../images/configuration-overview/03-storage.png)

| Item | Space Used |
| --- | --- |
| Basic profile settings | 9 bytes, always |
| Each three-key layer | 15 bytes, including all its regular input assignments, key colors, and layer options |
| Each six-key layer | 22 bytes, including all its regular input assignments, key colors, and layer options |
| Each active per-key layer palette | 2 bytes on three-key hardware; 3 bytes on six-key hardware |
| Each chord | 3 bytes, whether local or global |
| Each timed action | 6 bytes, including its interval, options, and both action assignments |
| Each macro | 2 bytes per step plus a 1-byte terminator; the final sequence can use the image boundary instead |
| Each different text phrase | One byte per character, plus one extra byte |

Ordinary actions fit into the space already reserved for their layer, chord, or timer. For example, changing a key from **Nothing** to a keyboard shortcut, mouse action, or **LED Control** does not need extra space. **Type Text** adds the phrase's storage cost.

The starter two-layer profile uses 39 bytes on a three-key pad or 53 bytes on a six-key pad, leaving 89 or 75 bytes respectively for all additional layers, chords, timers, macros, or saved text.

### Make the Most of the Space

- Use keyboard and media actions for shortcuts instead of typing a text sequence when either would do the job
- Use a uniform **Layer Indicator Color** when every idle key has the same non-black color
- Keep text phrases short. Spaces, tabs, and line breaks count too
- Reuse identical text. Assigning the exact same phrase to several inputs stores it only once; changing its capitalization or punctuation makes it a different phrase
- Use a global chord for an action you want on every layer, instead of adding identical local chords to each layer
- Reuse a macro from multiple triggers, or repeat its sequence without duplicating steps
- Remove unused macros with their trash controls
- Remove unused chords and timers with their trash buttons. Setting their actions to **Nothing** keeps the chord or timer and its storage cost
- Remove unused layers. Clearing a layer's inputs does not reduce the layer's fixed cost
- Review storage after adding a new layer, because that copies local chords and may add more than just the layer's basic cost

The 128-byte limit is shared by everything. For example, if you use the maximum number of layers, you may not have room for all the chords, timers, and text you want. If you run out, simplify the profile until the **Fix Before Saving** error goes away.

An exported backup file is much larger than 128 bytes because it is a readable description of the settings. That file size is not your device storage usage; the **Device Storage** meter is the one to follow.

## Save, Back Up, and Restore

### Save to Device

Edits stay in the browser until you click **Save to Device**. Wait for **Saved** before disconnecting. Saving applies the whole profile and restarts device operation on the startup layer, including timers and configured lighting.

The configurator disables saving if the profile is invalid, over capacity, for the wrong key count, or incompatible with the connected device. **Fix Before Saving** lists profile problems; click a listed input to edit it. Advisory warnings about layer routes or encoder holds are worth reviewing even when they do not block saving.

### Back Up or Share a Profile

In **Backup & Restore**:

![Backup and restore controls for exporting, importing, and resetting a profile](../images/configuration-overview/04-backup.png)

- **Export JSON** downloads your current editor profile as a file. Give the file a useful name, such as “Macropad – Photo editing.json.” You do not need to open or edit its contents
- **Export to Clipboard** copies the same complete profile so you can keep or share it as text
- Both exports include the editor's current settings, including unsaved edits

Save an export somewhere you can find it again. A device save and a backup serve different purposes: the device save applies settings to hardware; the export gives you a separate copy to restore later.

### Import or Start Again

- **Import Profile** opens an exported profile file in the editor
- **Import from Clipboard** opens a dialog where you paste a complete exported profile and click **Import**
- **Read from Device** replaces the editor profile with the device's saved settings and clears undo history. The confirmation warns that unsaved edits will be lost
- **Reset to Starter Profile** replaces the editor settings with the starter configuration after confirmation. It does not immediately reset the device

*Importing or resetting does not change your macropad until you save.* **Import** a profile for the correct three-key or six-key model. Export your current work first if you want to keep both versions.

The browser also keeps a local draft. On reconnect, it may ask whether to use the draft or load from the device. Choose the draft to continue browser edits, or the device copy to start from what is already saved on hardware. Browser drafts can disappear when browser data is cleared and are separate from the device's saved profile; keep an exported backup for anything you want to preserve.

### Enter Firmware Update Mode

With v12 firmware, click **Enter Bootloader** in the [firmware installer](../webUploader/), select the running macropad, then click **Connect Bootloader**. This works even without a valid saved profile. The LEDs turn red when the device enters update mode.

Holding the encoder button while connecting USB remains available with every version of this firmware. Runtime encoder holds do not enter update mode in v12. Older firmware may support an optional three-second hold on enabled layers; its configurator controls that option.

Firmware update mode is for replacing device software. Use **Save to Device** to change a profile. See the [firmware setup instructions](../README.md#how-to-upload-the-firmware) for hardware bootloader entry if the firmware cannot run.

## Example Configurations

### Everyday Editing with a Useful Wheel

- Assign **Key Tap** shortcuts for **Copy**, **Paste**, and **Undo**. Use **Ctrl** on Windows or Command on Mac
  - On a six-key macropad, consider adding **Cut**, Save and **Redo**
- Set **Turn Left** to **Scroll → Up**, and **Turn Right** to **Scroll → Down**, with a small **Wheel Step** such as 2
- Give the keys different key-press colors to help identify them
- Save, then test in a document with some text selected

### Two Layers: Editing and Music

1. Configure your editing layer
2. Click **Add Layer** to create a blank layer, then assign its keys to **Play / Pause**, **Next Track**, and **Mute**
3. On the music layer, use **Volume Down** and **Volume Up** for the wheel turns
4. Give each layer an **Always On** indicator in a different color
5. Add a **Keys 1 + 2** chord with **Relative Layer → +1**, then click its **Globe** to make it apply to all layers
6. Save. Press Keys 1 and 2 together to cycle between the two layers

If you start from the two-layer starter, customize its existing layers instead of adding a third one. Check that local chords do not override your global switching pair.

### Create a Reminder to Take a Break

1. Click **Add Timed Action**. Adjust the **Interval** slider to roughly one hour (879 ticks, or 3600.384 seconds)
2. Leave **Reset Timer on Input** set to **No** for an hourly reminder. Choose **Yes** if you want the reminder only after an hour of macropad inactivity
3. Select **When Timer Fires → LED Control → Set All LEDs → Always On**. Choose **Amber** and **Full Brightness**
4. Expand **On Next Input**, select its action, and choose **LED Control → Set All LEDs → As Configured**
5. Enable **Consume This Input** if you want the next device interaction after the alert to only dismiss the reminder instead of firing its usual action
6. Save. The reminder turns the LEDs amber; your next macropad input clears the effect

Each timer has less than 16ms of early clock quantization; firmware polling, queued output and USB delays can make the reminder arrive later. If you prefer an alert that clears itself, choose **Blink** and a blink count instead of **Always On**. A layer change also clears an always-on temporary effect.

## Troubleshooting

| Problem | What to Try |
| --- | --- |
| Device does not appear in the chooser | Use desktop Chrome or Edge, the hosted configurator, a USB-A to USB-C cable (you'll need a dongle on Macs), and a macropad running this project's firmware. Reconnect after installing firmware. These boards will not power on with a USB-C to USB-C cable. Linux users may need the [device access setup](../webapp/README.md#linux-device-access) |
| One red LED blinks and controls do nothing | Connect and save a valid profile |
| **Key 1** blinks yellow after a one-second startup delay | USB enumeration has not completed. Check the USB data cable and connection, or wait for the computer to recognize the device. Enumeration clears the warning automatically. Press **Key 1** to dismiss it manually; keyboard/mouse output still requires enumeration |
| All LEDs are red and controls do nothing | Device is in bootloader mode (firmware update mode). Unplug and replug the device without holding the wheel button |
| My edits have no effect | Click **Save to Device** and wait for **Saved**. Check that you are connected to hardware, rather than a simulator |
| Clicking a layer tab does not update the device | Tabs only affect what you're currently edit. Use a saved layer-switch action on the macropad |
| I cannot get back to my usual layer | Configure a return action or a global layer-cycle chord. Reconnecting starts on the saved startup layer |
| Save is disabled | Check the connection, key count, storage meter, and **Fix Before Saving** error. Follow any compatibility notice for older firmware |
| A chord runs two ordinary actions | Increase the **Chord Window** slightly, resolve any imported-window selection warning, press the pair nearly simultaneously, and release both keys before trying again. Check the chord's layer or global setting |
| **Copy** or paste acts on text instead of a binding | Select the key, wheel input, chord row, or timer action. Deselect any text editor and clear page-text selection; highlighted input will become the clipboard target |
| A dragged action is rejected | A hold action cannot go onto a wheel turn or timer. For swaps, check that the action moving back is also allowed at its destination |
| Typed text contains wrong characters | Check your computer's keyboard layout; **Type Text** expects US layout. Replace unsupported characters with plain letters and punctuation |
| A media or brightness control does nothing | Your operating system, application, or display may not support it. Try the matching keyboard shortcut if one is available |
| A reminder fires earlier than expected | v10–v16 clock quantization is less than 16ms early. Earlier firmware has coarser timing; use matching firmware and editor and review the rounded interval |
| An inactivity timer ignores my regular keyboard | Only macropad presses and completed wheel turns reset the inactivity timer |
| My first press after a Timed action does nothing | **Consume This Input** may be enabled. That input dismisses the Timed action; the next one runs normally |
| Holding the wheel button disconnects the device | Older firmware may have the three-second bootloader option enabled. Disable it in the matching configurator. V12 uses the installer button for runtime bootloader entry. Unplug and replug without holding any buttons to leave update mode |
| The mouse seems stuck dragging | Use **Mouse Up** for that button in v12, or change layers to clear persistent buttons. With v11, use **Mouse Toggle** to flip the shared state. Release any **Mouse Hold** inputs too |
| LEDs do not look like the editor | Check layer indicators, key colors, temporary effects, and brightness overrides. Use **Restore All Configured LED Settings** to restore saved behavior |
| LEDs do not light up at all | The absolute cheapest versions of these macropads do not include LEDs. Someone skilled with a soldering iron can add them, but it's probably easier to buy a macropad that already includes them |
| My device has older firmware | Follow the configurator's compatibility notice or use **Older Firmware Configurators**. Older editors may have fewer features than this guide |

<a name="timed-action-gotchas"></a>

<details>
<summary><strong>Advanced: Gotchas and Things to Watch Out for with Timed Actions</strong></summary>

**Timed Actions** and their **On Next Input** actions are complicated and when you have more than one defined, they can interact in unexpected ways. The following setups are allowed, but their interactions can produce results you did not intend. Pay particular attention to one-shot layer returns and note that layer changes preserve armed **On Next Input** actions while resetting layer-specific intervals. Layer changes still cancel queued playback.

### How Multiple Pending Follow-Ups Run

When several timers have fired, the same next macropad input processes all their pending **On Next Input** actions, in timer-list order: **Timer 1**, **Timer 2**, and so on. The order follows their positions in the configuration, regardless of which timer fired first. Each follow-up runs once; repeated timer firings before the next input do not accumulate extra copies of that timer's follow-up.

If any pending timer has **Consume This Input** enabled, all pending follow-ups still run, but the input's normal binding is skipped. Several consuming timers consume just that one press or completed wheel turn, rather than several future inputs. Consumption works even with the follow-up set to **Nothing**; a timer that has not fired does not consume the input.

### One-Shot Layer Returns Can Be Overwritten

There is only one stored destination for one-shot layer changes, shared by both ordinary inputs and timers. Multiple one-shot selections will overwrite the previous destination layer. For example, starting on **Layer 1**, suppose two pending follow-ups select **Layer 2** one-shot and then **Layer 3** one-shot:

1. The follow-ups leave the device on **Layer 3**, with **Layer 2** as the return destination
2. The next normal input uses **Layer 3**'s binding and returns to **Layer 2**
3. Later inputs use **Layer 2**. There is no automatic return to **Layer 1**, because that destination was overwritten

This example assumes the input that runs the follow-ups is consumed. If it is not consumed, that same input uses the **Layer 3** binding and consumes the one-shot immediately. An input's own layer-switch action can also change the result.

A *persistent timed layer selection does not clear an already-pending one-shot return*. For example, starting on **Layer 1**, a follow-up selects **Layer 2** one-shot and another selects **Layer 3** persistently. With the waking input consumed, **Layer 3** remains active until the next normal input; that input uses **Layer 3**'s binding and returns to **Layer 1**, unless its own action selects another layer. The pending return can also come from an ordinary one-shot input used before the timer fired.

Review overlapping timers together, and avoid combining one-shot and persistent selections if you expect the persistent selection to cancel the return.

### Layer Changes Can Cancel Queued Actions

Keyboard taps, text, mouse clicks, scrolling, and pointer steps wait in a playback queue. *A change to the effective layer clears queued playback and interrupts playback already in progress.* Processing a follow-up therefore does not guarantee that all of its output reaches the computer. Media actions share a separate newest-wins output lane; layer changes cancel pending media taps, while keyboard and media holds continue until release. Reports already accepted by USB keep their order.

For example, if **Timer 1**'s follow-up sends a keyboard shortcut and **Timer 2**'s follow-up changes layers, the shortcut can be cancelled before it is sent. Reversing those assignments lets the layer change happen before the shortcut is queued. Selecting the already-active layer does not clear playback.

The same cancellation can happen when the unconsumed input's normal binding changes layers after the follow-ups. For a follow-up that both needs to send output and runs alongside a layer change, put the layer change first and review the waking input's binding too.

### Other Interactions to Watch For

| Configuration | What Happens |
| --- | --- |
| Multiple persistent **Switch to Layer** follow-ups | The last selection in timer-list order wins. **Timer 1** selecting **Layer 1** followed by **Timer 2** selecting **Layer 2** leaves the persistent selection on **Layer 2** |
| Layer-changing follow-ups with **Consume This Input** off | The normal input's binding is looked up on the resulting active layer. It can run a different action than expected, or change the layer again |
| Two **Previous Layer** follow-ups | Each sees the history left by the earlier selection. They can switch away and then back again, rather than both restoring the layer you used before the reminders. Previous-layer history holds one entry |
| Multiple **Relative Layer** follow-ups | Their changes accumulate sequentially and wrap around. Two +1 selections normally advance two layers |
| A persistent layer selection while a layer action set to **Hold** is active | The held layer keeps priority. Releasing the held input reveals the new persistent selection. Relative timed selections use the currently active layer as their starting point |
| Different timers using **Mouse Toggle** for the same mouse button | All timers share the global toggle state with other inputs and macros. Two toggle actions for the same button cancel each other; a change to the effective layer clears the toggle state |
| Conflicting **LED Control** follow-ups | Later actions overwrite overlapping settings. Relative adjustments and toggles operate on the state left by earlier actions. An unconsumed input's own LED action runs afterwards and can change the result again |
| Output follow-ups while playback is backed up | The playback queue has eight entries. New output can be dropped when it is full; the timer's pending follow-up is still cleared, so it is not automatically retried |

**Consume This Input** only suppresses the waking input's normal binding. It does not cancel earlier presses or release buttons that are already held. In particular, consuming the second key of a possible chord prevents that key from completing the chord; the earlier key can still run its single-key action. Consumption by itself also leaves an already-armed one-shot layer waiting for a normal input.

</details>

[Back to index](#index)

**Mouse Click**, **Mouse Hold**, **Mouse Toggle**, **Mouse Down** and **Mouse Up** also offer **Click Here** to
open **Scroll & Click Test**. Each mouse button shows **Held** or **Released**
next to its click counter, so held and toggled outputs can be checked. Releases
outside the test area are tracked; leaving the browser clears the display until
another mouse event reports its current button state.
