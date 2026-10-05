# LED control implementation, configuration version 6

Implemented the complete agreed command set with no feature simplification or
removal. Both variants retain color preview, invalid-config blinking, all existing
HID actions, and policy matching for relative common presets. No remembered-preset
fallback was needed. Changes remain uncommitted on `experiment/led-brightness-action`;
no branches were pushed and main was not committed.

## Delivered behavior

Action F uses its auxiliary nibble for the value/signed step and its full parameter
byte for the command. All 13 commands and all 112 valid payloads are implemented:
absolute/relative rainbow phase and speed, indicator/key/both brightness, restore
all, and absolute/relative common presets. Every relative command accepts -7..-1
and +1..+7. Absolute brightness uses Off=0, Dim=1, Bright=2, Configured=F.
Phase options show 0°, 30°, 60°, and Variable; the profile selector labels the
fourth option “Variable — Scattered colors.”

The five common presets include Both as configured. Their relative position follows
the actual policy pair, including matching results from other brightness commands.
Current firmware makes both-relative step once from the brighter resolved policy
and assigns the result to both targets. This supersedes the original independent
advancement; the encoding remains unchanged. Indicator brightness retains the
saved visibility mode; indicator Off releases animation priority; key Off reveals
idle background. Both Off suppresses ordinary lighting. Preview and bootloader/error
feedback remain visible. Runtime changes never alter the active image or DataFlash.

The browser writes binary/JSON v6, migrates binary 2–5 and JSON 1–5, preserves v5
rainbow settings and metadata, and recovers older drafts without changing archived
namespaces. Old D/E/F map to new C/D/E throughout bindings and chords. The existing
GET_INFO format version gates compatibility; its payload and transport v1 are unchanged.
The frozen v5 editor is added alongside v2/v3/v4 and has checksummed provenance.
See [the v6 wire specification](config-v6.md) for encodings and lifecycle details.

## Measured firmware size

Measurements use the installed CH55xDuino 0.0.25 SDCC build.13407_4 toolchain,
`--opt-code-size`, and the existing linker limit of 14,336 bytes, with
`ENABLE_COLOR_PREVIEW=1`. Baseline is a fresh build before implementation, not
previously checked-in HEX artifacts.

| Variant | Baseline flash | Final flash | Net increase | Flash free | xRAM used / available | Stack region |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,189 | 14,328 | 139 | 8 | 621 / 876 | 138 |
| Six-key | 14,190 | 14,327 | 137 | 9 | 630 / 876 | 138 |

xRAM grows by four bytes per variant (baseline 617/626): one byte each for current
phase, speed, indicator policy, and key policy. This unpacked array produces smaller
code than the initially explored packed state. Policies use internal Configured=3,
while the action wire value remains F. Stack figures are the linker's available
region for those historical builds. Subsequent [hardware validation](#stack-usage-hardware-validation)
measured 36 bytes peak observed usage under heavy workloads. Flash headroom is tight.

Successful `pio run -t releases` exports:

- `releases/ch552-macropad-3-key-dirty-3fda45b8.hex`
- `releases/ch552-macropad-6-key-dirty-3fda45b8.hex`

The dirty suffix identifies uncommitted firmware sources; it is not a new commit ID.
These replace the prior checked-in release pair in the reviewable diff.

## Scattered-colors drift experiment

The fourth spacing preset shows “Variable — Scattered colors” and uses the tuned
starting increment of 109 hue steps. JSON continues to encode this preset as 150°. Each LED gains an extra hue step at a different rate
(once every 4–128 rainbow frames), changing relative phases without abrupt color
jumps. `RAINBOW_DRIFT_MASK` controls the first interval: 3 means four frames;
7 means eight frames (the original rate); 1 means two frames. Each subsequent
drift slot doubles the interval; a small lookup table assigns slots to keys.
Six-key intervals in key order are 4, 32, 8, 64, 16, and 128 frames, producing
fast/slow/fast over slow/fast/slow. Three-key intervals are 4, 16, and 8 frames. Use masks of the form 2^n−1, with n at least 1 and the
last interval no greater than 256 frames. The other spacing presets stay fixed. Drift state resets with the base hue;
previews use the saved preset and current drift.

Fresh builds with the same toolchain and preview enabled:

| Variant | Before drift | With drift | Flash free | xRAM used | Stack region |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,328 | 14,331 | 5 | 619 | 126 |
| Six-key | 14,327 | 14,333 | 3 | 628 | 123 |

The alternating layout adds 7 bytes on three-key and 10 bytes on six-key boards
compared with assigning drift rates in key-number order (14,324/14,323 bytes).
Stack and xRAM usage are unchanged by that reassignment.

The drift state uses three/six bytes of indirect internal RAM. Moving the hue and
frame timer from xRAM into direct internal RAM and deriving each falling color
ramp by complementing the rising ramp offsets the added flash cost. The stack
region is smaller than the previous 138 bytes. Subsequent
[hardware validation](#stack-usage-hardware-validation) measured 36 bytes peak
observed stack usage under heavy workloads. Host renderer checks cover both variants, smooth transitions across
drift and timer wraps, unchanged fixed presets, saved-preset previews, and reset.
Build outputs are temporary; checked-in release artifacts were preserved.

### Stack usage hardware validation

Hardware validation is complete: the user measured a peak observed stack usage
of **36 bytes**, even under heavy workloads. Against the current documented
120-byte six-key and 123-byte three-key linker capacities, this leaves
**84–87 bytes** of headroom. The earlier capacity figures in this document are
historical build measurements; the hardware result is a subsequent validation.

The 36-byte result is the peak observed under the tested workloads. Linker
capacity figures continue to describe available space rather than runtime usage.

## Optimizations retained

The first full three-key implementation used 15,006 bytes. Behavior-preserving
optimizations reduced it by 678 bytes, without relying on removal of preview:

- Resolve physical geometry at compile time under SDCC, while host validation still
  exercises both variants. Narrow products only when their documented bounds permit
  it, keeping the total capacity calculation 16-bit. This eliminates a 16-bit multiply
  library dependency without accepting wrapped malformed images.
- Share LED target iteration and relative stepping. Bias by whole cycles to perform
  unsigned subtraction rather than signed division/remainder. Use boolean storage
  and avoid expressions that accidentally generate 16-bit arithmetic.
- Share descriptor transfers between initial SETUP and subsequent IN tokens. Use
  explicit code-memory pointers plus a RAM-transfer flag for GET_REPORT, preserving
  its multi-packet behavior while avoiding generic-pointer overhead.
- Compute HID queue/report pointers once per operation. Remove the internal redundant
  queue-full check only where all callers already check it inside their critical section.
- Emit GET_INFO from a constant table, share response-header copying, and use a shared
  CRC shift with conditional polynomial XOR. All externally visible bytes are preserved
  except the intentional configuration version/action-map changes.

The SDCC manual was consulted for compiler options; allocation-search flags documented
for other targets were not used as an assumed MCS51 optimization:
[SDCC manual](https://sdcc.sourceforge.net/doc/sdccman.pdf).
ASCII table trimming was measured and discarded because it increased final code size.

## Verification

- `python3 tests/run_host_tests.py`: configuration, action, protocol/storage, USB,
  and physical-input/renderer suites pass (input suite runs both variants).
- Firmware and browser independently test all 4,096 LED command/value payloads on
  both variants and agree on the 112 accepted combinations. Unknown commands,
  invalid absolute values, relative zero/-8, and nonzero restore-all values fail.
- Renderer tests cover visibility, every brightness policy pair, held keys, blink
  dark phases, all relative deltas, all common presets, unmatched entry, restores,
  unchanged active-image bytes, hue preservation, and preview bypass. Preview phase
  and timing use saved defaults even when runtime phase/speed and brightness differ.
- Action tests cover immediate dispatch with USB blocked, encoder bursts without
  HID queue/drop-counter impact, held-key non-repetition, and one-shot LED chords.
  Existing pointer holds are checked after the D/E renumbering.
- Full web suite: 229 tests across 24 files pass, including the editor suite
  exercising every command, option, and valid default transition.
  Migration tests include v5 flash on v6 firmware followed by explicit save/readback,
  and old firmware routed to archives before reading or writing profiles.
- `npm run build`: TypeScript checking, production bundling, all four archive checksum
  verifications, and beta uploader packaging of both v6 HEX files pass.
- `git diff --check` passes.

No hardware was flashed. Timing, USB, and renderer behavior were tested with host
register/USB stubs and the web simulator; physical USB enumeration, LEDs, and timing
on actual three-key/six-key hardware remain the final hardware checks.

## Implementation boundary

The renderer's internal `firmwareLedAction` entry point requires validated arguments,
as documented in its header. Physical dispatch only reaches it through validated
configuration bindings. Malformed wire payloads are rejected at configuration
validation; the helper does not duplicate that validation. This differs from the
plan's additional defensive behavior for hypothetical callers outside validated paths.
There are no such production callers. Future callers must preserve this precondition.

## Preset / configured toggle extension

Added command `0D` (`commonPresetToggle`), accepting preset indices 1..4. The
editor adds “Toggle preset on/off” and reuses the setting dropdown under
“Preset,” defaulting to Layers off, keys dim. Configured itself is excluded.
Matching the current brightness policy pair restores both configured policies;
any other pair applies the selected preset. Phase and speed are preserved, with
no remembered toggle state or additional persistent RAM.

Fresh temporary builds with the same toolchain, preview enabled, and the normal
14,336-byte linker limit:

| Variant | Before toggle | With toggle | Flash free | xRAM used / available | Stack region |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,331 | 14,321 | 15 | 619 / 876 | 128 |
| Six-key | 14,333 | 14,325 | 11 | 628 / 876 | 125 |

The net reduction comes from returning the relative nibble's low three bits as
the internal validation truth value, checking only the sign of validated nonzero
relative steps, and storing the relative flag as a byte to avoid SDCC boolean
conversion overhead. Toggle shares the packed policy-pair comparison already
used for relative preset matching. No existing lighting features were removed.
Stack regions are historical linker capacities. Subsequent
[hardware validation](#stack-usage-hardware-validation) measured 36 bytes peak
observed usage under heavy workloads.

Host suites pass, including both variants and all 4,096 payloads (116 valid).
Toggle tests cover all four selectable presets from every policy pair, repeated
toggles, preservation of phase/speed, and unchanged active configuration bytes.
All 234 browser tests and the production build pass, including valid editor
defaults, configured-endpoint exclusion, and binary/JSON toggle round trips.
`git diff --check` passes. Browser visual inspection was unavailable because no
supported browser surface was connected; editor rendering and interaction were
checked through the existing Inspector tests.

Command `0D` requires updated firmware: earlier v6 firmware rejects it, while
existing v6 profiles remain compatible with this extension. No hardware was
flashed or release artifacts generated. Checked-in releases were preserved;
the uploader packaging check still uses those existing releases.

## Conditional indicator preset feasibility (not retained)

See the [reimplementation guide](conditional-indicator-preset.md) for exact firmware
steps, the saved prototype patch, editor changes, and required tests.

Prototyped an additional preset with indicator policy 4: dim blink/timed
indications, suppress always-on background, and leave key brightness configured.
It used the existing runtime policy byte (no additional persistent RAM), widened
internal preset packing to three indicator bits, appended wire preset index 5,
and extended set/toggle validation and relative preset cycling. Existing wire
preset indices retained their meanings. No browser changes were made.

Temporary builds with the normal 14,336-byte limit measured:

| Variant | Working toggle baseline | Conditional preset prototype | Over limit |
| --- | ---: | ---: | ---: |
| Three-key | 14,321 | 14,352 | 16 |
| Six-key | 14,325 | 14,356 | 20 |

Both linker checks failed. The prototype added 31 bytes per variant; the six-key
result exceeded the user's approximately 16-byte over-limit cutoff. The firmware
and validation edits were restored exactly to the working toggle implementation.
The new preset was not retained or behavior-tested. No release artifacts were
changed and no hardware was flashed for this experiment.

## Synchronized relative-both brightness

Current firmware resolves the indicator and key brightness policies, selects the
brighter value, applies the signed step once through Off / Dim / Bright, and stores
the same concrete result for both targets. Configured indicator brightness comes
from the current layer's saved brightness bit, regardless of visibility mode;
configured key brightness resolves to Bright. Individual relative controls and
common-preset cycling retain their existing behavior. The command remains `09`
with the same signed nibble; existing profiles require no conversion, but earlier
firmware must be updated to obtain the synchronized behavior.

Fresh temporary builds with CH55xDuino 0.0.25, SDCC build.13407_4,
`--opt-code-size`, `ENABLE_COLOR_PREVIEW=1`, and the 14,336-byte limit measured:

| Variant | Before synchronization | Updated flash | Increase | Flash free | Contiguous xRAM free | Stack capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three-key | 14,201 | 14,259 | 58 | 77 | 231 | 123 |
| Six-key | 14,205 | 14,263 | 58 | 73 | 222 | 120 |

Before synchronization, the README documented 135 / 131 bytes of flash headroom,
giving the baseline figures above. The first synchronized implementation added
74 bytes per variant. Normalizing both policies to the brighter resolved level
before using the existing relative cycle saves 16 bytes, reducing the net cost to
58 bytes without changing the behavior. More compact loop variants failed internal
RAM allocation and were not retained.

RAM allocation and stack capacity are unchanged. Stack capacity is the linker's
allocation; subsequent [hardware validation](#stack-usage-hardware-validation)
measured 36 bytes peak observed usage under heavy workloads, leaving 84–87 bytes
of headroom against these capacities. Both production builds passed the memory-layout
checks. Build outputs were kept in temporary directories; release files were not
regenerated.

The firmware host suites passed with preview enabled and disabled, including both
hardware variants. The brightness regression covers all 16 starting policy pairs,
all 14 signed steps, both configured indicator brightnesses, and all four indicator
visibility modes after selecting a different layer. It checks synchronized results,
individual-target behavior, hue/speed/phase preservation, and unchanged active
configuration bytes. All 20 focused LED configurator tests also passed. The
configuration overview, README, protocol documentation, and current editor help
describe the updated behavior; the v6 specification labels its original semantics
as historical.
