# Universal Macropad Configurator

Browser-based editor for the CH552 **Universal Macropad**. It talks to the device over
WebHID, edits the 128-byte configuration image defined in `protocol/config-v12.md`,
and saves it using the transport in `protocol/hid-v1.md`. There is no server: the
built output is static files and runs from GitHub Pages, any static host, or a local
directory.

## Requirements

- Node 18 or newer for development (Node 22 recommended).
- Desktop Chrome, Edge, or another Chromium browser for WebHID. Firefox and Safari can
  edit and export profiles but cannot connect to hardware.
- HTTPS or `localhost`. WebHID is unavailable on plain HTTP.

## Commands

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # codec, protocol and JSON round-trip tests (vitest)
npm run typecheck
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

## Linux Device Access

Linux may list the macropad in the browser chooser but deny access to its
`hidraw` device. The configurator's connection help includes the same setup:
create `/etc/udev/rules.d/70-ch552-macropad.rules` using an administrator text
editor, with this line:

```udev
SUBSYSTEM=="hidraw", KERNEL=="hidraw*", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="c55d", MODE="0666"
```

This grants all local users read/write access to this macropad's HID interfaces.
On shared systems, ask your administrator for a group-restricted rule instead.
Run `sudo udevadm control --reload-rules`, unplug and reconnect the macropad,
then try **Connect macropad** again. A sandboxed browser package may also need
its device permissions adjusted. These permissions apply to the running firmware;
see the [installer's Linux setup](../webUploader/README.md#linux) for bootloader access.

## Trying It without Hardware

The current editor waits for **Connect macropad** before opening hardware, even if
the browser has previously granted access. Firmware-version notices only appear
after an explicit connection attempt.

The connect button's dropdown offers a simulated macropad that implements the same
protocol handler as the firmware, including invalid-flash and failed-commit paths.
`?sim=six`, `?sim=three`, or `?sim=blank` in the URL auto-connects the simulator,
which is useful for demo links and screenshots. "**Edit offline**" on the welcome
screen edits a profile for either variant without any device.

## Live View

Open `/liveView` (or `liveView/` beneath the deployed site's project prefix)
to keep a compact shortcut reference beside your work. The configurator's
**Live View** link opens it in another tab. Connect the macropad in the viewer
to read its saved profile; editor drafts are neither restored nor cleared.

The viewer shows the same macropad preview, layer tabs, applicable local/global
chords, and compact timed-action summaries. It has no editing, saving, drag/drop,
or configuration clipboard shortcuts. Device status is polled every 500ms.
Manual tab selection shows a persistent warning when it differs from the active
device layer. Ordinary polls preserve that selection; the next reported device
layer change selects the device layer again. **Follow device** also resynchronizes
immediately. On disconnect, the last loaded profile remains available with a
disconnected notice. Blank/invalid device profiles do not display starter bindings.

`/liveView/?sim=six` and `?sim=three` provide hardware-free previews. Like the
configurator, the simulator models configuration transport rather than physical
key presses. The build includes a standalone `liveView/index.html` entry so
direct viewer links work on static hosting without SPA rewrites.

## Layout

```
src/
  model/      Profile types, constants, defaults, palette, validation, capacity
  codec/      CRC16-CCITT-FALSE, 128-byte image encoder and decoder
  keys/       HID keyboard usage table and consumer-control catalog
  protocol/   Packet framing, WebHID transport, request/reply client, simulator
  io/         Versioned JSON import/export and localStorage drafts
  ui/         Preact components and the signals-based store
tests/        Golden fixtures (default images, capacity table) and round trips
```

The model and codec have no DOM dependencies and are shared by the UI, the
simulator, and the tests.

## How Saving Works

1. The profile is validated and encoded into a canonical image. Save is disabled,
   with the reasons listed, while any problem remains.
2. `BEGIN_WRITE` with the expected CRC, then sequential 23-byte `WRITE_CHUNK`s.
3. `COMMIT_WRITE`. The firmware validates, writes changed DataFlash bytes, and
   verifies them itself.
4. The app independently reads all 128 flash bytes back with `READ_FLASH` and compares
   them byte for byte before showing "**Saved**". A lost commit reply is tolerated because
   verification decides the outcome.

Unsaved edits are kept in the editor on disconnect or failure and persisted as a draft
in `localStorage`, keyed by hardware variant. Reconnecting asks before replacing
either the draft or the device profile.

## Deploying to GitHub Pages

`vite.config.ts` uses a relative `base`, so the build works from any path.
`.github/workflows/deploy-pages.yml` builds, tests, and publishes `webapp/dist`
when webapp changes are pushed to `main`, or when run manually. In the repository's
**Settings → Pages**, the publishing source must be **GitHub Actions**. Existing
Pages deployments using this workflow need no additional website configuration,
custom domain, or deployment environment for archives.

The active format 12 editor is served at the project site's root. Frozen
configurators are checked into `public/versions/` and copied into `dist/versions/`
by Vite on every build. The build verifies each archived file's SHA-256 against
its `archive.json`, so a failed archive check prevents deployment. No old editor
is rebuilt from dependencies in CI.

- `versions/` lists available editors.
- `versions/format-v2/` serves the v2 editor built from commit
  `417f276fda788f71dfcd38d781ddc67306988739`.
- `versions/format-v3/` serves the frozen v3 editor from the revision recorded in its manifest.
- `versions/format-v4/` serves the frozen v4 editor from the revision recorded in its manifest.
- `versions/format-v5/` serves the frozen v5 editor from the revision recorded in its manifest.
- `versions/format-v6/` serves the frozen v6 editor from commit `38d4786`.
- `versions/format-v8/` serves the frozen published-v8 editor and live view, with provenance in its manifest.
- `versions/format-v11/` serves the frozen v11 editor and live view from the finalized v11 release.
- `versions/format-v10/` serves the frozen v10 editor and live view built before v11 changes.
- `versions/format-v9/` serves the frozen v9 editor and live view built before the v10 changes.
- `versions/format-v7/` serves the frozen v7 editor and live view from commit `196e81e`.

The footer links to the archive list. Detecting format 2–10 firmware presents a
persistent link to its archived editor and closes the connection without reading
or writing profiles. The active editor has one firmware encoder and one set of
indicator controls. [Archive provenance and rebuild instructions](archives/README.md)
record the minimal hosting adjustments to the v2 build.

Each editor writes to a separate `universal-macropad:format-vN:` draft namespace.
The active editor can still recover/migrate drafts under the former shared key,
and can recover v2/v3/v4/v5/v6/v7/v8/v9/v10/v11 drafts without overwriting or clearing the archived namespace.

Version 2–10 binary profiles, version 1–10 JSON files, and older drafts can still be
migrated into the active format 12 editor after a firmware upgrade. Bindings and
colors are preserved; **Blink once** becomes the timed indication and transparency
defaults to off. **Rainbow phase spacing** defaults to **60°** on both variants. Firmware does not migrate flash itself: save the migrated profile
through the active editor to store v12. Older stored profiles remain readable but inactive until saved as v12.

**LED control** bindings expose existing LED commands plus **Set all LEDs**, relative steps of -1 or +1,
absolute settings, configured restores, and five common brightness presets.
Relative rainbow phase and speed also offer -2 and +2 to toggle between settings
two positions apart in their four-setting cycles.
Existing profiles with larger relative LED steps remain compatible; the editor
shows their current value but only offers the steps above when changing it.
Saved layer colors/visibility and global rainbow defaults remain independent.
Runtime overrides reset on configuration save or USB reset and bypass preview.
Formats before v5 receive **Fast** speed and **60°** spacing; v5 rainbow settings survive
migration unchanged. JSON and drafts retain semantic action names as action codes shift.

## Timed Actions and Temporary LED Effects (v10)

Four timers share the profile's storage budget, at six bytes each. Intervals
use 1–2048 ticks of 4.096 seconds. **Interval** provides a full-width slider
with an approximate duration shown in hours, minutes and seconds as needed.
**Run on** selects **All layers** or a specific layer. A scoped timer advances
only on its assigned layer; actual layer transitions reset scoped intervals but
preserve armed **On next input** actions. Global timer phases continue.

**Reset timer on input** defaults to **Yes**; **Consume this input**
is disabled by default. Optional next-input actions run once after firing,
including after leaving the assigned layer. Consumption suppresses the normal
physical binding even with no next-input action. Each timer retains an independent
16ms fractional phase; early clock quantization is less than 16ms, separately
from queued-output latency and oscillator drift.

Both timer action slots accept dragged shortcuts and swap actions with keys,
encoder inputs, chords and other timers. Interval, scope and flags remain
attached to the timer. Actions requiring release are rejected on either slot.
Reordering layers remaps scopes; deleting an assigned layer preserves the timer
and both actions but requires explicit reassignment before saving.

Legacy timer ticks multiply by 32 exactly. Migration adds one byte per timer;
oversized profiles remain editable/exportable with saving blocked until the user
reduces storage. Current JSON and drafts are not scaled again.

**Set all LEDs** is a single LED-command choice with an effect selector (**As configured**,
**Always on**, **Blink**), a 1–8 blink-count slider shown only for **Blink**, and color swatches
including **Rainbow** with a **Full Brightness / Dim** control. **As configured** hides these
controls. Always-on permits pressed-key feedback; blinking covers it. Clearing or
finishing an effect does not replay the layer's blink/timed indication.
No dedicated reminder layer is required. JSON uses optional `brightness: "dim"`
for effects; omission defaults to **Bright**, preserving existing profiles.

Persistent and one-shot **Switch to layer** selectors offer **Previous layer**, represented
by `layer: 255` in v7 and later JSON and `0xFF` in the two-byte action record. The target is
preserved through layer edits, clipboard and undo; v6 profiles/drafts reject it.
**Previous layer** remembers persistent base selections, ignoring momentary/one-shot
visits. Repeating a persistent **Previous layer** action swaps between two layers.
Return-path warnings explain that this target depends on runtime history.

The protocol simulator accepts only valid v12 profiles and round-trips the new
flags/effects. It models configuration transport, not timed HID or LED playback.
Firmware hardware testing has been completed on both three-key and six-key macropads. Bundled `../profiles/*.json`
files use v7 JSON and are migrated to v12, then checked against the firmware parser in the regression suite.

## Consumer Hold and Held Scrolling (v8)

**Media / system hold** appears directly after **Media / system**. Switching
between them preserves the selected 12-bit Control. Repetition depends on the
host; the newest media action wins without restoring previous holds. Keyboard
and consumer holds retain their original binding across layers until release.

**Scroll** offers **Tap/Hold** on keys, chords and the encoder button. It repeats the
configured step when playback and transport are idle; release stops new repeats.
Repeats wait at least 100ms after the previous complete step, giving about ten
steps per second at wheel step 1. Pointer holds retain their 8ms interval.
Both hold features reject rotation and timed-action slots, including drag/drop
and clipboard operations. Preview/live-view summaries identify held scrolling
and media controls. Acceleration is not part of this merged build.

v8 writes **Type Text** with first byte `0x10`; old type-9 text is decoded according
to its source version before re-encoding. **None** remains `00 00`. Binary, JSON,
draft and raw-device migration cover every binding location, including timers.
Legacy firmware connects through its frozen editor, while old flash on v12 can
be read and migrated without being automatically overwritten.

## Mouse Clicks (v8+)

**Mouse click** offers **Single / Double / Custom**, with a 3–16 slider for **Custom**.
The last custom count is remembered per slot in local settings when switching
modes. **Custom** displays an estimated duration to one decimal, based on 8ms per
press plus 200ms between clicks. Later queued actions wait for the sequence;
held outputs, consumer controls and layer/LED actions use independent handling.
USB backpressure can lengthen playback. The optional JSON `clicks` field defaults
to one; legacy `mouseDouble` actions migrate to `mouseClick` with `clicks: 2`.
Binary type 3 stores count minus one in its auxiliary nibble; v8 rejects type 4.

## Advanced: Input Capture Diagnostic

Open `/wheel-debug.html` beneath the site's project prefix (locally,
`http://localhost:4173/wheel-debug.html` when using the preview server). Hover over
the blue area, clear the log, and use a macropad key. For held scrolling, use one
key at wheel step 1 and compare intervals against roughly 100–108ms. For
multi-click testing, select **Left** only and compare complete press/release cycles
against the configured count. Browser click/double-click notifications are logged
separately without increasing that count. The page reports press duration and
event/receipt intervals and exports CSV. It records browser events after OS
processing, so it cannot identify the device or guarantee one event per USB report.

The desktop sidebar shows arrows and inset edge shadows when more content is
available. At each endpoint, the fading shadow clips to the card's rounded corners.

## Release Firmware Status

The release HEX files and bundled uploader use v11 firmware from revision
`f87ca744`: [three-key](../releases/ch552-macropad-3-key-f87ca744.hex) and
[six-key](../releases/ch552-macropad-6-key-f87ca744.hex). Use the frozen v11 editor
with these releases. Current source/editor use v12; no v12 release has been
generated. V11 hardware testing passed on both geometries; v12 has automated
coverage and native builds but no hardware compatibility results yet.
Older-firmware connections link to the matching archive and updater. Back up
profiles, update firmware, then load/import and explicitly save in its matching
editor. V11 migration to v12 preserves actions, macros, timer units and storage.
Oversized older imports remain editable/exportable until reduced.

## Horizontal Scrolling (v9)

**Scroll axis** selects **Vertical** or **Horizontal** while preserving step and
**Tap**/**Hold** behavior. **Scroll direction** shows **Up**/**Down** or
**Left**/**Right** accordingly. Auxiliary bit 3 selects horizontal; bit 2 still
selects hold. Both axes use the same 100ms hold delay. JSON version 9 stores
optional boolean `horizontal`; older imports retain vertical scrolling.

Under **Scroll direction**, an inversion hint names the selected axis and offers
**Click here** to open **Scroll & click test**. Its test area starts centered with
room to scroll vertically and horizontally. **Click count** tracks **Left**,
**Middle** and **Right** clicks inside the area; double clicks count twice.
**Reset counts** clears all counters. Unsaved edits show a warning above the
area because the hardware continues to use its saved configuration. The modal
uses native dialog focus handling and closes with **Close** or Escape.

**Mouse click**, **Mouse hold**, **Mouse toggle**, **Mouse down** and **Mouse up** also offer **Click here** to
open **Scroll & Click Test**. Each mouse button shows **Held** or **Released**
next to its click counter, so held and toggled outputs can be checked. Releases
outside the test area are tracked; leaving the browser clears the display until
another mouse event reports its current button state.

## Macros (V11+)

**Macros** adds numbered definitions with ordered steps. Select a step to use the
common **Action editor**; move it up/down, swap/clipboard compatible actions, or
remove it. **Execute macro** selects a definition and **Repeat count** (1–16).
**Pause duration** is 0–4080ms in 16ms increments. Held actions, nested macros
and **Nothing** steps are unavailable. Layer switches (absolute, relative and
one-shot) must be the final step, even if their target is already active, and
invocations of these macros must have **Repeat count** set to 1. **Add step** and
**Add pause** remain below the steps and insert before the first layer switch,
at a labeled divider. Invalid nonfinal layer-switch steps have a red border.
The buttons are disabled only when storage is full.
Profile validation blocks saving invalid step order or repeat counts across all
binding sites, including timers and their follow-ups. JSON imports reject these
invalid configurations. Firmware behavior is unchanged: external layer changes
still cancel active macros. Deleting a macro clears its bindings and
renumbers later references; undo restores both. The live viewer lists its steps.

JSON v11 adds optional `macros: [{ actions: [...] }]`, invocation
`{ type: "macro", macro: 0, repeats: 1 }`, and pause `{ type: "pause", ticks: 16 }`.
Macro indices are zero-based. On every encode, definitions follow the shared
string pool and indices become absolute addresses. No reserved macro storage,
count or directory is needed. **Device storage** counts two bytes per step plus
one per terminator, omitting the last terminator at an exact image boundary.
Macro text is deduplicated with text in all other bindings. Definitions fit the
same shared 128 bytes as layers, chords and six-byte timers.

The decoder remaps v10 action types `0x5–0xF` to v11 `0x4–0xE` in every binding;
**Execute macro** becomes `0xF`. It retains auxiliary values and parameters.
V10 profile migration needs no additional bytes. Older text/double-click action
maps and five-byte timers still migrate according to their source version.
V11 drafts recover older drafts without modifying their namespaces. Oversized
imports remain editable/exportable and saving is blocked until repaired.

One macro streams from the active image; its invocation consumes one event slot.
Long sequences delay later queued output. Overflow drops complete invocations,
never a partial expansion. Physical/timer immediate actions can interleave;
effective layer changes, configuration application and USB reset cancel playback.
All **Mouse toggle** actions share one global button state across physical inputs,
chords, timers and macros. Any toggle can undo another toggle for the same button;
held actions retain their physical ownership. Layer-route analysis follows steps
until cancellation.
See [the complete v12 reference](../protocol/config-v12.md) and
[implementation and optimization notes](../protocol/macros-implementation.md).

## Mouse Buttons and Persistent Actions (V12)

All mouse actions support masks 1–255, covering **Left**, **Right**, **Middle**
and **Button 4** through **Button 8**. **Mouse down** (`mouseDown`) sets selected
persistent bits; **Mouse up** (`mouseUp`) clears them; both share the global
**Mouse toggle** state. Repeated down/up is idempotent. Physical holds and clicks
remain independent, and macro completion leaves persistent state intact.
Layer changes and resets clear it. Down/up are valid macro steps, rotation
bindings and timer actions without additional record bytes.

The editor exports JSON v12 and stores drafts under `format-v12:`. Binary v11,
JSON v11 and v11 drafts migrate without altering macros, repeats, pauses, timer
units or storage. Older inputs reject v12-only modes and larger button masks.
The binary codec and firmware parser are compared in regression tests.

The test panel observes browser events, using explicit DOM event-to-button
mapping. Side buttons may be intercepted, and buttons 6–8 may not appear even
when another application supports them. The eight-button HID descriptor packs
the two scroll axes into separate signed nibbles without changing report size.
