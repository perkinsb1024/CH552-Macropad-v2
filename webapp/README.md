# Universal Macropad Configurator

Browser-based editor for the CH552 **Universal Macropad**. It talks to the device over
WebHID, edits the 128-byte configuration image defined in `protocol/config-v18.md`,
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
npm run verify:deploy # full local and CI deployment gate
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
then try **Connect Macropad** again. A sandboxed browser package may also need
its device permissions adjusted. These permissions apply to the running firmware;
see the [installer's Linux setup](../webUploader/README.md#linux) for bootloader access.

## Trying It without Hardware

The current editor waits for **Connect Macropad** before opening hardware, even if
the browser has previously granted access. Firmware-version notices only appear
after an explicit connection attempt.

The connect button's dropdown offers a simulated macropad that implements the same
protocol handler as the firmware, including invalid-flash and failed-commit paths.
`?sim=six`, `?sim=three`, or `?sim=blank` in the URL auto-connects the simulator,
which is useful for demo links and screenshots. "**Edit Offline**" on the welcome
screen edits a profile for either variant without any device.

## Live View

Open `/liveView` (or `liveView/` beneath the deployed site's project prefix)
to keep a compact shortcut reference beside your work. The configurator's
**Live View** link opens it in another tab. Connect the macropad in the viewer
to read its saved profile; editor drafts are neither restored nor cleared.

The viewer shows the macropad preview, layer tabs, applicable local/global
chords, macro steps and timed-action summaries. It has no editing, saving,
drag/drop or configuration clipboard shortcuts. It reads the saved device
profile independently of unsaved configurator edits.

With v18 firmware:

- Blue outlines show debounced physical keys, encoder-button holds and completed
  clockwise/counterclockwise detents, including consumed wake inputs.
- Green flashes show accepted bindings, including short taps between polls and
  both keys of a chord. Feedback lasts about 180ms. **Latest Binding** identifies
  the source, action and effective layer at dispatch. Several bindings between
  polls show an update count and only the latest action.
- **Auto-Sleep** distinguishes **Disabled**, **Asleep** and an awake countdown.
  **Brightness**, **LED Effect** and **Rainbow** show runtime policies, temporary
  effects or color preview, remaining blink phases and rainbow settings. They
  do not stream actual rendered LED colors.
- **Layer State** shows base/previous layers, armed one-shot return and a key
  waiting for a chord. **Playback** shows action/macro activity and the binding
  queue depth. **Latched Mouse Buttons** and **Dropped Actions** appear when nonzero.
- **Timed Actions** show remaining time, **Paused Outside Its Layer**, and armed
  next-input actions with consumption state. All five user timer slots remain
  available; telemetry consumes no saved-profile bytes or timer slots.

Visible telemetry viewers schedule status polls 50ms after the previous poll
completes, reading runtime state after each status reply. Timer reads occur
when at least 250ms has elapsed since the previous timer sample, or immediately
after an application/reset generation change. Requests run serially and pause
during that page's saves. Hidden pages use 500ms status polling and
suspend runtime/timer reads; the ordinary configurator retains 500ms polling.
Slow requests and background browser scheduling can increase these intervals.
A separate 100ms UI clock expires feedback during stalled requests. Samples
older than one second suppress live highlights and show stale-state messages.
Profile CRC changes reload saved settings; reset-generation changes clear old
activity. Polling does not restart inactivity timers or prevent sleep.

An accepted binding means dispatch or queue acceptance, not completed output or
host receipt. Physical wake can occur without its binding firing. The display
is not an event log: counters wrap modulo 256, a burst of exactly 256 unseen
events can be missed, and a short consumed press/release can fall between physical
bitmap samples. Gaps longer than one second establish a new baseline rather than
replaying activity. Runtime and timer replies are separate snapshots; countdowns
also inherit 16ms timer quantization, polling delay and clock error. Persistent
mouse latches do not include every physical hold or temporary click.

Manual layer selection shows a persistent warning when it differs from the active
device layer and suppresses live outlines on that inactive layer. Ordinary polls
preserve that selection; the next reported device layer change selects the device
layer again. **Follow Device** also resynchronizes immediately. On disconnect,
the last loaded profile remains available with a disconnected notice.
Blank/invalid profiles do not display starter bindings or live activity.

The active viewer connects to v18 firmware. Published v17 devices use the frozen
v17 editor/viewer with telemetry. V16 and earlier devices use their matching
archives; the v16 viewer provides the saved-profile/layer reference without telemetry. Within a supported connection, six-byte `GET_STATUS` replies
retain that basic view and skip runtime requests; 23 bytes advertise telemetry.
New reads are `GET_LIVE` (11) and `GET_TIMERS` (12), over transport version 1.
See the [complete wire reference](../protocol/config-v18.md#live-view-telemetry).

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
`.github/workflows/deploy-pages.yml` runs `npm run verify:deploy` on every pull
request to `main` and every merge-queue candidate. It builds, tests, and publishes
`webapp/dist` when deployment inputs are pushed to `main`, or when run manually
on `main`. Inputs include the root README's release notes, web app/uploader,
release files and firmware/test dependencies. Pull-request checks have no path
filter and do not publish Pages artifacts or deploy. In the repository's
**Settings → Pages**, the publishing source must be **GitHub Actions**. Existing
Pages deployments using this workflow need no additional website configuration,
custom domain, or deployment environment for archives.

Run `npm run verify:deploy` after the final edits before publishing. The command
runs configurator tests, rebuilds and tests the standalone uploader, then builds
the complete site and verifies archives. Direct pushes to `main` are supported;
pull requests and repository protection are optional, as described in the
[release process](../documentation/Firmware%20Release%20Process.md#publish-after-validation).

The active format 18 editor is served at the project site's root. Frozen
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
- `versions/format-v12/` serves the frozen v12 editor and live view from finalized outgoing source `3d23690`.
- `versions/format-v11/` serves the frozen v11 editor and live view from the finalized v11 release.
- `versions/format-v10/` serves the frozen v10 editor and live view built before v11 changes.
- `versions/format-v9/` serves the frozen v9 editor and live view built before the v10 changes.
- `versions/format-v17/` serves the finalized outgoing v17 editor and Live View from `38724fb`, including runtime telemetry.
- `versions/format-v16/` serves the finalized published v16 editor and live view from `51db5e6`, without runtime telemetry.
- `versions/format-v15/` serves the finalized v15 release editor and live view from `8c150a0`.
- `versions/format-v14/` serves the frozen outgoing v14 editor and live view from `0fb6132`.
- `versions/format-v13/` serves the frozen published v13 editor and live view.
- `versions/format-v7/` serves the frozen v7 editor and live view from commit `196e81e`.

The footer links to the archive list. Detecting format 2–17 firmware presents a
persistent link to its archived editor and closes the connection without reading
or writing profiles. The active editor has one firmware encoder and one set of
indicator controls. [Archive provenance and rebuild instructions](archives/README.md)
record the minimal hosting adjustments to the v2 build.

Each editor writes to a separate `universal-macropad:format-vN:` draft namespace.
The active editor can still recover/migrate drafts under the former shared key,
and can recover v2/v3/v4/v5/v6/v7/v8/v9/v10/v11/v12/v13/v14/v15/v16/v17 drafts without overwriting or clearing the archived namespace.

Version 2–17 binary profiles, version 1–17 JSON files, and older drafts can still be
migrated into the active format 18 editor after a firmware upgrade. Bindings and
colors retain their meanings, with **Teal** replaced by **Cyan**; **Blink Once** becomes the timed indication and transparency
defaults to off. **Rainbow Phase Spacing** defaults to **60°** on both variants. Firmware does not migrate flash itself: save the migrated profile
through the active editor to store v18. Older stored profiles remain readable but inactive until saved as v18.

**LED Control** bindings expose existing LED commands plus **Set All LEDs**, relative steps of -1 or +1,
absolute settings, configured restores, and five common brightness presets.
Relative rainbow phase and speed also offer -2 and +2 to toggle between settings
two positions apart in their four-setting cycles.
Existing profiles with larger relative LED steps remain compatible; the editor
shows their current value but only offers the steps above when changing it.
Saved layer colors/visibility and global rainbow defaults remain independent.
**Set All LEDs** with **Rainbow** follows runtime phase and speed overrides.
Runtime overrides reset on configuration save or USB reset and bypass preview.
Formats before v5 receive **Fast** speed and **60°** spacing; v5 rainbow settings survive
migration unchanged. JSON and drafts retain semantic action names as action codes shift.

## Timed Actions and Temporary LED Effects (v10)

Four timers share the profile's storage budget, at six bytes each. Intervals
use 1–2048 ticks of 4.096 seconds. **Interval** provides a full-width slider
with an approximate duration shown in hours, minutes and seconds as needed.
**Run On** selects **All Layers** or a specific layer. A scoped timer advances
only on its assigned layer; actual layer transitions reset scoped intervals but
preserve armed **On Next Input** actions. Global timer phases continue.

**Reset Timer on Input** defaults to **Yes**; **Consume This Input**
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

**Set All LEDs** is a single LED-command choice with an effect selector (**As Configured**,
**Always On**, **Blink**), a 1–8 blink-count slider shown only for **Blink**, and color swatches
including **Rainbow** with a **Full Brightness / Dim** control. **As Configured** hides these
controls. Always-on permits pressed-key feedback; blinking covers it. Clearing or
finishing an effect does not replay the layer's blink/timed indication.
No dedicated reminder layer is required. JSON uses optional `brightness: "dim"`
for effects; omission defaults to **Bright**, preserving existing profiles.

Persistent and one-shot **Switch to Layer** selectors offer **Previous Layer**, represented
by `layer: 255` in v7 and later JSON and `0xFF` in the two-byte action record. The target is
preserved through layer edits, clipboard and undo; v6 profiles/drafts reject it.
**Previous Layer** remembers persistent base selections, ignoring momentary/one-shot
visits. Repeating a persistent **Previous Layer** action swaps between two layers.
Return-path warnings explain that this target depends on runtime history.

The protocol simulator accepts only valid v18 profiles and round-trips the new
flags/effects. It models configuration transport, not timed HID or LED playback.
Previous released firmware has been hardware tested on both geometries; see
**Release Firmware Status** for published v16 coverage. Bundled `../profiles/*.json`
maximum-capacity starter files use v15 JSON (migrated on import) and are checked against the firmware parser in the regression suite.

## Consumer Hold and Held Scrolling (v8)

**Media / System Hold** appears directly after **Media / System**. Switching
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
Legacy firmware connects through its frozen editor, while old flash on v18 can
be read and migrated without being automatically overwritten.

## Mouse Clicks (v8+)

**Mouse Click** offers **Single / Double / Custom**, with a 3–16 slider for **Custom**.
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

The active editor and firmware source target v18, with five **Timed Actions**,
compact global chord identifiers and six-slot live timer telemetry. The normal
firmware builds and host regressions pass for both hardware variants. V18
hardware validation and release generation have not been requested.

The release HEX files and bundled uploader remain on hardware-validated v17
from revision `64fa750c`:
[three-key](../releases/ch552-macropad-3-key-64fa750c.hex) and
[six-key](../releases/ch552-macropad-6-key-64fa750c.hex). Use the
[frozen v17 editor](https://perkinsb1024.github.io/CH552-Macropad-v2/versions/format-v17/)
with those files. The active editor routes older firmware to its matching archive.

Back up profiles before updating firmware. V18 firmware leaves old DataFlash
readable but inactive until **Save to Device** explicitly writes a v18 profile.
Migration converts global chord identifiers while preserving bindings, timers,
macros, palettes and sleep settings. JSON v17 and board drafts retain local
metadata and inactive palettes; original draft namespaces remain unchanged.
Global chords have no binary storage-layer index in v18 and read back with
semantic layer 0. Their scope remains global. Oversized older imports remain
editable/exportable until reduced.

## Horizontal Scrolling (v9)

**Scroll Axis** selects **Vertical** or **Horizontal** while preserving step and
**Tap**/**Hold** behavior. **Scroll Direction** shows **Up**/**Down** or
**Left**/**Right** accordingly. Auxiliary bit 3 selects horizontal; bit 2 still
selects hold. Both axes use the same 100ms hold delay. JSON version 9 stores
optional boolean `horizontal`; older imports retain vertical scrolling.

Under **Scroll Direction**, an inversion hint names the selected axis and offers
**Click Here** to open **Scroll & Click Test**. Its test area starts centered with
room to scroll vertically and horizontally. **Click Count** tracks **Left**,
**Middle** and **Right** clicks inside the area; double clicks count twice.
**Reset Counts** clears all counters. Unsaved edits show a warning above the
area because the hardware continues to use its saved configuration. The modal
uses native dialog focus handling and closes with **Close** or Escape.

**Mouse Click**, **Mouse Hold**, **Mouse Toggle**, **Mouse Down** and **Mouse Up** also offer **Click Here** to
open **Scroll & Click Test**. Each mouse button shows **Held** or **Released**
next to its click counter, so held and toggled outputs can be checked. Releases
outside the test area are tracked; leaving the browser clears the display until
another mouse event reports its current button state.

## Macros (V11+)

**Macros** adds numbered definitions with ordered steps. Select a step to use the
common **Action Editor**; move it up/down, swap/clipboard compatible actions, or
remove it. **Execute Macro** selects a definition and **Repeat Count** (1–16).
**Pause Duration** is 0–4080ms in 16ms increments. Held actions, nested macros
and **Nothing** steps are unavailable. Layer switches (absolute, relative and
one-shot) must be the final step, even if their target is already active, and
invocations of these macros must have **Repeat Count** set to 1. **Add Step** and
**Add Pause** remain below the steps and insert before the first layer switch,
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
count or directory is needed. **Device Storage** counts two bytes per step plus
one per terminator, omitting the last terminator at an exact image boundary.
Macro text is deduplicated with text in all other bindings. Definitions fit the
same shared 128 bytes as layers, chords and six-byte timers.

The decoder remaps v10 action types `0x5–0xF` to v11 `0x4–0xE` in every binding;
**Execute Macro** becomes `0xF`. It retains auxiliary values and parameters.
V10 profile migration needs no additional bytes. Older text/double-click action
maps and five-byte timers still migrate according to their source version.
V11 drafts recover older drafts without modifying their namespaces. Oversized
imports remain editable/exportable and saving is blocked until repaired.

One macro streams from the active image; its invocation consumes one event slot.
Long sequences delay later queued output. Overflow drops complete invocations,
never a partial expansion. Physical/timer immediate actions can interleave;
effective layer changes, configuration application and USB reset cancel playback.
All **Mouse Toggle** actions share one global button state across physical inputs,
chords, timers and macros. Any toggle can undo another toggle for the same button;
held actions retain their physical ownership. Layer-route analysis follows steps
until cancellation.
See [the complete v18 reference](../protocol/config-v18.md) and
[implementation and optimization notes](../protocol/macros-implementation.md).

## Mouse Buttons and Persistent Actions (V12)

All mouse actions support masks 1–255, covering **Left**, **Right**, **Middle**
and **Button 4** through **Button 8**. **Mouse Down** (`mouseDown`) sets selected
persistent bits; **Mouse Up** (`mouseUp`) clears them; both share the global
**Mouse Toggle** state. Repeated down/up is idempotent. Physical holds and clicks
remain independent, and macro completion leaves persistent state intact.
Layer changes and resets clear it. Down/up are valid macro steps, rotation
bindings and timer actions without additional record bytes.

The frozen v12 editor exports JSON v12 and stores drafts under `format-v12:`. Binary v11,
JSON v11 and v11 drafts migrate without altering macros, repeats, pauses, timer
units or storage. Older inputs reject v12-only modes and larger button masks.
The binary codec and firmware parser are compared in regression tests.

The test panel observes browser events, using explicit DOM event-to-button
mapping. Side buttons may be intercepted, and buttons 6–8 may not appear even
when another application supports them. The eight-button HID descriptor packs
the two scroll axes into separate signed nibbles without changing report size.

## Consumer Modifiers and Pointer Movement (V13)

The frozen v13 editor exports JSON v13 and stores drafts under `format-v13:`.
Older binary, JSON and draft profiles migrate into v13 without changing their
named action behavior. Old **Mouse Hold** records move to auxiliary mode 3 of
the shared mouse action; legacy pointer steps become signed single-axis deltas.

**Media / System** taps expose **Ctrl**, **Shift**, **Alt** and **GUI** modifiers
for eight-bit usages. Twelve-bit unmodified taps and holds remain available;
modified usages above `0xFF` are rejected. The active v18 editor also supports
modified holds. Firmware drains
the keyboard modifier report before the consumer press, then drains the
consumer release before removing temporary modifiers.

**Move Mouse** offers **X**, **Y** and **Both** axes. Single-axis amounts are
1–127; **Both** stores independent magnitudes 4–64 in steps of 4 and independent
signs in one two-byte action. Buttons and chords support **Tap** and **Hold**;
rotation, timers and macro steps use taps. Each combined axis must be nonzero. Codec/firmware agreement and editor migration are covered
by regression tests. USB product names are **3-Key Macropad** and **6-Key Macropad**.

## Action Ordering and Holds (V14)

The active editor exports JSON v18, writes binary format 18 and stores local
profiles under `format-v18:board:`. JSON and drafts use `headerMarker: "B"`,
while binary images use marker `0x42`, version byte 1 and CRC bytes 7–8. Its codec uses the reordered types in
[the complete format reference](../protocol/config-v18.md), including swapped
**Pause**/**Type Text** records and the shared layer action modes. Migration
decodes every binding, both timer fields and every macro step using the source
version, then re-encodes and computes the CRC. Authentic finalized v13 binary
fixtures cover both hardware variants; legacy regression tests cover earlier
formats. JSON actions retain their named meanings and metadata. Archived drafts
remain unchanged, and device flash changes only after **Save to Device**.

**Media / System Hold with Modifiers** holds an eight-bit control together with
**Ctrl**, **Shift**, **Alt** or **GUI** until physical release. Switching between
modified taps and holds preserves the usage and modifier mask. **Relative layer
while held** resolves its signed offset from the selected base layer at press
time and keeps that target until release. Both work on keys, encoder presses and
chords; rotation, both timer fields and macro steps reject them. Layer route
analysis includes relative holds.

The finalized v13 editor and live view are frozen at `public/versions/format-v13/`
with source provenance and checksums. Published v13 firmware connects through
that editor; the shared uploader offers v13 as a previous release and v17 as the latest release.

## Auto-Sleep (v15 and Later)

**Layer Options** includes **Auto-Sleep**, disabled by default. **Profile Settings**
provides **On**, **Per Layer** and **Off**. Switching to **On** or **Off** retains
the current session's per-layer choices; **Per Layer** restores them. Undo/redo
includes the remembered choices, which follow layers through moves and removals.
Loading, importing or resetting a profile starts fresh editor memory. Saving
writes the active flags, with no extra device storage.

Four settings are shared by enabled layers: **Sleep Timeout** (**15 Minutes**, **30 Minutes**, **1 Hour**, **2 Hours**),
**Consume Wake Input**, **Show Layer Indicator**, and **Dim Instead of Off**.
Defaults are 30 minutes, consume enabled, reminder enabled and dim disabled.
Sleep selects **Both Off** or **Layers and Keys Dim**, using existing dim
brightness. Format 16 firmware remembers both brightness policies on the first
sleep timeout and restores them before any unconsumed wake binding. This includes
manual overrides, mixed policies and **As Configured**. Repeated timeouts retain
the original selection; timer or macro LED commands do not end sleep or replace
it. Profile application and USB reset clear it and restore configured brightness.
Published v15 firmware restores **Both as Configured** on wake.
Brightness preservation is automatic with the updated format 16 firmware; it
requires no new setting or profile conversion. For example, **Layers and Keys Dim**
selected before sleep is restored even when sleep turns the LEDs off.
Dimming preserves configured indicator behavior; it does not force lighting on.

Switching between enabled layers preserves elapsed sleep time. Entering a layer
with **Auto-Sleep** disabled clears the timer and pending wake state, restoring
awake lighting if asleep. Returning to an enabled layer starts a full timeout.
Unbound presses and complete encoder turns count as activity; releases, holds,
partial turns and USB traffic do not. A consumed wake and its release preserve
an armed one-shot layer. With consumption disabled, the same input executes
normally. A consuming user timer can still consume it. The optional reminder
restarts **On for 1.5 Seconds** or **Blink by Layer Number**; **Always On** and
**Do Not Indicate** retain their behavior. Explicit layer selections still
indicate when the wake reminder is disabled.

Enablement uses layer bit 1; profile settings use header byte 6 bits 0–4.
No profile bytes or user timer slots are added. JSON v18 and drafts preserve
`sleepTimeoutMinutes`, `consumeWakeInput`, `showLayerIndicatorOnWake` and
`dimInsteadOfOff`, as well as `autoSleep` per layer. Missing fields in older
JSON/drafts use the defaults above. Binary v2–v14, JSON v1–v14 and older drafts
migrate with **Auto-Sleep** disabled, clearing the ignored legacy layer bit.
The editor validates all settings, supports comparisons and undo/redo, and shows
the saved timeout and wake policies in live view.

The frozen v14 editor/live view is in `public/versions/format-v14/`, built from
outgoing source `0fb6132` with 663 passing tests. Its manifest records provenance
and file checksums. Published v14 firmware routes there; the shared uploader
bundles v17 as the latest release and preserves v16 and earlier releases under **Previous Release**.


## Header and Chord Window

The active v18 editor keeps the nine-byte header and 119-byte payload. It packs
the saved timer count into byte 4 bits 0–2, chords into bits 3–7, the shifted
pool length into byte 3, and window/transparency/rainbow settings into byte 5.
Byte 6 stores **Sleep Timeout** in bits 0–1, **Consume Wake Input** in bit 2,
**Show Layer Indicator** in bit 3 and **Dim Instead of Off** in bit 4; bits 5–7
remain reserved and must be zero.
Record sizes and per-layer **Auto-Sleep** remain unchanged; v18 raises the user timer limit to five.

**Chord Window** offers 20ms–90ms in 10ms steps, defaulting to 40ms. With no
chords, input is immediate. Importers recognize legacy `MP` before reading its
version at byte 2 and verify its source CRC at bytes 6–7 before conversion.
Legacy windows round to the nearest supported 10ms value, with ties upward
and clamping to the supported range; changed values show a migration notice.
Saved chords with an old zero window retain their bindings and require an
explicit window selection before encoding or saving. They remain exportable
as JSON and recoverable as drafts while awaiting that selection.

Earlier v17, v16 and v15 draft keys remain unchanged; recovered profiles use
`universal-macropad:format-v18:board:draft:six-key` or corresponding three-key
key on subsequent persistence. The editor retains 5ms units internally for
profile comparisons and old-draft interpretation; only even values 4–18 are
valid device settings. Zero is an editor-only unresolved migration state.


## Per-Key Layer Colors (v16)

The active editor writes format 18 and palette version 4. **Layer Indicator
Color** starts with **Per-Key Colors** and ends with **Rainbow**. Selecting
**Per-Key Colors** initializes each idle color from the current uniform color;
subsequent selections restore the retained palette. Select a numbered key to edit
**LED Idle Color** above **LED Color on Key Press**. Uniform mode hides the idle
palette. Both actual color palettes start with **Off** and end with **Rainbow**;
**Teal** is removed. All idle colors share **Layer Indicator Mode** and brightness,
including timed and blinking indications. The visualization blends idle colors
in physical perimeter order and includes a local rainbow for each rainbow key.
Key-press strips support rainbow too. Profile rainbow controls appear whenever
an active layer, idle, key-press or temporary-effect color uses rainbow.

For idle colors, **Apply to Layer** selects the corresponding uniform color and
reclaims palette storage. **Off** instead sets all idle colors to black and keeps
per-key mode. A non-blocking sidebar warning identifies uniform non-black
palettes, including rainbow, and their reclaimable bytes. **Device Storage**
counts only active palettes: 3 bytes per six-key layer or 2 per three-key layer.
Storage segments, including free space, expose compact hover/focus/tap flyouts.

The optional layer field `idleLeds` contains one palette index per physical key.
It is required when `indicatorColor` is zero. Drafts preserve active and inactive
palettes; JSON v18 exports the array as color names and imports names, hex values
or indices. Uniform layers retain their inactive array locally but encode no
palette bytes. Device reads recover only active palettes. Retained palettes
survive uploads through a browser draft, and JSON backups preserve them across
browsers. Resetting a profile or explicitly loading the device profile replaces
local editor data.

Migration validates/decodes the source before converting color semantics. Old
solid indices 0–6 become 1–7, **Teal** becomes **Cyan**, old key-press **Off** becomes
zero and layer/effect **Rainbow** remains 15. Effects in bindings, chords, both
timer fields and macro steps receive the same mapping; brightness values and
policies remain unchanged. Older layers remain uniform without extra bytes.


Key reordering and duplication include retained idle colors. Key-to-key swaps
carry both idle and pressed colors. The action clipboard uses version 2 to
identify the new palette semantics and optionally includes `idleLed`; pasting
preserves the destination layer's uniform/per-key mode. Version 1 clipboard data
is color-migrated before use.


## Format 18 Timers and Chords

The configurator supports up to five **Timed Actions**, subject to the shared
128-byte profile capacity. Each timer still occupies six bytes. **Auto-Sleep**
uses a separate runtime slot. The timer reply has six age bytes, six high/pending
bytes, six fractional bytes and the two-byte active profile CRC, for 20 bytes.
The immediate macro telemetry source is `0x8F`; the sleep source follows the
configured user timers and reaches `0x8E` when all five are present.

Global chords use scope 7 in identifier bits 4–6; local chords use zero-based
layer indices 0–6. Bit 7 is reserved and must be zero. Writers sort global chords
by key pair after all local chords, so local bindings retain precedence. V17
binary migration decodes the old global flag and re-encodes the new identifier;
merely changing its version byte is insufficient when global chords exist.
