# Per-Key Layer Palette Size Experiment

Measured October 15, 2026 on `experiment/per-key-persistent-indicator`.
Baseline: `0c7bbbe3312045e14a0d9d8ed91bc0ff0342e580`. Both candidates are
isolated temporary-source prototypes; neither is applied to active firmware.
Configurator, migration, archives and releases are deliberately deferred while
the user chooses a candidate and whether to attempt fitting it.

## Results

All values are measured bytes, with color preview enabled in native builds.
The real application limit is 14,336 bytes.

| Candidate | Hardware | Flash | Change From Baseline | Free / Over Limit | Stack Capacity | Stack Change |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| Baseline | Six Keys | 14,222 | 0 | 114 free | 90 | 0 |
| Baseline | Three Keys | 14,218 | 0 | 118 free | 93 | 0 |
| Ideal: Per-Key Rainbow | Six Keys | 14,478 | +256 | 142 over | 82 | −8 |
| Ideal: Per-Key Rainbow | Three Keys | 14,510 | +292 | 174 over | 85 | −8 |
| Fallback: Per-Key Teal | Six Keys | 14,444 | +222 | 108 over | 82 | −8 |
| Fallback: Per-Key Teal | Three Keys | 14,476 | +258 | 140 over | 85 | −8 |

Per-key rainbow adds 34 bytes over the fallback on either hardware variant. The
larger shared cost comes from storing/addressing optional palettes and integrating
them with rendering and validation. Removing rainbow does not remove that cost.
No fitting or optimization sweep was attempted; the user reserved that decision.

Both candidates reduce linker-reserved stack capacity by eight bytes. These are
capacity measurements, not hardware stack high-water results. External RAM is
unchanged: PSEG 105 bytes, ordinary XSEG 365/356, absolute active/runtime buffer
134, USB DMA 148, total external allocation 752/743 for six/three keys. The ideal
adds one cached bit flag, not another per-key animation array.

Padded object-section deltas explain the complete flash changes:

| Module | Ideal Six / Three | Fallback Six / Three |
| --- | --- | --- |
| Sketch | +116 / +116 | +82 / +82 |
| Configuration | +140 / +176 | +140 / +176 |
| All Other Modules | 0 / 0 | 0 / 0 |

These module deltas are measured sums of CSEG, CONST and GSINIT, not separately
compiled feature costs. The three-key configuration path includes validation of
the unused high nibble in each additional two-byte palette. No claim is made
that deleting that check would save the full 36-byte geometry difference.

## Encoding and Behavior

Both candidates replace the uniform layer **Teal** choice with a per-key source
selector. To follow the investigated zero-sentinel layout, they use:

| Index | Uniform Layer Selector | Ideal Per-Key Tables | Fallback Per-Key Tables |
| --- | --- | --- | --- |
| 0 | Per-key palette | **Off** | **Off** |
| 1–7 | **Red**, **Coral**, **Orange**, **Amber**, **Yellow**, **Green**, **Leaf** | Same solids | Same solids |
| 8–14 | Existing **Cyan** through **White** | Same solids | Same solids |
| 15 | **Rainbow** | **Rainbow** | **Teal** |

The per-key tables include both pressed-key colors and additional layer palettes.
Uniform layer rainbow and temporary-effect rainbow remain available in both
candidates. The fallback's lack of rainbow applies only to the per-key tables.
Temporary effects use the uniform palette interpretation; effect/preview color
zero is solid black, never a recursive palette reference.

Provisional format/palette identifiers are 16/4 for ideal and 17/5 for fallback.
They intentionally differ so the two incompatible per-key meanings of index 15
cannot be loaded interchangeably. These are experiment identifiers, not finalized
release numbering. Both reject published v15 images. Old-profile migration is
not implemented, and the current configurator cannot create these images.

The image order is:

`9-byte header → fixed layers → optional layer palettes → chords → timers → strings → macros/padding`

Fixed layers retain their existing 22-/15-byte strides, including their original
pressed-key palette and options byte. A zero color nibble in a layer's options
adds one palette after all fixed layers. Palettes appear in layer order, using
one nibble per physical key, low nibble first: three bytes on six-key hardware,
two on three-key hardware. The unused high nibble on three-key palettes must be
zero. A zero palette entry means **Off**, not another source selector.

No masks, count bytes, header bits or wider action records are required. A profile
without extra palettes consumes no extra image bytes; profiles with `P` custom
layers consume `3P`/`2P` additional bytes. Existing 128-byte bounds and full-image
CRC remain enforced. Chord, timer, string and absolute macro addressing include
the added section. The save protocol and marker-last write procedure are unchanged.

All existing layer visibility and brightness policies apply to each layer's
palette. Timed and blinking indications cover pressed colors, including fully
dark blink phases. They still end without a steady idle background. **Always On**
supplies the steady background, and **Do Not Indicate** has none. Steady temporary
effects replace the layer palette; pressed feedback can cover them. Temporary
blink effects and hardware preview retain their existing priority.

Saved keypress **Off** uses zero in the existing transparent-black test. With
**Black** selected it obscures the background; **Transparent** reveals it.
Runtime keypress brightness **Off** continues to remove the overlay. Brightness
presets, relative stepping and auto-sleep retain their existing policies.

The ideal reuses the existing hue, drift, phase spacing and dimming engine for
per-key index 15. A cached bit records custom rainbow participation during a
render and extends the existing animation gate. This permits animation under
solid/disabled uniform layer modes, preserves animated custom blink phases,
and avoids scanning palettes from the scheduler. It deliberately shares the
existing clock; it does not add independently configured animation speeds.

## Validation and Limits

- Fresh baseline native builds pass the real 14,336-byte limit for both boards
  and reproduce the published 14,222/14,218-byte results.
- Both candidates link at a diagnostic 16,384-byte limit and pass the builder's
  normal paged/external/absolute layout, startup clearing and interrupt-parameter
  checks. Both fail the real application limit solely for insufficient flash.
  Diagnostic outputs are measurement artifacts, not deployable firmware.
- Baseline complete host suites pass with and without preview, including both
  geometries, layout checks and bootloader checks. Active source/test dependencies
  match the baseline revision; experiment artifact changes were uncommitted
  while validation ran.
- Candidate probes pass on both geometries with preview enabled and disabled:
  eight runs, each comparing 508,064 frames to an independent color/priority
  reference, totaling 4,064,512 frame comparisons.
- The renderer matrix covers uniform/custom colors, every background/pressed
  palette index, all visibility modes, full/dim configuration, all runtime
  brightness-policy pairs, press state, transparency and dark blink phases.
  Additional checks cover rainbow sector boundaries, spacing/drift, mixed
  per-key colors, actual debounced blackout/transparent input, layer transitions
  while held, custom/key rainbow scheduling, effects, preview and sleep/wake.
- Configuration checks enumerate every layer-mask arrangement at every supported
  layer count, capacity boundaries, overflow, malformed three-key padding, CRC,
  incompatible versions, and moved chord/timer/string/macro sections. A macro
  actually executes from its moved location, and the moved user timer fires.

The old candidate-wide host entry points are not claimed to pass: they create raw
v15 images with old color indices and zero layer selectors. Instead the dedicated
probe reuses their hardware/USB harness with fresh experimental-format fixtures.
The first probe revision assumed a macro executes in a single poll; its assertion
failed. The test was corrected to pump the existing scheduler and inspect emitted
reports. No candidate firmware change resulted from that test correction.

No configurator, uploader or site validation, hardware flashing, hardware
validation, feature cuts beyond the requested palette choices, or release
generation was performed. Firmware remains unadopted. No optimization was
performed; the measurements include the complete straightforward implementation.

## Artifacts and Reproduction

- [Ideal Patch](ideal.patch) and [Fallback Patch](fallback.patch) apply independently
  to the baseline. Both pass `git apply --check` against active baseline firmware.
- [Build Results](results.json), [Module Sizes](components.json), and
  [Validation Results](validation.json) preserve exact measurements.
- [Artifact Checksums](artifacts.json) identify temporary source, logs, maps,
  memory reports and HEX files. Compact diagnostic memory reports are also
  checked in under `measurements/`. The empty baseline patch denotes no changes.
- [Build Driver](build.py) creates isolated sources from the pinned Git revision.
  [Host Probe](probe.c) preserves the candidate tests and independent reference.
- Complete temporary source/build/log artifacts are under
  `/private/tmp/macropad-per-key-palette-20261015/`.

Use a fresh output directory to preserve existing measured sources:

```sh
python3 protocol/per-key-palette-experiment/build.py /private/tmp/macropad-per-key-palette-repeat --prepare --build --validate
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
```

The driver writes regenerated patches/results to this experiment directory. It
never generates releases, uploads, or changes active firmware. Preparation refuses
to overwrite an existing source tree. Native builds use CH55xDuino 0.0.25 / SDCC
build.13407_4, size optimization, small model, no XINIT copy, 24MHz and 148 USB DMA
bytes, matching the existing builder.

Applying a candidate independently requires its complete three-file patch:
configuration header, parser/accessors and sketch. Remeasure that branch's own
baseline and rerun its relevant tests; the measured costs are compiler/source
dependent. Palette migration, finalized format documentation and configurator
support remain separate work after a candidate is selected.
