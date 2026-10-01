# Frozen configurators

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

The root serves the active v4 editor. `../public/versions/format-v3/` preserves the production build of the experimentation branch's original revision (recorded in `archive.json`), with a banner and link to the latest editor added to its HTML. Its existing v3 draft namespace is preserved.

`npm run dev` also serves these frozen HTML pages directly. The archive middleware
bypasses the active editor's HTML transformation and SPA fallback, so development
archive URLs behave like the deployed static site. Unknown archive paths return 404.
