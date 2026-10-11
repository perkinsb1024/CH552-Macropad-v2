# Firmware Release Process

Use this checklist when preparing a firmware release. Read
`documentation/local-release-checklist.md` too, if present. Release generation
and commits require an explicit request for the current task.

## Preserve the Previous Release

Before replacing files in `releases/`, copy the outgoing three-key and six-key
HEX files unchanged to `webUploader/firmware-history/`. Record their format,
release commit, source revision, publication timestamp and SHA-256 checksums in
`index.json`. Recover missing published files from their original release
commits rather than rebuilding them.

Before switching the active editor to a new format, freeze a tested production
configurator from the finalized outgoing release source. Follow
[Frozen Configurators](../webapp/archives/README.md). Record provenance and
checksums, add the archive index entry and active-editor routing, and preserve
existing archive files unchanged. Verify every superseded published format has
a matching archive during each release.

## Build and Document the Release

Generate both variants using the release target described in the
[README](../README.md#build-release-hex-files-for-both-variants) only when release
generation is requested. If release HEX files are already supplied, preserve
them and compare fresh temporary builds against them.

Update these locations using the actual release files and measured builds:

- README **How to Compile the Firmware**: update the pre-built version, source
  revision, both HEX links, feature summary and matching configurator paragraph.
  Check this section separately from **Firmware Version History**; updating the
  history table does not update the installation instructions.
- README **Available Memory**: report flash used/free, USB DMA, paged RAM,
  ordinary XSEG, absolute image, total external allocation and linker stack
  reserve for both variants. Distinguish stack capacity from runtime usage.
- README **Firmware Version History**, **Configuring Your Macropad** and
  **Further Documentation**: describe the published features and current format.
- Current `protocol/config-vN.md`: update release revision/HEX links,
  **Builds and Measurements**, validation status and reproduction commands.
  Keep the specification standalone and complete.
- `webUploader/README.md`: update the bundled release, editor link, migration
  advice and historical-file count. Its generated **Version History** reads the
  root README's feature notes.
- `webapp/README.md` and the configuration/capacity guides: update active format,
  release availability, action behavior, migration and hardware validation.

A user request to release firmware confirms that the user has completed hardware
validation. Record the firmware as hardware validated unless the user states
otherwise; do not infer specific platforms or test procedures. Search current documentation for
the previous hash, old release filenames, obsolete “no release” claims and
unsupported-format statements. Keep intentional historical references; point
historical HEX links at their preserved firmware-history files when necessary.

## Run All Checks

From the repository root:

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
node webUploader/build.mjs
node --test webUploader/tests/*.test.mjs
```

Build both native variants into temporary directories with the real application
flash limit using the current protocol reference's reproduction commands.
Confirm their linked memory layouts and compare the HEX contents with the release.

From `webapp/`:

```sh
npm test
npm run build
```

The complete build checks types and frozen archive checksums and bundles the
latest uploader. Confirm its manifest contains the intended latest pair and
all preserved previous releases. Check **Version History** selects
**Latest Release** for the current version and the matching **Previous Release**
for older versions, with both hardware variants available and correct editor
links. Update release-specific test expectations when the history grows.

Before publishing, verify every current release link names an existing file
for the correct hardware variant and review the complete diff. Leave generated
firmware copies and manifests to the uploader build.
