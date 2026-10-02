# Conditional indicator brightness preset: reimplementation guide

Status: deferred after a firmware size experiment. This feature is **not** in the
working firmware or editor. The accompanying
[prototype patch](conditional-indicator-preset.patch) preserves the exact firmware
changes measured in the experiment; it is a starting point, not a tested feature.

## Intended behavior

Add one common brightness preset with these policies:

| Configured layer indicator mode | Indicator behavior while preset is active |
| --- | --- |
| Timed on | Dim during the configured indication, then off |
| Blink by layer | Dim during lit phases; dark phases remain black |
| Always on | Off; no idle layer background |
| None | Remains off |

Key brightness stays **As configured**, currently Bright. Existing indication
priority still applies: timed/blink feedback can temporarily obscure key feedback,
including blink dark phases. This preset does not change that priority, colors,
visibility modes, durations, rainbow phase, or rainbow speed.

The override is global and follows the active layer's configured visibility mode,
including when changing layers. It changes no saved profile bytes. Existing reset
events restore configured policies, and hardware color preview bypasses the policy.

Expose it through all three existing common-preset commands: Set, Relative, and
Toggle preset on/off. No new command or action-record bytes are needed.

## Measured flash and RAM

These measurements use the working preset-toggle implementation as the baseline,
CH55xDuino 0.0.25, SDCC build.13407_4, `--opt-code-size`, preview enabled, and the
normal **14,336-byte** linker limit. Outputs were temporary; releases were preserved.

| Variant | Baseline flash | Prototype flash | Added bytes | Over limit | xRAM used / available | Stack region |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,321 | 14,352 | 31 | 16 | 619 / 876 | 127 |
| Six-key | 14,325 | 14,356 | 31 | 20 | 628 / 876 | 124 |

Both linker checks failed. The six-key result exceeded the user's approximately
16-byte over-limit cutoff, so the prototype was removed without optimization work.
Against this baseline, at least 20 bytes must be recovered to fit both variants;
additional headroom would be preferable. These costs are toolchain/source dependent,
not a guarantee for later revisions. Stack regions are linker capacity, not measured
hardware headroom. Persistent xRAM usage did not increase.

## Firmware changes

1. In `CH552_Universal_Macropad.ino`, extend the internal indicator policy byte:
   Off=0, Dim=1, Bright=2, Configured=3, conditional Dim/Off=4. Keep the key policy
   at 0..3 and keep the four-byte `ledSettings` array. Do not expose policy 4 as an
   ordinary absolute brightness wire value: it is selected only by this preset.

2. Widen **internal** policy-pair packing from two to three indicator bits:

   ```c
   pair = indicatorPolicy | (keyPolicy << 3);
   indicatorPolicy = pair & 7;
   keyPolicy = pair >> 3;
   ```

   Update both relative-preset matching and preset application. Update the toggle
   configured-pair sentinel from 15 to 27 (`3 | (3 << 3)`). This is separate from
   the absolute wire sentinel `0xF`, which stays unchanged.

3. Append wire preset **5**, preserving existing indices 0..4. Replace the table:

   ```c
   __code uint8_t ledPresets[6] = {27, 25, 9, 8, 0, 28};
   ```

   | Wire preset | Indicator policy | Key policy | Internal packed pair |
   | --- | --- | --- | ---: |
   | 0 | Configured | Configured | 27 |
   | 1 | Dim | Configured | 25 |
   | 2 | Dim | Dim | 9 |
   | 3 | Off | Dim | 8 |
   | 4 | Off | Off | 0 |
   | 5 | Conditional Dim/Off | Configured | 28 |

4. In `indicatorBrightness(options)`, resolve policy 4 to zero for Always on and
   one otherwise. The existing renderer suppresses mode None and suppresses
   indications whose resolved brightness is zero:

   ```c
   if (level == 4)
     return (options & CONFIG_LAYER_OPT_INDICATOR_MASK) !=
       (CONFIG_LAYER_INDICATOR_ALWAYS_ON << CONFIG_LAYER_OPT_INDICATOR_SHIFT);
   ```

   Place this before the existing Configured-policy resolution. Preview already
   replaces runtime indicator brightness with saved brightness; preserve that path.

5. Extend preset matching/cycling to six entries: search through index 5, detect
   unmatched pairs at index 6, and pass count 6 to `ledStep`. For unmatched pairs,
   positive steps start from index 5 so +1 enters configured preset 0; negative
   steps start from index 0 so -1 enters preset 5. Positive cycling becomes
   `0 → 1 → 2 → 3 → 4 → 5 → 0`. This appended order preserves wire indices but
   is no longer strictly darkest-first: preset 5 restores bright key feedback.

6. Before relative individual/both brightness stepping, resolve policies
   **greater than or equal to 3**, instead of only policy 3. The existing
   `indicatorBrightness` call then resolves conditional policy 4 from the active
   layer to Off or Dim before ordinary Off/Dim/Bright cycling. Otherwise the new
   policy would be fed incorrectly into the three-state cycle. Key policy 4 must
   remain unreachable.

7. In `src/config.c`, accept Set preset values 0..5 and Toggle preset values 1..5.
   The existing decrement-based toggle check becomes `return aux < 5;` after
   `--aux`. Preserve rejection of toggle zero and all other invalid values.
   No new command constant is needed in `src/config.h`.

## Editor and format documentation

- Append a sixth label to `COMMON_PRESET_LABELS` in
  `webapp/src/model/ledControl.ts`, for example:
  **“Blink/timed dim, always-on off; key bright.”** Appending preserves
  the numeric indices of existing presets. Existing Set and Toggle option generation
  then exposes it without another control; Toggle must still exclude preset 0.
- Extend `ledProblem`: Set permits 0..5 and Toggle permits 1..5. Keep the Toggle
  default at preset 3 unless deliberately changing the UX. Binary/JSON codecs
  already use these helpers and numeric preset values.
- Update the relative-step hint in `Inspector.tsx`, which currently describes
  selecting the next darker preset. With the appended conditional preset, describe
  cycling through presets and wrapping to configured instead.
- Update `protocol/config-v6.md`: accepted values, the six-entry preset table,
  wraparound and unmatched-entry rules, conditional resolution, and compatibility.
  The valid LED payload count becomes **118** (116 plus new Set and Toggle values).
- The prototype retained v6, consistent with the accepted toggle extension.
  Earlier v6 firmware rejects profiles using preset 5 before writing flash; it
  does not silently reinterpret them. Old profiles remain valid on new firmware.
  If versioning requirements change, handle that separately rather than claiming
  this is already supported by all v6 firmware.

## Tests required before retaining it

The measured prototype was not behavior-tested and had no editor changes. Complete
these checks when implementing it:

- `tests/config_test.c`: independently allow Set 0..5 and Toggle 1..5 and change
  the exhaustive 4,096-payload expected total to 118 for both variants. Keep invalid
  payload coverage, including individual brightness value 4 and toggle zero.
- `tests/led_input_cases.h`: change internal pair shifts to 3, configured pairs
  to 27, preset loop bounds/counts to 6, and unmatched-cycle expectations to modulo
  6. Include indicator policies 0..4 and key policies 0..3; never generate key
  policy 4. Conditional indicator stepping resolves to 0 on Always on and 1 on
  other modes before applying the signed step.
- Extend renderer cases to include the conditional policy for every visibility
  mode, saved brightness, held-key state, and blink phase. Verify dim timed/blink
  output, dark phases, no always-on idle background, and configured bright key
  feedback whenever indicator priority permits it.
- Exercise layer changes between blink/timed, always-on, and None while the
  preset remains active. Confirm actual-policy matching makes Toggle restore
  configured brightness on a second invocation even after a layer change.
- Confirm other LED commands replace the conditional policy normally, configured
  restores remove it, phase/speed are preserved, active-image bytes are unchanged,
  and color preview bypasses it on an Always on layer.
- Browser tests: include preset 5 in editor options, validate the default remains
  legal, test Set/Toggle binary and JSON round trips, and update the exhaustive
  payload count. Then run the complete host/browser suites and production build.
- Measure both variants again and test the behavior on hardware once they fit.

## Applying the saved prototype and measuring it

From the project root, first check the patch against the current sources:

```sh
git apply --check protocol/conditional-indicator-preset.patch
```

Then apply it when actually starting implementation:

```sh
git apply protocol/conditional-indicator-preset.patch
```

The patch contains only the measured firmware/validation edits; perform the editor,
documentation, and test updates above separately. If sources have moved, adapt the
steps rather than forcing the patch. Preserve unrelated work in the working tree.

Measure using temporary build outputs and the normal linker limit (variant 0 is
six-key; variant 1 is three-key):

```sh
python3 pio-platform/build_firmware.py build "$PWD" /private/tmp/macropad-conditional-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build "$PWD" /private/tmp/macropad-conditional-three 24000000 148 14336 1
```

Inspect each output directory's `firmware.mem` for flash, xRAM, and stack region.
The linker emits size diagnostics even when the normal flash limit is exceeded.
Do not increase the production code limit to make the build pass. Release generation
requires an explicit request under the project's `AGENTS.md`; temporary feasibility
builds do not authorize modifying checked-in releases.
