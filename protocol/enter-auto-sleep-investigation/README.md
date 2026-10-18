# Enter Auto-Sleep Investigation

Measured October 17, 2026 against clean firmware revision
`07b68ba9ee01860ed1c37a2fc78df03bd23026b0` on
`config-v18-release-candidate`. This baseline includes the adopted 94-byte
arithmetic optimization. Both alternatives remain isolated source snapshots;
active firmware, configurator, current format reference and release files are
unchanged. The investigation artifacts are uncommitted.

## Measured Result

| Candidate | Added Flash per Pad | Six-Key Flash | Three-Key Flash | Free Flash Six/Three | Stack Reserve Six/Three |
| --- | ---: | ---: | ---: | --- | --- |
| Baseline | 0 | 14,205 | 14,201 | 131/135 | 102/105 |
| Any-Layer Entry | 74 | 14,279 | 14,275 | 57/61 | 102/105 |
| Enabled-Only Entry | 86 | 14,291 | 14,287 | 45/49 | 102/105 |

The enabled-only layer check adds 12 bytes per pad. It saves no flash relative
to any-layer entry with the agreed behavior. Both candidates fit without
feature cuts or additional optimization.

Both preserve PSEG 108 bytes, ordinary XSEG 404/395 bytes, absolute image/runtime
storage 134 bytes and USB DMA 148 bytes (794/785 total external bytes).
One new runtime bit fits within the existing four allocated bit-storage bytes:
the six-key linked bit count changes from 29 to 30. Stack reserve and allocated
RAM bytes remain unchanged. These are linker reserves, not hardware stack
measurements.

Measurements use CH55xDuino 0.0.25, SDCC build.13407_4, the existing small-model
size flags and callee-save list, 24MHz, normal firmware including LED preview,
and the real 14,336-byte application limit. All six final baseline/candidate
native links pass, including the builder's paged, external, absolute, startup
clearing and USB interrupt-parameter checks. See [results](results.json),
the candidate `.mem` reports, source manifests and temporary native artifacts
under `/private/tmp/macropad-enter-auto-sleep/`.

## Candidate Behavior

- Any-layer entry immediately arms the existing sleep slot, including when the
  effective layer has **Auto-Sleep** disabled. Disabled-layer polling does not
  cancel that manually entered sleep.
- Enabled-only entry uses the same implementation with an early return when
  the effective layer has **Auto-Sleep** disabled. It leaves sleep counters,
  brightness, effects and the brightness snapshot untouched in that case.
  Dispatch still follows ordinary one-shot consumption and accepted-binding
  telemetry rules.
- Both honor **Dim Instead of Off**, **Consume Wake Input** and **Show Layer
  Indicator**. Entry restarts the built-in slot's age and fractional phase,
  captures the existing brightness policies, and preserves the first capture
  across repeated entry or automatic expiry. No user timer is reset or removed.
- Ordinary physical input wakes or wakes-and-executes according to the profile.
  Releasing the initiating button or chord does not wake it. Profile/USB reset
  retains the existing reset behavior. Brightness restoration uses the existing
  runtime capture/restore commands.
- Same-layer selection, including **Relative Layer** with offset zero, does
  not need to wake manually entered sleep on a disabled layer. The user
  explicitly relaxed the earlier requirement during this investigation.
  Switching to a different disabled layer still restores awake lighting through
  the existing transition path. Enabled-to-enabled transitions retain sleep.
- Keys, encoder button, both rotation directions, chords, macros, timer expiry
  and **On Next Input** timer actions can invoke the command. If a timer's
  follow-up enters sleep while servicing a physical input, a small shared bit
  prevents the built-in timer from immediately waking it later in the same
  input pass. The next physical input wakes it normally. A consuming user timer
  still has its ordinary independent consumption behavior.
- LED effects and color preview retain their existing rendering priority over
  the sleep brightness policies. Entry does not add an effect-cancellation rule.

The provisional saved command is `CONFIG_LED_ENTER_SLEEP = 0x10`, with its
value nibble ignored. The two-byte action size and existing command numbers
are preserved; internal `0x0E`/`0x0F` capture/restore commands remain rejected
by saved-profile validation. This is an investigation allocation, not a
published format change. Adoption would still need the appropriate format,
configurator, validation, migration/archive and documentation work.

## Saved Patches and Reproduction

- [Any-layer firmware patch](any-layer.patch).
- [Enabled-only firmware patch](enabled-only.patch).
- [Validator test update](any-layer-tests.patch), identical in both candidates.
- [Entry integration tests](enter_sleep_test.c), copied into `tests/` in each
  snapshot by the measurement/validation drivers.
- [Measurement driver](measure.py) and [validation driver](validate.py).

Each firmware patch applies independently to the recorded baseline; do not
stack them. Check target source hashes and remeasure if the parent or toolchain
differs. The main checkout's firmware is not modified by these drivers. From
the matching baseline checkout:

```sh
python3 protocol/enter-auto-sleep-investigation/measure.py
python3 protocol/enter-auto-sleep-investigation/validate.py
```

The first command snapshots sources and tests, writes baseline-relative patches
and hashes, and builds both geometries for all three sources. It uses temporary
native outputs, not the release-generation target. The second command runs the
new real-sketch integration test under AddressSanitizer/UndefinedBehaviorSanitizer
with recovery disabled, plus the normal host runner on both candidate snapshots.
`--entry-only` limits validation to the additional integration tests.

## Validation and Earlier Attempts

Both final candidate snapshots pass the complete normal firmware host runner:
27 C-suite executions including both geometries, five-timer capacity, input,
sleep, telemetry and palette coverage, plus eight layout and nineteen mocked
bootloader tests. Each palette geometry compares 508,064 frames.

The additional entry integration tests pass ASan/UBSan on both candidates and
both geometries. Per binary, 4,096 cases sweep enabled/disabled layers, all 32
profile sleep settings, all 16 saved brightness-policy pairs and all four
physical wake sources. Additional cases cover all five user-timer slots,
disabled-layer no-op counter preservation, repeated capture, physical entry and
release, same/different-layer transitions, profile reset, timer expiry and
follow-up entry, macro/chord/one-shot dispatch, retained blink effects and
accepted-command telemetry. Existing validator coverage now accepts all sixteen
ignored value nibbles for the new command while retaining rejection of other
reserved commands. See [full validation](validation.json) and
[entry validation](validation-entry.json); validated source manifests identify
the exact snapshots.

The first unqualified prototype included the old same-layer wake requirement
and cost 108/72 bytes for any-layer/enabled-only entry. Its patches, driver and
measurements are under `initial-same-layer-wake/`. Removing that extra behavior
reduced the any-layer prototype to 60 bytes; the enabled-only prototype remained
72 bytes. Those simpler versions failed the new timer-follow-up test: the
same input immediately woke the sleep it had just requested. Their patches,
measurements and failing test record are retained under `rejected-input-resume/`.
The final 74/86-byte figures include the 14-byte fix for that case. Earlier
figures are not validated alternatives.

An ancillary test using the pre-existing **LED Control** effect-restore path
reported a host UBSan signed-left-shift issue in
`CH552_Universal_Macropad.ino` (`(command - CONFIG_LED_EFFECT_ON) << 1` when
restoring). That expression is unchanged by either candidate. No unrelated fix
is included; the final new effect test exercises natural blink expiry instead.
The final new entry tests pass strict ASan/UBSan; this does not claim the whole
existing sketch is free of undefined behavior.

No active deployment inputs changed, so configurator, uploader and complete-site
deployment gates were not run for this investigation. Hardware validation,
flashing, release generation, commits and publication were not performed.
