# Universal Macropad Configurator

Browser-based editor for the CH552 Universal Macropad. It talks to the device over
WebHID, edits the 128-byte configuration image defined in `protocol/config-v7.md`,
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

## Trying It without Hardware

The current editor waits for **Connect macropad** before opening hardware, even if
the browser has previously granted access. Firmware-version notices only appear
after an explicit connection attempt.

The connect button's dropdown offers a simulated macropad that implements the same
protocol handler as the firmware, including invalid-flash and failed-commit paths.
`?sim=six`, `?sim=three`, or `?sim=blank` in the URL auto-connects the simulator,
which is useful for demo links and screenshots. "Edit offline" on the welcome
screen edits a profile for either variant without any device.

## Live View

Open `/liveView` (or `liveView/` beneath the deployed site's project prefix)
to keep a compact shortcut reference beside your work. The configurator's
**Live View** link opens it in another tab. Connect the macropad in the viewer
to read its saved profile; editor drafts are neither restored nor cleared.

The viewer shows the same macropad preview, layer tabs, applicable local/global
chords, and compact timed-action summaries. It has no editing, saving, drag/drop,
or configuration clipboard shortcuts. Device status is polled every 500 ms.
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
   them byte for byte before showing "Saved". A lost commit reply is tolerated because
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

The active format 7 editor is served at the project site's root. Frozen
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

The footer links to the archive list. Detecting format 2, 3, 4, 5 or 6 firmware presents a
persistent link to its archived editor and closes the connection without reading
or writing profiles. The active editor has one firmware encoder and one set of
indicator controls. [Archive provenance and rebuild instructions](archives/README.md)
record the minimal hosting adjustments to the v2 build.

Each editor writes to a separate `universal-macropad:format-vN:` draft namespace.
The active editor can still recover/migrate drafts under the former shared key,
and can recover v2/v3/v4/v5/v6 drafts without overwriting or clearing the archived namespace.

Version 2/3/4/5/6 binary profiles, version 1–6 JSON files, and older drafts can still be
migrated into the active format 7 editor after a firmware upgrade. Bindings and
colors are preserved; Blink once becomes the timed indication and transparency
defaults to off. Rainbow phase spacing defaults to 60° on both variants. Firmware does not migrate flash itself: save the migrated profile
through the active editor to store v7. Existing v6 profiles continue running before migration.

LED control bindings expose existing LED commands plus Set all LEDs, relative steps of -1 or +1,
absolute settings, configured restores, and five common brightness presets.
Relative rainbow phase and speed also offer -2 and +2 to toggle between settings
two positions apart in their four-setting cycles.
Existing profiles with larger relative LED steps remain compatible; the editor
shows their current value but only offers the steps above when changing it.
Saved layer colors/visibility and global rainbow defaults remain independent.
Runtime overrides reset on configuration save or USB reset and bypass preview.
Formats before v5 receive Fast speed and 60° spacing; v5 rainbow settings survive
migration unchanged. JSON and drafts retain semantic action names as action codes shift.

## Timed Actions and Temporary LED Effects (v7)

Four timers share the profile's storage budget, at five bytes each. Intervals
are clamped to 1–64 ticks of 131.072 seconds. The editor displays “131 seconds”,
whole-minute/second durations, and a first-firing range on hover. Restart on input
is enabled by default; consume wake input is disabled by default. Optional
next-input actions run once after firing; consuming suppresses the physical
binding even with no next-input action. Held actions cannot be assigned to timers.

Interval editing uses a full-width 1–64 slider. Both timer action slots accept
dragged shortcuts and swap actions with keys, encoder inputs, chords and other
timers; timer interval/flags and per-key LED colors stay attached to their inputs.
Actions requiring a release are rejected on either timer slot.

Set all LEDs is a single LED-command choice with an effect selector (As configured,
Always on, Blink), a 1–8 blink-count slider shown only for Blink, and color swatches
including Rainbow with a Full Brightness / Dim control. As configured hides these
controls. Always-on permits pressed-key feedback; blinking covers it. Clearing or
finishing an effect does not replay the layer's blink/timed indication.
No dedicated reminder layer is required. JSON uses optional `brightness: "dim"`
for effects; omission defaults to Bright, preserving existing profiles.

Persistent and one-shot Switch to layer selectors offer Previous layer, represented
by `layer: 255` in v7 JSON and `0xFF` in the two-byte action record. The target is
preserved through layer edits, clipboard and undo; v6 profiles/drafts reject it.
Previous layer remembers persistent base selections, ignoring momentary/one-shot
visits. Repeating a persistent Previous layer action swaps between two layers.
Return-path warnings explain that this target depends on runtime history.

The protocol simulator accepts valid v6 and v7 profiles and round-trips the new
flags/effects. It models configuration transport, not timed HID or LED playback.
Hardware testing remains necessary for those effects. Bundled `../profiles/*.json`
files use v7 and are checked against the firmware parser in the regression suite.
