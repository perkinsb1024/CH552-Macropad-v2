# Auto-Sleep Extension Results

Implemented October 14, 2026 on `experiment/v15-auto-sleep`, starting from clean
`fdacbfd`. Firmware checkpoint: `478e2cf`. Format v15 remains in development.
The [complete format reference](config-v15.md) describes current behavior;
[the extension plan](auto-sleep-extension-plan.md) preserves the investigation.

## Selected Behavior

Header byte 6 now assigns bits 0–1 to **Sleep Timeout**, bit 2 to **Consume Wake
Input**, bit 3 to **Show Layer Indicator** and bit 4 to **Dim Instead of Off**.
Bits 5–7 remain reserved. Timeout selectors 0–3 mean 15, 30, 60 and 120 minutes,
using 220, 440, 879 and 1,758 ticks of 4.096 seconds. New profiles default to
`0x0D`: 30 minutes, consume enabled, reminder enabled and dim disabled.
Per-layer enablement and layer-transition interval resets are preserved.

Dimming uses **Layers and Keys Dim**, retaining existing fixed brightness and
indicator behavior. Configurable **Dim Brightness** was explicitly declined.
Wake always restores **Both as Configured** before an unconsumed binding runs.
Consumed input preserves one-shot state; executed input follows normal binding,
hold, release, chord and one-shot behavior. User timers keep their saved order
and can independently consume the same input. The optional reminder changes
only the built-in wake request, leaving explicit layer selections intact.

There is no new byte, runtime timer slot, action renumbering or payload loss.
The previous B/v15 checkpoint's byte 6 was provisional zero. Such raw images
now decode as 15 minutes, wake-and-execute, reminder off and LEDs off; there is
no discriminator to migrate them automatically. Earlier development hardware
was already designated for erase. Missing JSON/draft fields and legacy MP
imports receive the former 30-minute, consume-on, reminder-on, dim-off defaults.
Published formats and their frozen configurators remain unchanged.

## Measured Cost

Native CH55xDuino 0.0.25 and SDCC build.13407_4, size optimization, small model,
24MHz, 148 USB DMA bytes, preview enabled, real 14,336-byte application limit:

| Candidate | Six-Key Flash | Three-Key Flash | Six-/Three-Key Stack |
| --- | ---: | ---: | --- |
| Baseline `fdacbfd` | 14,136 | 14,132 | 90 / 93 |
| Timeout Only, 16-Bit Lookup | 14,198 | Not measured | 90 / Not measured |
| All Four Settings, 16-Bit Lookup | 14,236 | Not measured | 90 / Not measured |
| All Four Settings, Byte Lookups | 14,198 | 14,194 | 90 / 93 |

The final implementation adds 62 bytes per variant and leaves 138/142 bytes
free. No feature cuts or stack reduction. External allocations remain 105
paged bytes, 365/356 ordinary XSEG bytes, a 134-byte absolute image/runtime
buffer, and 752/743 total external bytes including USB DMA.

Two four-byte code-memory lookup tables hold the low interval-minus-one byte
and already-positioned high counter bits. This removes the 16-bit index and
shift work, saving 38 measured bytes on six keys compared with the complete
16-bit candidate. No isolated three-key saving is claimed. The excluded local
`potential_optimizations.md` records dependencies and independent application.
Alternates are preserved as `/private/tmp/macropad-sleep-ext-timeout.inc` and
`/private/tmp/macropad-sleep-ext-first.inc`; native outputs use the corresponding
`baseline-six`, `baseline-three`, `timeout-six`, `first-six`, `byte-six` and
`byte-three` suffixes under `/private/tmp/macropad-sleep-ext-`.

## Validation

Firmware source at `478e2cf` passes both real-limit native builds, linked layout
and startup checks, and the complete host suites with preview enabled and
disabled. Tests cover all 32 combinations, exact interval boundaries, dim/off
presets, wake consumption and execution for keys, encoder button and both
rotation directions, release and one-shot/hold behavior, restore-before-binding
order, optional reminders across all indicator modes, disabled layers, pending
wake across layer changes, reset cancellation and coexistence with all four
user timers. Existing configuration, capacity, protocol, storage, macro, USB,
layout and bootloader regressions also pass.

Configurator integration adds the four ordered controls to **Profile Settings**,
binary and JSON codecs, missing-field draft migration, validation, comparisons,
undo/redo and saved live-view summaries. It includes firmware-cross-checked
round trips for all 32 combinations on both geometries.

The integration gate passed on `478e2cf` with the configurator/documentation
working changes present: 691 configurator tests, 89 uploader tests, TypeScript,
production editor/live-view/site build and all 13 frozen archive manifests.
A private browser session at the production preview verified all four timeout
choices and defaults, then saved a two-hour profile with consumption and
reminder disabled and dimming enabled. The simulator reported that all 128
bytes matched on readback. Storage capacity stayed unchanged.

Hardware validation remains outstanding. This task generates no releases,
flashes no hardware and publishes no changes. Existing `releases/` and frozen
archive files are preserved.
