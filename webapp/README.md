# Universal Macropad Configurator

Browser-based editor for the CH552 Universal Macropad. It talks to the device over
WebHID, edits the 128-byte configuration image defined in `protocol/config-v3.md`,
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
`.github/workflows/deploy-pages.yml` builds, tests, and publishes `webapp/dist`;
move it to the repository's `.github/workflows/` directory and enable Pages with the
"GitHub Actions" source.

## Linux device access

Add a udev rule so the browser can open the HID interface, then replug:

```
KERNEL=="hidraw*", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="c55d", MODE="0666"
```

The editor upgrades version 2 binary profiles, version 1/2 JSON profiles, and older
local drafts to format 3. Blink once becomes the 1.5-second timed indication;
transparency defaults to off. Upgrades stay in the editor until saved. The editor reads and saves both
format 2 and format 3 firmware, selecting the connected device’s format.
On format 2 devices it shows Blink once and the original blink timing;
transparency must be off before saving. Existing bindings, colors, and metadata are retained.
