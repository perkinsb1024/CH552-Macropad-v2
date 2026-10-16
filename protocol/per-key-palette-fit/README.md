# V16 Per-Key Palette Fitting

Branch: `experiment/per-key-persistent-indicator`. Starting artifact checkpoint:
`bc3341b`; unchanged published firmware baseline: `0c7bbbe`. User selected the
ideal palette with per-key **Rainbow**, authorized optimization without feature
cuts, and explicitly deferred configurator work. Releases remain untouched.

## Measured Candidate Ledger

Native measurements use the existing CH55xDuino 0.0.25 / SDCC build.13407_4
builder, small model, opt-code-size, 24MHz, 148 USB DMA bytes and preview enabled.
Diagnostic links use 16,384 bytes only to measure candidates over the real
14,336-byte application limit. These diagnostic outputs are not deployable.

| Candidate | Parent | Flash Six / Three | Saving Six / Three | Stack Six / Three | Disposition |
| --- | --- | --- | --- | --- | --- |
| ignore-nibble | original ideal | 14478 / 14474 | 0 / 36 | 82 / 85 | Selected or cumulative control |
| ignore-unused | ignore-nibble | 14440 / 14436 | 38 / 38 | 82 / 85 | Selected or cumulative control |
| palette-cursor | ignore-unused | 14432 / 14428 | 8 / 8 | 82 / 85 | Selected or cumulative control |
| unified-rainbow | palette-cursor | 14374 / 14370 | 58 / 58 | 81 / 84 | Selected or cumulative control |
| selected-color | unified-rainbow | 14374 / 14370 | 0 / 0 | 82 / 85 | Selected or cumulative control |
| validation-cursor | selected-color | 14362 / 14358 | 12 / 12 | 82 / 85 | Selected or cumulative control |
| inline-colors | validation-cursor | 14388 / 14384 | -26 / -26 | 81 / 84 | Not selected |
| pdata-layer | validation-cursor | 14362 / 14358 | 0 / 0 | 82 / 85 | Not selected |
| pdata-palettes | validation-cursor | 14364 / 14360 | -2 / -2 | 83 / 86 | Not selected |
| byte-colors | validation-cursor | 14346 / 14342 | 16 / 16 | 82 / 85 | Selected or cumulative control |
| global-layer | validation-cursor | 14350 / 14346 | 12 / 12 | 82 / 85 | Selected or cumulative control |
| byte-global | global-layer | 14334 / 14330 | 16 / 16 | 82 / 85 | Selected or cumulative control |
| global-offsets | byte-global | 14346 / 14342 | -12 / -12 | 82 / 85 | Not selected |
| stack-restore | byte-global | 14358 / 14354 | -24 / -24 | 90 / 93 | Not selected |
| effect-clear | byte-global | 14336 / 14332 | -2 / -2 | 82 / 85 | Not selected |
| crc-fold | byte-global | 14364 / 14360 | -30 / -30 | 82 / 85 | Not selected |
| crc-bytes | byte-global | 14346 / 14342 | -12 / -12 | 82 / 85 | Not selected |
| narrow-metadata | byte-global | 14308 / 14304 | 26 / 26 | 84 / 87 | Selected or cumulative control |
| stack-raw | narrow-metadata | 14332 / 14328 | -24 / -24 | 91 / 94 | Not selected |
| stack-full | narrow-metadata | 14332 / 14328 | -24 / -24 | 92 / 95 | Selected or cumulative control |
| final | stack-full | 14332 / 14328 | 0 / 0 | 92 / 95 | Selected or cumulative control |

Each candidate has a complete independent patch against `bc3341b`, a source
snapshot and native logs/maps under `/private/tmp/macropad-v16-fit/<candidate>/`,
and measured results/source digests in [results.json](results.json).
[measure.py](measure.py) snapshots a candidate and measures both boards without
touching release files. Source snapshots are preserved rather than overwritten.

## Ignored-Field Audit

Writers must zero unused bits/values; firmware ignores the following fields while
the full-image CRC continues to cover them:

- The unused high nibble of a three-key palette, including the additional layer
  palettes. Color selection reads only the three actual nibbles.
- Header byte 2 bit 7, byte 3 bit 0, and byte 6 bits 5–7. Every runtime reader
  masks them away or shifts them out before decoding counts, startup and sleep.
- The parameter of **None**, and the value nibble of **Restore All Configured
  LED Settings** and clearing a temporary effect. Execution discards these values.
- Pointer bit 7 in both pointer action forms, and bit 6 in single-axis movement.
  Runtime movement and hold recognition ignore those bits.
- Layer-action bit 7. Runtime dispatch masks its mode fields and normalizes
  momentary bindings before later exact matching.

The scroll-mode bits remain checked: held-scroll repetition uses a full action
comparison, so the nominally reserved bits are not actually ignored. Unknown
action encodings, invalid hold contexts, usable command/value ranges, image
bounds, hardware/format identifiers, layer/string/macro references and terminators
remain validated. String character validation is unchanged at this checkpoint.

The full pre-existing regression suites have been ported to v16's palette indices
and source sentinel. Empty test layers explicitly use uniform **Red**; zero would
allocate an additional palette. Exhaustive validator expectations now include
the deliberately ignored fields. New palette tests retain the independent
renderer reference, bounds/addressing, input, effects and sleep/wake probes.

## Feature Candidates

**Palette Cursor** walks fixed-stride option bytes directly instead of calling
the per-layer option accessor at every iteration. It retains host validation of
both geometries, fixed layer addressing and the same packed optional section.

**Unified Rainbow** makes the existing animation flag describe all rainbow
sources and reuses the selected color's index for the common renderer. It removes
the second palette/phase lookup in the main-loop scheduling gate. The initial
flag retains the old uniform/effect/preview gate behavior, including hidden
uniform animation; custom background and pressed sources add participation.

**Selected Color** avoids keeping a separate background scratch byte across the
pressed-key decision. A transparent key leaves the selected background intact;
an opaque key replaces it. It has identical flash to the preceding form but
recovers one linker stack byte. These are feature-specific optimizations, not
cuts to LED modes, timing policies, brightness controls or animation options.

## Checkpoints and Validation

The final firmware passes complete host suites with preview enabled and disabled,
including the independent sleep-integration changes present in the shared working
tree during testing. Both real-limit native builds pass layout/startup/interrupt
storage checks at 14,332/14,328 flash bytes, leaving 4/8. Stack reserve is 92/95,
an increase of two bytes on both boards versus published firmware. PSEG107,
ordinary XSEG372/363, absolute134 and USB148 total761/752 external bytes; this is
nine additional external bytes per board. No feature cuts or integrity changes.

The exact-buffer AddressSanitizer [bounds probe](bounds-probe.c) passes 511,520
sealed-image cases, including exhaustive metadata/pool count boundaries and
20,000 deterministic malformed images. New palette tests compare 508,064 frames
per board/preview setting to an independent renderer reference and exercise
ignored-field validation and execution. The final four runs compare 2,032,256
frames. Both real-limit HEX outputs match their diagnostic counterparts.

Firmware checkpoints: `7540c0e` adds the ideal feature and ignored-field changes;
`397c2f6` records the first feature-specific fit. The final stack-preserving
firmware checkpoint is `4a05616`. Hardware validation and configurator work are
pending. No releases, archives or active editor files were changed.


## Final Selection and Rejected Attempts

The final selection combines direct option cursors, one cached animation gate,
a selected-color renderer, byte-sized packed-color addressing, and one paged
frame-palette scratch byte. The color lookup remains a C function: inlining it
increased flash by 26 bytes and reduced stack, so it was rejected. Local pdata
qualifiers alone either had no effect because SDCC retained a register or cost
two flash bytes; a persistent main-loop frame scratch offset saved 12 instead.
Moving both offsets to globals lost 12 bytes versus storing only the layer offset.

After the feature first fitted, broader probes explored stack preservation.
Clearing temporary effects before other decoding grew code by two bytes. Two
equivalent tableless CRC-16 forms grew code by 30 and 12 bytes; neither was
adopted, and the existing CRC-16 implementation is unchanged.

The selected general arithmetic change narrows the metadata subtotal before
adding the string pool. The already validated maxima are 9 header bytes +110
fixed layer bytes +15 palette bytes +93 chord bytes +24 timer bytes =251 on
six-key hardware, or245 on three-key hardware. This subtotal cannot overflow a
byte; the following pool addition and final image bound remain 16-bit. Builds
with CONFIG_TIMED_MAX greater than4 retain the original wide arithmetic. This
saves26 flash bytes per board and recovers two stack bytes. No bounds checks
are removed or weakened.

Moving seven raw input levels from internal to ordinary external RAM and the
last-layer byte from internal to paged external RAM adds24 flash bytes, but
restores eight internal bytes. Combined with the arithmetic change, final stack
reserve is92/95 instead of the prototype's82/85 and published90/93. The alternative
that moved only raw levels has identical flash, PSEG106 and stack91/94; the selected
form uses one more paged byte for another stack byte. Page-zero still has one
unused byte; all linked regions and absolute active-image separation are checked.

The new format reference is [Configuration Format V16](../config-v16.md).
The historical probe files remain unchanged. The standalone bounds probe can be
reproduced with:

```sh
cc -std=c99 -O1 -g -fsanitize=address -D__data= -D__idata= -D__pdata= -D__xdata= -D__code= protocol/per-key-palette-fit/bounds-probe.c src/config.c -o /private/tmp/v16-bounds
/private/tmp/v16-bounds
```


## Deployment Validation With Configurator Work Deferred

The final firmware revision is `4a05616`; final verification ran with only
independent sleep-test changes and these documentation updates uncommitted.
No firmware source differed from that revision. Configurator files, uploader
sources, checked-in firmware releases and frozen archives remain unchanged.

The required `npm run verify:deploy` was attempted on the final firmware and
existing v15 editor. It stops at configurator tests: 618 pass and 80 fail in 14
files. The interoperability helper in `webapp/tests/firmware-validator.mjs`
compiles the active `src/config.c`; positive v15 image cases are correctly rejected
by the new v16-only validator. The editor still emits v15 images. No tests were
bypassed and no configurator changes were made to disguise this format mismatch.
Full deployment validation therefore has not passed and is deferred to the
separately planned configurator integration.

The later unchanged components were checked independently: standalone uploader
build passes, all 91 uploader tests pass, and `npm run build` passes TypeScript,
complete-site/uploader packaging and all 13 frozen archive manifests. These
individual passes do not turn the failed shared gate into a pass. Existing v15
release HEX files remain the uploader's latest release; no v16 release was made.
Logs and hashes are preserved with the other fitting artifacts.
