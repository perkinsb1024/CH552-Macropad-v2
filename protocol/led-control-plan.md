# LED control action `0xF`: investigation and implementation plan

Status: implemented using config version 6. See [implementation results and measured flash](led-control-implementation.md). The design investigation and baseline measurements below are retained for context.

## Finding

**Yes: the existing auxiliary and parameter fields can accommodate every requested command, including absolute values and relative steps, without increasing the two-byte action record or the 128-byte configuration image.** There is also room for reverse steps, restoring configured settings, a combined reset, and future commands.

The recommended design uses the full parameter byte as a command opcode and the auxiliary nibble as its value or signed step. Brightness actions set runtime policies; they do not rewrite the saved profile. Rainbow actions select among the existing four phase-spacing and speed presets. Common presets set both brightness policies together and provide a five-position dark-mode cycle that includes returning to configured behavior.

The encoding is straightforward. Fitting the implementation in program flash is the main uncertainty: existing release build reports have only 146–147 bytes free. Firmware size must be measured during implementation; field capacity alone cannot establish implementation feasibility.

## What exists today

| Area | Evidence and implications |
| --- | --- |
| Action record | [Format v5](config-v5.md): byte 0 bits 0–3 are the action type; bits 4–7 are auxiliary data; byte 1 is the parameter. Action types occupy a nibble, not a separate full byte. Proposed v6 LED Control uses type `0xF`. |
| Available capacity | Fixing the type to `0xF` leaves 12 bits: 16 auxiliary values × 256 parameters = **4,096 payload combinations**. |
| Reserved action | [config.h](../src/config.h) has no `CONFIG_ACTION_LED_CONTROL`; [config.c](../src/config.c), `actionValid()`, rejects type C through its default branch. The editor codec also rejects it. |
| Rainbow phase | [CH552_Universal_Macropad.ino](../CH552_Universal_Macropad.ino) uses header byte 8 bits 4–5 to select hue spacing increments `0, 21, 42, 85`: 0°, 30°, 60°, 120°. This controls spacing between LEDs, not the current shared rainbow hue. |
| Rainbow speed | Header byte 8 bits 6–7 select intervals `4, 6, 10, 18` ms: Extra fast, Fast, Slow, Extra slow. |
| Indicator brightness | Each layer's option bit 0 selects bright or dim. Dim uses `dimIndicatorComponent(v) = (v >> 4) \| (v != 0)`, rather than a percentage setting. |
| Indicator visibility | Layer option bits 2–3 select None, Timed on, Blink by layer, or Always on. Brightness and visibility are distinct. |
| Pressed-key brightness | Ordinary pressed-key colors currently render at full brightness. There is no saved key-brightness setting. Palette 15 means Off for a key, but Rainbow for an enabled layer indicator. |
| Composition | Timed/blinking indicators override pressed-key colors, including fully dark blink phases. Otherwise pressed-key colors override idle indicators. Transparent-black keys can fall through to their idle background. |
| Dispatch | [actions.c](../src/actions.c), `runAction()`, handles layer changes and toggles immediately; most output actions go into a bounded queue. Layer changes clear queued playback. |
| Configuration lifecycle | `firmwareApplyConfig()` resets actions, animation timers, and hue on startup, successful configuration commit, and USB reset via `protocolPoll()`. |
| Capability reporting | [protocol_firmware.c](../src/protocol_firmware.c), GET_INFO, sends action mask `0xFFFF` even though C is invalid. That mask cannot distinguish existing firmware from firmware supporting this proposal. |

## Recommended wire format

The existing fields keep their physical locations and names: the auxiliary field is still byte 0's high nibble, and the parameter field is still byte 1. For LED actions only, their **meanings** become value and command respectively; other action types retain their existing encodings.

```text
Record byte 0: [ auxiliary value: 4 bits ][ action type: 1111 ]
Record byte 1: [ command opcode: 8 bits ]

byte0 = ((value & 0x0F) << 4) | 0x0F
byte1 = command
```

This gives **256 commands with 16 value encodings each**, using the same 12 payload bits and two-byte record. Thirteen commands are specified below, leaving 243 command IDs available. Command IDs retain the previous proposal's numbering, but now occupy byte 1.

| Command (parameter byte) | Meaning | Value (auxiliary nibble) |
| --- | --- | --- |
| `0x00` | Set rainbow phase spacing | `0..3` preset index; `0xF` restores configured spacing |
| `0x01` | Relative rainbow phase spacing | Signed nonzero step, `-7..+7`, wrapping over the four presets |
| `0x02` | Set rainbow speed | `0..3` preset index; `0xF` restores configured speed |
| `0x03` | Relative rainbow speed | Signed nonzero step, `-7..+7`; positive means faster, wrapping |
| `0x04` | Set layer-indicator brightness policy | `0x0` Off, `0x1` Dim, `0x2` Bright, `0xF` As configured |
| `0x05` | Relative layer-indicator brightness | Signed nonzero step, `-7..+7`; cycle Off → Dim → Bright → Off |
| `0x06` | Set pressed-key brightness policy | `0x0` Off, `0x1` Dim, `0x2` Bright, `0xF` As configured |
| `0x07` | Relative pressed-key brightness | Same signed step and brightness cycle |
| `0x08` | Set both brightness policies | `0x0` Off, `0x1` Dim, `0x2` Bright, `0xF` As configured; set both atomically |
| `0x09` | Relative both brightness policies | Same signed step; advance each independently and atomically |
| `0x0A` | Restore all configured LED settings | Only `0x0`: restore phase, speed, and both brightness policies |
| `0x0B` | Set common brightness preset | `0..4` preset index below |
| `0x0C` | Relative common brightness preset | Signed nonzero step, `-7..+7`, wrapping over all five presets |
| `0x0D..0xFF` | Reserved for future extensions | Reject every value until specified and implemented |

Signed auxiliary values use **four-bit two's complement**: `0x1..0x7` mean +1..+7, and `0x9..0xF` mean -7..-1. Reject `0x0` (zero) and `0x8` (-8) for relative commands. Decode as `delta = value < 8 ? value : value - 16`, with an explicit signed type for arithmetic. `0xF` is As configured for absolute phase/speed/brightness commands and -1 for relative commands; the command determines its interpretation.

**Restore sentinel adjustment:** the earlier full-byte value `0xFF` cannot fit in a nibble. Its wire equivalent is now `0xF` (all four bits set). Absolute brightness therefore uses Off=0, Dim=1, Bright=2, As configured=15. Prefer the semantic name `asConfigured` in JSON/model data rather than storing the old wire sentinel. Common-preset indices remain `0..4`.

For absolute commands, reject every value outside the listed values. Reject unknown command bytes before dispatch; do not mask them down to a nibble. Runtime helpers should also safely ignore malformed commands if invoked outside validated configuration paths. Encoders must validate before masking values into byte 0.

### Format-6 action-type map

| Type | Action | Change from formats 2–5 |
| --- | --- | --- |
| `0x0..0x9` | Existing None / keyboard / mouse-button / scroll / consumer / string actions | Unchanged |
| `0xA` | Set layer | Unchanged |
| `0xB` | Momentary layer | Unchanged |
| `0xC` | Relative layer | Previously `0xD` |
| `0xD` | Mouse X movement | Previously `0xE` |
| `0xE` | Mouse Y movement | Previously `0xF` |
| `0xF` | LED Control | New; previously the unused `0xC` slot was proposed |

Action-type values and LED command-byte values are separate namespaces: LED command `0x0C` still means Relative common preset, now carried by action type `0xF`. Existing field offsets and non-LED auxiliary/parameter meanings remain unchanged. Update firmware constants/dispatch/validation, editor enums/descriptors/codecs, and any tests or helpers that assume action IDs are contiguous (for example Mouse X/Y identification). Frozen editors retain their original action maps.

### Absolute rainbow options

| Auxiliary value | Phase spacing | Speed | Interval / full cycle |
| --- | --- | --- | --- |
| `0x00` | 0° | Extra fast | 4 ms / 1.024 s |
| `0x01` | 30° | Fast | 6 ms / 1.536 s |
| `0x02` | 60° | Slow | 10 ms / 2.560 s |
| `0x03` | 120° | Extra slow | 18 ms / 4.608 s |
| `0xF` | As configured | As configured | Read the relevant saved header bits |

User-facing phase labels are **0°, 30°, 60°, and 120°**, without approximation marks. These are nominal labels: firmware hue increments remain `0, 21, 42, 85` on a 256-step cycle.

These settings apply globally to every layer that displays Rainbow. Changing either does not select Rainbow, change palette colors, enable an indicator, or restart an indication. Phase-spacing changes preserve the shared hue. Speed changes preserve hue and rebase `rainbowChanged` to the current time, preventing an immediate overdue frame when switching speed.

### Absolute brightness options

| Auxiliary value | UI label | Layer indicator | Pressed keys |
| --- | --- | --- | --- |
| `0x00` | Force off | Suppress normal layer-indicator rendering and its visual priority | Suppress the pressed-key overlay, allowing the idle background to show |
| `0x01` | Force dim | Existing dim transform when the configured indicator is visible | Apply the same dim transform to ordinary pressed-key colors |
| `0x02` | Force bright | Full palette/rainbow brightness when the configured indicator is visible | Full brightness for an ordinary pressed-key color |
| `0xF` | As configured | Follow the current layer's saved full-brightness bit | Follow existing firmware behavior: bright ordinary key colors, saved Off colors and transparent-black behavior |

The same four values work for the layer-only, key-only, and both-target commands. Common-preset indices remain `0..4`; they are a separate enumeration, so preset `0x00` still means Both as configured. “As configured” for keys is an additional option beyond the requested bright/dim/off. It gives a stable restore behavior if a saved key-brightness option is added later.

**Recommended interpretation of FORCE:** override brightness across layers while preserving the layer's indication mode and color. Force bright/dim does not turn a None indicator into Always on. If “force bright” is intended to mean “show an indicator continuously even when disabled,” that is a separate visibility command; it also fits the reserved space but should not be implicit in brightness control.

“Key off” means disabling press feedback, not forcing a black rectangle over the background. “Both off” makes all normal LEDs dark. Error indication, bootloader feedback, and explicit USB color preview remain separate render paths.

## Relative semantics and selectable controls

Individual and both-brightness relative commands operate on the effective runtime value. When a target is As configured, first resolve its configured value, apply the step, then store a concrete override. Those relative commands do not automatically return to As configured; the absolute restore command does that. Common-preset relative commands instead cycle stored policy pairs, including Both as configured, as specified below.

| Target | Positive step | Negative step | Suggested editor options |
| --- | --- | --- | --- |
| Phase spacing | Next larger-spacing preset; 120° wraps to 0° | Previous preset; 0° wraps to 120° | Next / previous; step size 1, 2, or 3 |
| Speed | Next faster preset; Extra fast wraps to Extra slow | Next slower preset; Extra slow wraps to Extra fast | Faster / slower; step size 1, 2, or 3 |
| Indicator brightness | Off → Dim → Bright → Off | Reverse cycle | Next / previous brightness; step size 1 or 2 |
| Key brightness | Off → Dim → Bright → Off | Reverse cycle | Next / previous brightness; step size 1 or 2 |
| Both brightnesses | Advance each target through that cycle | Reverse each target through that cycle | Next / previous brightness; step size 1 or 2 |
| Common presets | Next preset in the five-position dark-mode cycle | Previous preset in that cycle | Next darker / previous preset; step size 1, 2, 3, or 4 |

Positive speed steps subtract from the stored speed index because index 0 is fastest. For phase use `(effectiveIndex + delta) mod 4`; for speed use `(effectiveIndex - delta) mod 4`. Use nonnegative modulo, including for negative deltas. Brightness uses conceptual ordinals Off=0, Dim=1, Bright=2, matching the absolute wire values; As configured (`0xF`) is resolved before ordinary relative stepping.

Both-relative preserves different starting brightnesses. For example, configured dim indicator + configured bright keys, followed by +1, becomes bright indicator + off keys. Users wanting both synchronized choose an absolute both action first. This avoids silently discarding one target's existing state.

For resolving configured indicator brightness, use its saved brightness bit, even when its visibility mode is None; do not treat temporary blink darkness or a timed indication's expiration as a brightness setting. Configured key brightness resolves to Bright, irrespective of whether an individual key's saved color is Off. Relative controls change a global policy, not an individual key's color or instantaneous RGB output.

The wire accepts larger steps for generality, while the ordinary UI exposes the useful distinct steps above. Larger steps wrap equivalently; multiples of four for rainbow or three for brightness can leave the effective value unchanged while materializing an override. Preserve valid imported step values, expose an advanced signed numeric control (`-7..-1`, `1..7`), and explain redundant steps rather than silently changing them. No encoder reversal heuristic is needed: clockwise and counterclockwise bindings explicitly select opposite signs.

### Common presets: absolute selection and relative dark-mode cycle

| Auxiliary value / cycle index | UI label | Indicator policy | Key policy | Packed brightness state |
| --- | --- | --- | --- | --- |
| `0x00` | Both as configured | As configured (`0xF`) | As configured (`0xF`) | `0x0F` |
| `0x01` | Layers dim, keys as configured | Force dim (`0x01`) | As configured (`0xF`) | `0x0D` |
| `0x02` | Layers and keys dim | Force dim (`0x01`) | Force dim (`0x01`) | `0x05` |
| `0x03` | Layers off, keys dim | Force off (`0x00`) | Force dim (`0x01`) | `0x04` |
| `0x04` | Both off | Force off (`0x00`) | Force off (`0x00`) | `0x00` |

Absolute common-preset selection (`command=0x0B`) writes the selected policy pair atomically and redraws once. Relative selection (`command=0x0C`) advances through this exact order with wraparound: positive steps move toward darker presets; negative steps move backward. **Both as configured participates in the relative cycle**, so +1 from Both off returns to Both as configured, and -1 from Both as configured selects Both off. Both as configured restores only brightness policies; it leaves rainbow phase and speed overrides intact.

Identify the current preset from the two stored **policies**, not the rendered RGB values or resolved brightness. Thus Layers dim / Keys as configured is distinct from Layers and keys dim even if a future saved key setting makes their output identical. Any individual or both-brightness action that produces one of these exact policy pairs establishes that preset as the relative cycle's current position. Layer changes do not change this position.

If the current pair is outside the five presets (for example, both Force bright), a +1 common-preset action enters at Both as configured; a -1 action enters at Both off. For larger steps from an unmatched pair, use index `(delta - 1) mod 5` for positive delta and `delta mod 5` for negative delta, with nonnegative modulo. Once the pair matches preset index `i`, use `(i + delta) mod 5`. This defines mixed-command behavior without a stale remembered index or an extra persistent RAM byte.

**Approved flash-saving alternative:** policy-pair matching is preferred, but is optional if measurements show a worthwhile flash saving from keeping a remembered preset index. In that implementation, initialize the index to 0 (Both as configured); an absolute common-preset action stores its selected index, and a relative common-preset action computes `(storedIndex + delta) mod 5`, stores that index, and applies its policy pair. Individual and both-brightness commands leave the remembered index unchanged, even if the resulting policies match another preset. Consequently, cycling resumes from the last common preset rather than the current brightness policies. No unmatched-pair detection or entry rule is needed in this alternative.

Reset the remembered index to 0 on restore-all and on the same power-up/configuration-apply/USB-reset lifecycle as the overrides. Ordinary layer changes and preview start/cancel preserve it. A brightness-only As configured command remains an ordinary brightness command and does not update the index. Document this distinction if the alternative ships. Measure both implementations before choosing; lower RAM use does not take precedence over fitting flash.

The UI offers each of the five absolute presets and Next darker preset / Previous preset, with useful step sizes 1–4. Default relative step is +1, making a single key or global chord sufficient to cycle all five dark-mode options. Advanced/imported nonzero signed steps use the same range as other relative commands; multiples of five leave a matched preset unchanged. From an unmatched pair, larger steps follow the entry rule above.

These presets override brightness globally while respecting existing indicator visibility modes, colors, transparent-black behavior, and render priorities. They do not turn a disabled indicator on or change rainbow settings. The preset cycle order expresses the requested dark-mode choices, but actual emitted light depends on the configured colors and which keys are pressed.

### Complete proposed editor choices

Add an **LED control** action group with these choices:

1. Rainbow phase spacing: Set 0° / 30° / 60° / 120° / As configured; or Relative next / previous with a step size.
2. Rainbow speed: Set Extra fast / Fast / Slow / Extra slow / As configured; or Relative faster / slower with a step size.
3. Layer-indicator brightness: Set Force bright / Force dim / Force off / As configured; or Relative next / previous brightness.
4. Key-press brightness: Set Force bright / Force dim / Force off / As configured; or Relative next / previous brightness.
5. Both brightnesses: Set Force bright / Force dim / Force off / As configured; or Relative next / previous brightness.
6. Restore all configured LED settings: no additional parameter control.
7. Common brightness presets: Set any of the five presets above; or Relative next darker / previous preset with a step size. Include Both as configured in both the absolute options and the relative cycle.

All are valid on physical keys, encoder button, encoder rotation, and layer-specific or global chords. Each resolved press, chord, or encoder detent executes once; holding a key does not repeat or undo it. They require no physical release and should consume a pending one-shot layer in the same way as other resolved actions.

Suggested summaries include “Rainbow spacing +1,” “Rainbow faster 1,” “Indicator: dim,” “Key LEDs: off,” “Both LEDs: configured,” and “Restore LED settings.” Clarify that relative brightness cycles and speed wraps, so the user does not expect saturation at an endpoint.

## Capacity proof and examples

| Payload category | Valid payloads |
| --- | ---: |
| Absolute phase and speed, four presets plus restore each | 10 |
| Three absolute brightness targets × four policies | 12 |
| Six relative commands × 14 signed nonzero nibble values | 84 |
| Five absolute common presets | 5 |
| Restore all | 1 |
| **Total specified valid payloads** | **112** |
| **Unassigned or invalid combinations remaining** | **3,984** |

Thirteen of 256 command IDs are used. The 243 completely unused command IDs alone provide another 3,888 combinations. Unassigned values in used commands remain reserved, not automatically valid extensions. Total raw payload capacity remains 4,096; the swap allocates that capacity to more commands and smaller values.

| Example | Record bytes (value/type, command) |
| --- | --- |
| Set phase to 60° | `2F 00` |
| Next phase preset | `1F 01` |
| Set Fast speed | `1F 02` |
| One preset faster | `1F 03` |
| One preset slower | `FF 03` |
| Force indicator dim | `1F 04` |
| Cycle indicator brightness forward | `1F 05` |
| Force pressed-key LEDs off | `0F 06` |
| Cycle pressed-key brightness backward | `FF 07` |
| Force both bright | `2F 08` |
| Restore both brightness policies | `FF 08` |
| Advance both brightnesses | `1F 09` |
| Restore configured speed | `FF 02` |
| Restore all LED settings | `0F 0A` |
| Common preset: layers dim, keys as configured | `1F 0B` |
| Common preset: both off | `4F 0B` |
| Next common preset (including configured) | `1F 0C` |
| Previous common preset | `FF 0C` |

Replacing an existing binding uses no extra image space. Adding a new chord still costs the existing three bytes: one chord identifier and two action bytes. No string-pool bytes, extra per-layer fields, or additional configuration records are needed. Maximum layer/chord capacity is unchanged.

## Runtime state and lifetime

Use global runtime overrides that survive ordinary, momentary, and one-shot layer changes. Indicator As configured is resolved against whichever layer is currently effective. This supports a global chord for lighting control without allocating state for every layer.

Keep `activeConfig` unchanged. Mutating header/layer bytes would invalidate its CRC, affect READ_ACTIVE and profile comparisons, and blur the distinction between runtime actions and saved settings. Never write DataFlash for these commands.

A compact state proposal needs only **two additional persistent xRAM bytes**:

| Byte | Bits | Meaning |
| --- | --- | --- |
| Rainbow runtime state | 0–1 | Selected phase index |
| | 2 | Phase override active |
| | 3–4 | Selected speed index |
| | 5 | Speed override active |
| | 6–7 | Reserved zero |
| Brightness runtime state | 0–1 | Indicator internal policy: Off=0, Dim=1, Bright=2, As configured=3 |
| | 2–3 | Key internal policy: Off=0, Dim=1, Bright=2, As configured=3 |
| | 4–7 | Reserved zero |

Common presets reuse the brightness byte. A five-byte `__code` table `{0x0F, 0x0D, 0x05, 0x04, 0x00}` maps preset index to its two policies; a short search derives the current index for relative commands. Reserve-zero high bits should not participate in matching. No separate persistent preset index is necessary. This adds table/dispatch/validation code and modulo-five stepping to the flash budget; measure their incremental cost separately.

For the approved remembered-index alternative, use brightness-state bits 4–6 for the index `0..4` and leave bit 7 reserved zero. This fits in the existing byte (a separate `__xdata` byte is also acceptable if it generates smaller code). Preserve index bits when individual/both-brightness commands update bits 0–3. Common-preset commands update both the index and policy pair together; renderer policy extraction masks only the relevant two bits. Initialization and restore-all still use `0x0F`, encoding configured policies and preset index 0. The five-entry table remains useful, but searching it and handling unmatched policy pairs can be omitted. Measure masking/packing costs against a separate index byte rather than assuming packing is smaller in flash.

Initialize rainbow runtime state to zero and brightness runtime state to `0x0F` (both internal policies As configured). Phase/speed getters return configured values when their active flag is clear. Translate wire brightness `0xF` to internal policy 3; preserve `0..2` directly. Reject wire values `0x3..0xE` before translation rather than accepting them by masking. Internal policy 3 resolves its configured default. Existing hue and timer variables remain in use. A dirty flag may add one byte if rendering is deferred; immediate rendering through a helper can avoid it.

Reset overrides on power-up and every `firmwareApplyConfig()` call, including successful profile commit and USB reset. This follows the existing reinitialization behavior; document that reconnecting USB can reset lighting adjustments. Do not tie LED reset to every `actionsClear()` call, since action/output cleanup and LED-policy reset have different purposes. USB preview start/cancel should preserve overrides.

Restore-all resets rainbow override state to zero and brightness state to `0x0F` but preserves current hue and the remaining layer-indicator animation duration. It rebases the speed timer and redraws immediately. It does not reapply the whole configuration or reset the active layer.

## Necessary firmware changes

### Validation and dispatch

- Add `CONFIG_ACTION_LED_CONTROL 0xF` and named command/policy constants in [config.h](../src/config.h). Add a small command-specific validation branch in `actionValid()` for both binding and chord paths. Rotation is allowed.
- Add a narrow firmware LED-action API, for example `firmwareLedAction(command, value)`, declared in a shared header. Keep LED state beside the existing renderer in the sketch, or extract LED code to a dedicated C module if size measurements justify it. Update the host-test stubs for whichever API is chosen.
- In `runAction()`, handle LED Control (F) immediately after the existing one-shot restoration logic. Do not enqueue it for USB playback: lighting needs no host report, queue space, or delay behind strings; rotation bursts should not drop LED steps under the HID queue's rotation reserve rule.
- Decode `command = second` and `value = first >> 4`, then dispatch by the full eight-bit command. Interpret the value as signed only for relative commands. Keep unrelated action decoding unchanged; existing field names do not require a physical format-layout change.
- Implement common-preset dispatch using the policy-pair table and matching rules above. Resolve the current pair at execution time, so other brightness commands cannot leave a stale cycle index. Validate absolute indices `0..4` and relative nonzero signed steps. Apply the selected pair in one update; phase/speed overrides remain untouched.
- If the remembered-index alternative saves needed flash, replace policy matching with stored-index stepping as specified above. Record the measured flash/xRAM difference and chosen behavior; do not require policy synchronization for that implementation.
- Apply both-target changes before a single redraw. No input binding or layer mutation is needed; existing chord resolution prevents double execution. Keep key releases inert for this action.

### Rendering and timers

The renderer currently uses `dim` both to identify an indicator source (including Rainbow) and to decide brightness. Simply changing that variable for dim keys or forced-bright indicators can misclassify palette 15 or bypass Rainbow. Separate **which source wins**, **whether that source is Rainbow**, and **what brightness applies**.

Use this composition order for normal LEDs:

1. If indicator policy is Off, skip indicator rendering and its priority entirely. An invisible animation must not hide pressed-key colors.
2. Otherwise retain the configured timed/blinking animation's priority, with dark blink phases fully black. Force bright/dim applies to lit phases only.
3. Outside active animation priority, render an ordinary pressed-key overlay if key policy is not Off and its saved color/transparent-black rules select one. Apply the key policy's brightness independently of the indicator's brightness.
4. Otherwise render the configured Always-on background if enabled and indicator policy permits it; apply the indicator brightness policy. If there is no background, render black.

Maintain existing opaque-Off and transparent-black semantics when key policy is As configured, Bright, or Dim. A force-key-Off policy intentionally skips the overlay, including opaque-Off keys, to disable press feedback consistently. Dim black must remain black. Brightness overrides never turn a saved Off key color into Rainbow or a visible solid color.

Keep indicator animation bookkeeping advancing while its policy is Off, so restoring brightness mid-animation shows the remaining duration and does not restart an expired indication. `startLayerIndicator()` can retain its timing behavior; `serviceLayerIndicator()` must redraw using the new policy composition.

Replace direct header-bit reads for normal rainbow spacing/speed with effective-value getters. Preserve hue and physical perimeter ordering. The loop's current rainbow eligibility expression also needs review: account for suppressed indicators and keep preview eligibility separate. Avoid divisions/general-purpose signed modulo in hot paths; normalize steps with unsigned masking for the four-preset targets and a small bounded reduction for brightness and common presets. Brightness ordinals already match concrete internal policies. Cast explicitly to avoid SDCC signed-char and negative-remainder surprises.

USB color preview should retain its requested preview brightness and saved-profile phase/speed, bypassing runtime overrides. Normal LED actions need no new USB opcode. Existing physical input already cancels preview; the action then affects normal LEDs. Invalid-config error feedback and bootloader red feedback should remain visible regardless of normal LED policies.

### Selected compatibility approach: binary/JSON format 6

**Use configuration format 6 for both binary images and JSON exports, with web-based migration of older versions.** Keep HID transport version 1 and the existing GET_INFO payload layout. Its existing configuration-version field identifies supporting firmware; no new LED capability byte is needed. Version 6 retains the 128-byte image and all existing field offsets, and renumbers the final action types to group layer actions together and place LED Control last, as specified below.

Set firmware `CONFIG_VERSION`, editor `FORMAT_VERSION`, and `JSON_VERSION` to 6. GET_INFO consequently reports format 6. Gate v6 uploads on that field, rather than the action mask: existing firmware advertises `0xFFFF` despite rejecting C. Keep the opcode table identical between firmware and editor. Format 6 must define the command set actually shipped; do not release incompatible subsets under the same version.

Firmware accepts only version 6, matching the current single-version validation design. Migration runs in the browser, avoiding firmware flash cost. After flashing v6 firmware over a device with an older saved profile, inputs remain inactive until the migrated profile is saved; the web editor must still read the saved image through READ_FLASH and offer migration even when device status marks it invalid. Do not require an active valid image or reinterpret older bytes as v6 before validation.

#### Web migration requirements

- **Binary images:** accept and validate formats 2, 3, 4, 5, and 6. Preserve the existing version-specific header and layer/chord interpretation. Validate the source CRC before migration, then decode into the current profile model and re-encode/seal as version 6 when saved. Version 1 binary import is not currently supported; preserve version 1 support through the existing JSON importer rather than inventing a binary layout.
- **JSON profiles:** import versions 1–6, preserving existing legacy transformations. Export only version 6. Preserve bindings, holds/one-shot options, layers/startup layer, chord scope and pairs, strings, palette colors, indicator settings, transparent-black behavior, names, and other supported local metadata. Reject malformed or unsupported future versions rather than silently stripping actions.
- **Rainbow defaults:** preserve v5/v6 phase and speed exactly, including speed index 0 (Extra fast). Use `sourceVersion >= 5` within the supported-version set to recognize saved rainbow bits; comparing only with the new latest-version constant would incorrectly default v5 profiles. Formats 2–4 retain their current migration defaults of 60° spacing and Fast speed. Retain existing JSON handling for missing older settings and historical speed names; do not substitute defaults for valid explicit values.
- **Drafts:** discover older draft namespaces, including format-v5, and include v5 in accepted stored `formatVersion` values. Recover/migrate through existing validation, retain metadata, and write the result into the v6 namespace. Keep the source draft available until successful recovery; a version-constant bump must not make existing drafts disappear.
- **Action migration:** decode source binary action types using their source-version map: through v5, D=Relative layer, E=Mouse X, F=Mouse Y, and C remains reserved/invalid. In v6, C=Relative layer, D=Mouse X, E=Mouse Y, F=LED Control. Preserve auxiliary flags and parameters for migrated layer/movement actions, including signed values and hold/one-shot semantics. Use semantic action objects as the migration intermediate; do not interpret an old F action as LED Control or relabel an old image without decoding it and recomputing CRC. Apply this to every key, encoder binding, and chord. JSON/drafts use named action types, so preserve those names and encode them with the v6 map when saved. Permit named LED actions only in v6 sources; older profiles gain no LED bindings and default runtime policies remain As configured.
- **Device flow:** when connected to v6 firmware with an older saved image, present a clear migration/save step and allow the user to review the migrated profile before saving. Migration itself is local; saving uses the existing commit and independent flash verification. Preserve the original device bytes until a save succeeds. Local imports and exports do not require a connected device.
- **Older firmware:** route devices reporting older supported configuration versions to their matching frozen editors, including a new `versions/format-v5/` archive captured before changing the active editor. The v6 editor does not send v6 images to older firmware or automatically downgrade LED actions. Extend the existing archive selector/list and connection routing; retain older frozen archives.

Create `protocol/config-v6.md` for the full resulting format, leaving v5 documented as historical. Update README and UI help with the firmware-upgrade → load/migrate → review/save flow. Update starter/bundled profiles to JSON v6 and retain migration fixtures for older formats. Runtime LED actions still never mutate saved configuration bytes or their CRC.

## Configurator and documentation work

Update [constants.ts](../webapp/src/model/constants.ts), [types.ts](../webapp/src/model/types.ts), [actions.ts](../webapp/src/model/actions.ts), and [validate.ts](../webapp/src/model/validate.ts). A single `ledControl` action with discriminated command/value fields can share wire code F while avoiding many separate action types. Prefer explicit strings in JSON, such as `rainbowPhaseSet`, `rainbowSpeedRelative`, and `brightnessBothSet`, plus `commonPresetSet` and `commonPresetRelative`, with named preset/policy values and numeric signed relative steps.

Update [encode.ts](../webapp/src/codec/encode.ts), [decode.ts](../webapp/src/codec/decode.ts), [json.ts](../webapp/src/io/json.ts), draft handling, action summaries, and the action editor components. Use the existing configuration-version field in [packet.ts](../webapp/src/protocol/packet.ts) and update [simulator.ts](../webapp/src/protocol/simulator.ts) to report format 6 and exercise older saved images. Gate v6 uploads and route older firmware through the existing connection/version flow. Search all exhaustive action switches so imports, copy/paste, comparison, layer warnings, and capacity computations handle the new action consistently.

The UI should explain global runtime lifetime, cycling/wrap behavior, both-relative independent advancement, common-preset cycling through configured behavior and entry from unmatched policies, and key-Off background fallthrough. The saved layer/header settings continue to be the defaults; editing a binding does not modify them. Device preview tests should cover the bypass of overrides. Create the v6 format specification, preserve [config-v5.md](config-v5.md) as historical documentation, and update [hid-v1.md](hid-v1.md), README, and relevant configurator help when implemented.

## Program-memory feasibility

Existing local build artifacts inspected, rather than newly rebuilt measurements:

| Variant | Flash used / limit | Flash headroom | xRAM used / available after USB reservation |
| --- | ---: | ---: | ---: |
| Three keys | 14,189 / 14,336 bytes | 147 bytes | 617 / 876 bytes |
| Six keys | 14,190 / 14,336 bytes | 146 bytes | 626 / 876 bytes |

Source: `.pio/build/ch552/releases/{3-key,6-key}/firmware.mem`. Both report no spare internal RAM space and a 144-byte stack region. These are baseline artifacts, not a cost estimate for LED control or proof of current-source reproducibility. Two or three new persistent bytes fit comfortably in xRAM; prefer `__xdata` rather than allocating more permanent `__data` state. Recheck compiler overlay and stack use after changes.

Validation, runtime dispatch, policy composition, signed stepping, and format-version compatibility handling will likely need more than the existing flash headroom. The exact cost is unmeasured. **Color preview is required and must remain enabled in the delivered firmware on both variants. Its removal is not an acceptable optimization, and no potential savings from removing it may be included in the available flash/xRAM budget.** Start by sharing effective-value/brightness helpers, avoiding repeated per-target branches, and measuring the approved remembered-preset alternative. Measure both variants with color preview enabled throughout; any reduced command set must preserve the preview feature and its existing behavior.

If flash is still over the limit, a fallback retains all requested targets and absolute settings, with relative commands accepting only auxiliary value `0x1` (fixed +1 cycle). Reverse/larger steps and combined reset can be staged later. This reduces validation/arithmetic requirements without changing record size or assigning conflicting wire meanings; a reduced command set must be finalized and documented before assigning the version 6 release contract; do not ship different subsets under the same configuration version. Preserve opcode allocations so a future full implementation is compatible. Do not assume this fallback saves enough flash without building it.

## Implementation sequence and acceptance checks

1. Rebuild both variants to establish current flash/xRAM baselines. Implement the opcode constants and validation, then measure their cost before expanding renderer changes.
2. Add the two runtime state bytes, effective getters, reset lifecycle, and immediate dispatch. Implement absolute policies first, then relative stepping and combined reset. Measure after each stage.
3. Refactor source selection/brightness handling, retain indicator timing and preview behavior, and add format-6 upload gating, web migration, the frozen v5 editor, and editor serialization/UI support.
4. Run host firmware tests and configurator tests/build, then build both physical variants with production flags and color preview enabled. Inspect memory reports and exercise the LEDs on hardware before releasing firmware.

Required verification includes:

- Enumerate all 4,096 LED Control (F) payloads against the proposed validator; confirm exactly 112 accepted combinations, consistent firmware/editor decisions, and round trips for valid values. Exercise buttons, rotation, and chords on both variants.
- Check every absolute preset/policy, each restore operation, +1/-1 wrapping, signed extremes, redundant steps, and malformed/reserved values. Reject relative zero/-8, absolute brightness values `0x3..0xE`, unknown command bytes, and nonzero restore-all values.
- Confirm LED controls execute while USB is busy or a string is playing, bypass queue overflow, execute once per resolved chord/detent, consume one-shot layers, and persist across layer changes.
- Cover indicator modes None/Timed/Blink/Always, bright and dim defaults, solid/Rainbow backgrounds, held keys, key Off colors, transparent black, and dark blink phases. Indicator-Off must allow key feedback; key-Off must allow background; both-Off must darken normal LEDs.
- Verify all five common presets, forward/backward wrapping through Both as configured, larger/extreme signed steps, entry from unmatched policy pairs, and interleaving with individual/both commands. Cycle identity must follow stored policies across layer changes rather than resolved output. Assert one redraw and unchanged rainbow overrides per preset command.
- For the remembered-index alternative, replace policy-matching/unmatched-entry expectations with tests that individual/both commands preserve the index, the next relative action resumes from it, common-preset absolute actions update it, and restore-all/configuration application reset it. Verify layer changes and preview preserve it, and packed index bits cannot affect renderer policies. The remaining common-preset tests still apply.
- Verify both-relative changes each starting state independently; absolute both sets them together. Restore-configured follows the new layer's saved brightness after switching layers.
- Check mid-animation updates without restarting timing, hue continuity, speed timer rebasing, timer rollover, and six-key perimeter spacing.
- Verify power-up/config commit/USB reset lifetime, preview bypass/cancellation, and visible invalid-config/bootloader feedback. READ_ACTIVE and saved CRC/image bytes must remain unchanged by runtime actions.
- Simulate GET_INFO replies reporting older config versions with action mask `0xFFFF`, and format-6 replies using the unchanged payload layout. Block v6 saves to old firmware before BEGIN_WRITE and verify archive routing. Exercise v6 firmware with invalid-for-firmware older flash images: READ_FLASH, browser migration, review/save, and verified v6 readback must work while physical inputs are inactive.
- Verify binary migration for each supported version 2–5 on both variants, JSON migration for versions 1–5, and recovery from older draft namespaces including v5. Preserve all supported settings and metadata. Test every v5 rainbow phase/speed combination to catch latest-version equality bugs; validate source CRC and reject malformed/future formats and the reserved C type in pre-v6 binary images. Explicitly test migration D→C, E→D, and F→E for all binding contexts and ensure pre-v6 Mouse Y never becomes LED Control. Verify only v6 is emitted, and v6 LED bindings survive JSON/copy-paste/import/export and draft recovery. Retain original data on migration/save failure.
- Confirm both production variants fit flash/xRAM limits with `ENABLE_COLOR_PREVIEW=1`, retain working color preview, and maintain usable stack headroom. Record actual byte costs and any functionality deferred.

## Additional commands that also fit

These are optional future proposals, not part of the valid command table above:

| Extension | Possible field use | Additional work |
| --- | --- | --- |
| Set current rainbow hue preset | One command; auxiliary `0..15` selects 16 evenly spaced hue positions | Distinct from phase spacing; decide behavior when Rainbow is not visible |
| Offset current rainbow hue | One command; signed auxiliary step `-7..+7`, optionally scaled by a fixed hue increment | Could enable color scrubbing without changing LED spacing |
| Pause/resume/toggle rainbow | One command; small auxiliary enum | Add a pause bit and explicit timer behavior |
| Set/relative indicator visibility mode | Two commands; auxiliary four-mode index / signed step | Override None/Timed/Blink/Always independently of brightness; define animation restart behavior |
| Mixed absolute indicator/key policies | One command; auxiliary packs two 2-bit policies | Set different policies in one action, including As configured through internal code 3 |

All these command IDs fit easily alongside the required set. The tradeoff is that a single command now has only four value bits: arbitrary absolute `0..255` hue values do not fit in one command. If that precision is ever needed, specify a command bank that encodes additional value bits in its IDs, or a separate action format; do not silently truncate. No requested feature needs that precision. Every user-requested command fits without relying on these extras.
