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
- README **Available Memory**: keep its four rows for flash used, flash remaining,
  total external RAM allocated and linker stack reserve for both variants.
  Keep the detailed USB DMA, paged RAM, ordinary XSEG and absolute-image
  allocations in the current protocol reference. Distinguish stack capacity
  from runtime usage.
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

## Validate the Final Release Contents

Finish the release files, archive updates and documentation before running the
final checks. In particular, the uploader bundles release notes from the root
README, so documentation edits can change the deployed site.

From the repository root:

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
```

Build both native variants into temporary directories with the real application
flash limit using the current protocol reference's reproduction commands.
Confirm their linked memory layouts and compare the HEX contents with the release.

From `webapp/`:

```sh
npm run verify:deploy
```

This is the same deployment gate used by GitHub Actions: configurator tests,
a fresh standalone uploader build and all uploader tests, then the complete site
build with type checks and frozen archive verification. Running `npm test` and
`npm run build` separately does not run the uploader tests.

Confirm the generated manifest contains the intended latest pair and
all preserved previous releases. Check **Version History** selects
**Latest Release** for the current version and the matching **Previous Release**
for older versions, with both hardware variants available and correct editor
links. Release-history tests check the recorded inventory, README synchronization
and coverage of every published format; editorial feature wording is not a
test contract.

Before publishing, verify every current release link names an existing file
for the correct hardware variant and review the complete diff. Leave generated
firmware copies and manifests to the uploader build.

If relevant files change after validation, rerun the affected checks and run the
complete deployment gate again before publishing. Report results separately for
firmware regressions/native builds, configurator tests, uploader tests and the
complete site/archive build. Identify the tested source revision and any
uncommitted changes; report skipped or failed checks explicitly.

## Publish After Validation

Run `npm run verify:deploy` on the final contents before pushing to `main`.
Direct pushes are supported; pull requests and branch protection are optional.
The deployment workflow runs the **Verify deployment** check on every pull request to `main`,
including documentation-only changes, and on merge-queue candidates. These runs
validate the proposed contents without publishing Pages artifacts or deploying.
Only a successful push to `main`, or a manual run on `main`, can deploy the site.

For optional enforcement before merging, a branch rule or ruleset can require
a pull request, the **Verify deployment** status check from GitHub Actions,
and an up-to-date branch. These restrictions change the direct-push and
force-push workflow, so enable them only when that workflow is desired. See GitHub's
[required status checks documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).
These are repository settings; editing the workflow alone does not enforce them.
