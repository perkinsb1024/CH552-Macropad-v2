# Always-on indicator inactivity sleep experiment

Status: implemented in the working tree, **over the flash limit**, not released
or flashed. The initial six-key result exceeded the user's 16-byte over-limit
cutoff. A subsequently authorized reuse/optimization pass reduced the excess to
41 bytes, so the feature still cannot fit. There is no editor control or browser
codec support for the flag yet.

## Behavior and encoding

Header byte 3 bit 6 (`0x40`, `CONFIG_HEADER_LED_SLEEP`) enables inactivity sleep.
Clear means disabled. Layer count and startup-layer bits are unchanged. Header
bit 7 remains reserved. No new action or configuration version is introduced.

When enabled, approximately 69–70 minutes without a debounced button press or
completed encoder detent suppresses **only always-on layer indication**. A key
press, encoder pushbutton press, or complete detent in either direction restarts
the timeout and redraws normal lighting. No-op bindings count as activity.
Releases and partial detents do not reset it; holding a button does not keep
resetting it. USB traffic alone is not activity.

Blink/timed layer indications, bright key overlays, error feedback, and hardware
color preview retain their behavior. Sleep is a renderer condition; it does not
change saved layer settings or runtime LED brightness policies. Thus waking
preserves an explicitly selected brightness preset. Changing/restoring LED
settings through physical bindings also wakes because those inputs are activity.
Configuration application and USB reset/reconfiguration clear inactivity state.
This is LED sleep only: scanning, USB service, and internal rainbow animation
continue; the processor does not enter a low-power sleep mode.

Earlier v6 firmware ignores header bit 6 and therefore accepts the profile but
does not sleep its lighting. This differs from unsupported preset commands, which
are rejected. The current browser decoder still rejects bit 6 as reserved, and
the encoder writes it as zero. Browser work is deferred until the size decision:
add an opt-in profile setting, binary/JSON preservation, defaults/migrations,
validation, comparison/undo reporting, and a profile-panel control with tests.

## One-byte timer

`ledIdle` is one additional direct internal RAM byte. Its low bit tracks bit 15
of the existing 16-bit `now` value; every change of that clock phase increments
the byte, giving one tick per 32.768 seconds. Bit 7 latches sleep after count 128.
The counter then stops incrementing so longer inactivity cannot wrap it awake.

This is roughly equivalent to the proposed 64 full 65.536-second periods, while
storing both counter and previous clock phase in one byte. `firmwareApplyConfig`
initializes the low bit from the current clock phase. Physical press/detent paths
mask the counter to its low bit and redraw lighting. Phase alignment and the retained low
bit make the timeout approximate: around 69–70 minutes, rather than exactly
4,194.304 seconds after every input. Detecting phase changes assumes the main loop
continues running frequently enough not to skip a 32.768-second phase.

## Initial measured cost

Normal 14,336-byte linker limit, CH55xDuino 0.0.25 / SDCC build.13407_4,
`--opt-code-size`, color preview enabled:

| Variant | Baseline flash | With LED sleep | Added bytes | Over limit | xRAM used / available | Stack region |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,321 | 14,419 | 98 | 83 | 619 / 876 | 127 |
| Six-key | 14,325 | 14,423 | 98 | 87 | 628 / 876 | 124 |

The six-key baseline was freshly rebuilt in a separate temporary source copy;
the three-key baseline matches the recorded working toggle measurement. Both new
firmware builds fail the linker size check. No flash-limit increase was used.
xRAM is unchanged; the additional direct RAM byte reduces available stack region
by one byte. These stack figures are linker capacity, not measured usage.

Temporary results are in `/private/tmp/macropad-led-sleep/0/firmware.mem` (six-key)
and `/private/tmp/macropad-led-sleep/three/firmware.mem` (three-key), which may be
removed by system cleanup. Regenerate them with the existing `build_firmware.py`
using variant arguments 0/1 and limit 14336. No release-generation command was
used, and checked-in release files were preserved.

## Reuse and optimization measurements

The retained implementation shares the renderer's existing indicator-suppression
branch, rather than replacing the brightness policy through an LED command.
That preserves timed/blink indications and the currently selected LED preset.
Button events share their redraw path; completed encoder detents share reset and
redraw handling in both directions. The clock-phase comparison explicitly narrows
the shifted time to a byte, avoiding unnecessary 16-bit intermediate operations.

| Variant | Initial prototype | Retained implementation | Bytes saved | Added over baseline | Over limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,419 | 14,373 | 46 | 52 | 37 |
| Six-key | 14,423 | 14,377 | 46 | 52 | 41 |

Both retained builds still fail the normal linker size check. RAM figures remain
as above. Temporary retained measurements are in
`/private/tmp/macropad-led-sleep/opt-six/firmware.mem` and
`/private/tmp/macropad-led-sleep/opt-three/firmware.mem`.

Calling `firmwareLedAction(CONFIG_LED_INDICATOR_SET, CONFIG_LED_OFF)` would not
preserve this feature's behavior: it suppresses all indicator modes and replaces
the selected indicator brightness policy. It also does not remove the need for an
inactivity timer, input resets, and restoring lighting on wake.

## Verification

`python3 tests/run_host_tests.py` passes, including both physical variants.
`testLedSleep` covers elapsed clock-phase counting across repeated 16-bit wraps,
no counting within an unchanged phase, saturation after expiry, opt-in background
suppression, preserved brightness policies/configuration bytes, timed/blink and
key rendering, preview bypass, no-op key wake, encoder pushbutton wake, complete
detents in both directions, and reset/application with a nonzero clock phase.
Existing configuration, action, protocol/storage, USB, and rendering tests pass.
Firmware size checks fail as stated above. Hardware behavior remains untested.
