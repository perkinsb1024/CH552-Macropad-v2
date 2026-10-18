# Frozen Configurators

`../public/versions/format-v2/` is the production build of `webapp/` from
commit `417f276fda788f71dfcd38d781ddc67306988739`, with the small hosting patch
in `format-v2.patch`. The patch adds a version banner, a link back to the latest
editor, and a separate `universal-macropad:format-v2:` draft namespace. Firmware,
encoding, and LED behavior are unchanged. All 99 tests at that commit passed.

The snapshot was built with Node 20.16.0 and the commit's unchanged dependency
lockfile. Its `archive.json` records the source revision, adjustments, and SHA-256
hashes of every built file, including source maps. The active build copies these
files through Vite's public directory and verifies the copied hashes before a
Pages deployment can proceed. Old dependencies are not rebuilt during deployment.

To rebuild deliberately, extract `webapp/` with `git archive` from the recorded
commit into a temporary directory, apply `format-v2.patch` at the extraction
root, then run `npm ci`, `npm test`, and `npm run build` in its `webapp/` directory.
Replace the snapshot and regenerate its manifest hashes only after reviewing
the resulting changes. Keep archives immutable during ordinary development.

To archive a future configuration format, preserve a tested production build in
another `public/versions/format-vN/` directory with its provenance and checksum
manifest. Give it a separate draft namespace, add it to `public/versions/index.html`,
and add its URL to the active editor's `ARCHIVED_CONFIGURATORS` lookup in `ui/store.ts`.
Do not add older-firmware encoding or UI branches to the active editor.

The root serves the active v18 editor. `../public/versions/format-v3/` preserves the production build of the source revision (recorded in `archive.json`), with a banner and link to the latest editor added to its HTML. Its existing v3 draft namespace is preserved.

`npm run dev` also serves these frozen HTML pages directly. The archive middleware
bypasses the active editor's HTML transformation and SPA fallback, so development
archive URLs behave like the deployed static site. Unknown archive paths return 404.

`../public/versions/format-v4/` preserves the tested format 4 production build
from the revision in its manifest (178 tests passed), with an HTML archive banner
and link to the latest editor. Its existing v4 draft namespace is preserved.

`../public/versions/format-v5/` preserves the production build made before v6
source edits from commit `3fda45b8482b0004aa9084e7ee03010b6e72d5cf`. An HTML banner
and latest-editor link were added; its existing v5 draft namespace is preserved.
The production build and v6 archive checksum/serving tests passed.

`../public/versions/format-v6/` preserves the v6 editor from commit `38d4786`,
including its v6 draft namespace, with an HTML banner and latest-editor link.
TypeScript, the Vite editor build, and all 234 tests passed at that revision.
Only the editor assets are archived; uploader generation is unrelated.

`../public/versions/format-v7/` preserves the v7 editor and live view from commit
`196e81e3db64596a9728ac2c2394f4ef03655b05`, including its v7 draft namespace.
All 324 source-revision tests, TypeScript checking and the Vite build passed.
The only hosting adjustment is an HTML banner/link on both entry points.
Assets/source maps, favicon and both HTML pages are covered by the manifest.
The snapshot was extracted into a temporary tree and built using the installed
dependencies matching its unchanged lockfile; no firmware/uploader release was generated.

The frozen v8 editor and live view are in `../public/versions/format-v8/`. They
retain the v8 draft namespace and support published v8 firmware. The manifest
records source revision and file hashes; archive banners were added to HTML, and a relative uploader link forwards to
the shared uploader. The bundled JavaScript remains unchanged.

The frozen v10 editor/live view is in `../public/versions/format-v10/`, built from
`38e5816` before any v11 web changes. Its v10 draft namespace and encoding remain
unchanged. Both HTML entry points have a banner and relative latest-editor link;
the uploader redirects to the shared uploader, which still bundles v10 firmware.
The manifest hashes assets, source maps, screenshots, favicon and entry points.

The frozen v11 editor/live view is in `../public/versions/format-v11/`, built from
finalized v11 release commit `418894a`. Its v11 draft namespace is preserved.
All 489 tests, TypeScript and the Vite build passed. HTML entry points add an
archive banner and latest-editor link; the uploader redirects to the shared
uploader. The manifest records provenance and hashes for every archived file.

The frozen v12 editor/live view is in `../public/versions/format-v12/`, built
from the final outgoing v12 source `3d23690` before v13 firmware changes. Its
v12 draft namespace is preserved. All 502 tests passed after correcting a
stale test assertion to inspect the extracted consumer control component;
application source was unchanged. TypeScript, Vite and archive checks passed.
The manifest records source provenance, hosting changes and SHA-256 hashes.

The frozen v13 editor/live view is in `../public/versions/format-v13/`, built
from finalized v13 configurator source `15660bc`, which includes the released
4–64 pointer range. All 610 source tests, TypeScript and Vite passed.
HTML banners link to the latest editor; the installer redirects to the shared
uploader. The manifest records provenance and SHA-256 hashes, including source
maps. The existing v13 draft namespace and application assets are preserved.

The frozen v14 editor and live view are in `../public/versions/format-v14/`,
built from finalized outgoing v14 source `0fb6132`. All 663 source tests,
TypeScript, Vite, uploader generation and existing archive checks passed.
HTML entry points add archive banners and latest-editor links; the installer
redirects to the shared uploader. Its v14 draft namespace and application assets
are preserved. The manifest records source provenance and SHA-256 hashes.


The frozen v15 editor and live view are in `../public/versions/format-v15/`,
built from finalized v15 release source `8c150a0`. All 698 source tests passed
against that revision's firmware validator. TypeScript, the complete production
build, archive checksums and archive serving checks passed. HTML entry points add
archive banners and latest-editor links; the installer redirects to the shared
uploader. The existing `format-v15:board:` draft namespace is preserved. The
manifest records provenance, hosting adjustments and SHA-256 hashes.

The frozen v16 editor and live view are in `../public/versions/format-v16/`,
built from finalized published release source `51db5e6`. All 746 tests across
63 files passed against that source and its firmware validator. TypeScript, the
production build and existing archive checks passed. HTML archive banners and
a shared-uploader redirect were added; application assets and the
`format-v16:board:` draft namespace are unchanged. The manifest records source
provenance and checksums. The archived viewer provides saved shortcuts and layer
following; runtime telemetry belongs to v17. Both v16 entry points pass archive
serving checks, and v16 devices route to this archive from the active editor.


The frozen v17 editor and Live View are in `../public/versions/format-v17/`,
built from finalized outgoing source `38724fb`, including runtime telemetry and
its latest sleep-state display. All 805 tests across 66 files passed against
that extracted source and its v17 firmware validator. TypeScript, the production
build and all 15 earlier archive checks passed. The existing `format-v17:board:`
draft namespace is preserved. Only HTML banners and the shared uploader redirect
were added; application assets are unchanged. Its manifest records provenance
and SHA-256 checksums. The archive catalog and active editor route v17 firmware
to this matching editor/viewer.
