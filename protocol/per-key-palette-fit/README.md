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

| Candidate | Parent | Flash Six / Three | Saving Six / Three | Stack Six / Three | Status |
| --- | --- | --- | --- | --- | --- |
| Original Ideal | Original Probe | 14478 / 14510 | — | 82 / 85 | Preserved in original experiment |
| Ignore Nibble | Original Ideal | 14478 / 14474 | 0 / 36 | 82 / 85 | Included |
| Ignore Unused | Ignore Nibble | 14440 / 14436 | 38 / 38 | 82 / 85 | Included; full host suites adapted |
| Palette Cursor | Ignore Unused | 14432 / 14428 | 8 / 8 | 82 / 85 | Measured feature candidate |
| Unified Rainbow | Palette Cursor | 14374 / 14370 | 58 / 58 | 81 / 84 | Measured feature candidate |
| Selected Color | Unified Rainbow | 14374 / 14370 | 0 / 0 | 82 / 85 | Same flash, recovers one stack byte |

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

The initial ignored-field checkpoint is still over the real flash limit. Full
host suites pass with preview enabled; the no-preview run is recorded separately
in the temporary artifact directory. Final selected candidates require rerunning
the complete host suites and both real-limit native builds. No candidate is
claimed fitted or hardware validated at this checkpoint. Configurator, uploader,
site and archive work are deferred or unchanged, not claimed validated here.
