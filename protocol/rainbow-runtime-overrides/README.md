# Rainbow Runtime Overrides Experiment

Measured October 17, 2026 on `experiment/v17-rainbow-always-use-overrides`.
Baseline: `84f6f7a77682f7bdad995c450da91e2034436711`, initially clean.
Firmware and regression checkpoint: `0da70dc`.

## Behavior

The baseline **Set All LEDs** with **Rainbow** already follows runtime phase
overrides. Its speed instead uses the saved profile whenever `previewOptions`
is nonzero, including temporary LED effects. The earlier claim that both
settings bypass runtime overrides was incorrect.

Use `colorPreviewActive` instead of `previewOptions` to select saved speed.
Normal lighting and LED effects then follow runtime speed, including commands
issued while an effect is active. Hardware color preview retains saved phase
and speed. No state, configuration format or action encoding changes are needed.
This covers always-on, dim and all eight blink counts.

## Native Measurements

CH55xDuino 0.0.25, SDCC build.13407_4, small model, size optimization, 24MHz,
148-byte USB allocation and the existing `platformio.ini` register-save flags.
All four links pass the real 14,336-byte limit and memory-layout checks.

| Hardware | Baseline Flash | Runtime Overrides Flash | Delta | Remaining Flash | Stack Reserve Before/After |
| --- | ---: | ---: | ---: | ---: | --- |
| Six Keys | 14,331 | 14,329 | -2 | 7 | 103 / 103 |
| Three Keys | 14,327 | 14,325 | -2 | 11 | 106 / 106 |

External allocation remains 793/784 bytes (six/three): PSEG 107, ordinary XSEG
404/395, absolute configuration/runtime storage 134, USB 148. Stack values
are linker capacity, not runtime high-water measurements. No stack reduction
or feature cuts.

The generated sketch assembly replaces a paged-byte load and zero branch
(`mov r0,#_previewOptions`, `movx a,@r0`, `jz`) with a direct bit branch
(`jnb _colorPreviewActive`). The measured saving is 2 bytes on each geometry.
The bit and its lifecycle already exist; no new flag is introduced.

`results.json` records source/artifact checksums and memory measurements.
`firmware.patch` preserves the firmware change and regression independently
of the branch. Native HEX, assembly, maps and memory reports remain under
`/private/tmp/macropad-v17-rainbow-overrides/` in `baseline-six`,
`baseline-three`, `runtime-six` and `runtime-three`.

## Validation

- The new override regression fails on baseline firmware at the speed deadline
  assertion, before applying the one-line firmware change.
- `python3 tests/run_host_tests.py` passes after the change, covering both
  geometries, existing color-preview behavior, eight build-layout tests and
  nineteen bootloader tests.
- The new matrix checks all saved/runtime phase and speed combinations, both
  brightnesses and always-on plus 1–8 blinks: 4,608 cases per geometry. It
  compares effect phase rendering to normal layer rendering, checks speed
  deadlines around clock wraps, changes overrides during the effect, and checks
  that saved settings remain unchanged.
- Both native variants pass their normal paged, external/absolute allocation,
  startup and USB interrupt-parameter layout checks.
- Live View now uses runtime effect speed and saved color-preview speed, with
  its existing regression updated to assert that distinction.
- `npm run verify:deploy` passes on firmware checkpoint `0da70dc` plus the
  uncommitted Live View and documentation changes: configurator tests, 93
  uploader tests, TypeScript, complete production build and 15 frozen archives.
  The gate includes `npm run build`, updating the local preview output.

No preview-disabled validation was required. Hardware validation and flashing
were not performed. No release generation, publishing or push was performed.

## Reproduction and Independent Application

In a clean temporary checkout of the baseline, build before applying the patch:

```sh
python3 pio-platform/build_firmware.py build . /private/tmp/rainbow-baseline-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/rainbow-baseline-three 24000000 148 14336 1
```

Apply `firmware.patch`, or use firmware checkpoint `0da70dc`, then run:

```sh
python3 tests/run_host_tests.py
python3 pio-platform/build_firmware.py build . /private/tmp/rainbow-runtime-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/rainbow-runtime-three 24000000 148 14336 1
```

Compare `firmware.mem` for flash, stack and external allocations. The patch
depends on the existing `colorPreviewActive` distinction between protocol color
preview and LED effects. Port its speed predicate independently to another
branch only after confirming that flag's lifecycle; remeasure both variants
instead of assuming the same saving under another compiler or source layout.
Update Live View's speed selector in the same way if that branch has Live View.
