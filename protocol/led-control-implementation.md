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
Phase options show 0°, 30°, 60°, 150° without approximation marks.

The five common presets include Both as configured. Their relative position follows
the actual policy pair, including matching results from other brightness commands.
Both-relative advances each target independently. Indicator brightness retains the
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
region, not a measured hardware high-water mark. Flash headroom is tight.

Successful `pio run -t releases` exports:

- `releases/ch552-macropad-3-key-dirty-3fda45b8.hex`
- `releases/ch552-macropad-6-key-dirty-3fda45b8.hex`

The dirty suffix identifies uncommitted firmware sources; it is not a new commit ID.
These replace the prior checked-in release pair in the reviewable diff.

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
