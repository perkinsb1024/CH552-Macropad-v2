# Universal Macropad Configurator

Browser-based editor for the CH552 Universal Macropad. It talks to the device over
WebHID, edits the 128-byte configuration image defined in `protocol/config-v6.md`,
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

## Trying it without hardware

The current editor waits for **Connect macropad** before opening hardware, even if
the browser has previously granted access. Firmware-version notices only appear
after an explicit connection attempt.

The connect button's dropdown offers a simulated macropad that implements the same
protocol handler as the firmware, including invalid-flash and failed-commit paths.
`?sim=six`, `?sim=three`, or `?sim=blank` in the URL auto-connects the simulator,
which is useful for demo links and screenshots. "Edit offline" on the welcome
screen edits a profile for either variant without any device.

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

## How saving works

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

The active format 6 editor is served at the project site's root. Frozen
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

The footer links to the archive list. Detecting format 2, 3, 4 or 5 firmware presents a
persistent link to its archived editor and closes the connection without reading
or writing profiles. The active editor has one firmware encoder and one set of
indicator controls. [Archive provenance and rebuild instructions](archives/README.md)
record the minimal hosting adjustments to the v2 build.

Each editor writes to a separate `universal-macropad:format-vN:` draft namespace.
The active editor can still recover/migrate drafts under the former shared key,
and can recover v2/v3/v4/v5 drafts without overwriting or clearing the archived namespace.

Version 2/3/4/5 binary profiles, version 1–5 JSON files, and older drafts can still be
migrated into the active format 6 editor after a firmware upgrade. Bindings and
colors are preserved; Blink once becomes the timed indication and transparency
defaults to off. Rainbow phase spacing defaults to 60° on both variants. Firmware does not migrate flash itself: save the migrated profile
through the active editor to activate inputs after upgrading.

LED control bindings expose all thirteen commands, signed relative steps -7..+7,
absolute settings, configured restores, and five common brightness presets.
Saved layer colors/visibility and global rainbow defaults remain independent.
Runtime overrides reset on configuration save or USB reset and bypass preview.
Formats before v5 receive Fast speed and 60° spacing; v5 rainbow settings survive
migration unchanged. JSON and drafts retain semantic action names as action codes shift.
