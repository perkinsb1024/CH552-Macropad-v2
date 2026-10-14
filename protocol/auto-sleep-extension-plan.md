# Auto-Sleep Extension Investigation Plan

Recorded October 13, 2026. Updated October 14, 2026: the four selected settings
are implemented in development format v15. Firmware checkpoint: `478e2cf`.
See [Implementation Results](auto-sleep-extension-results.md) for measured costs
and validation. The earlier alternatives below remain investigation history.

## Selected Settings

Preserve per-layer enablement, one profile-wide timeout and interval resets on
effective layer changes. Retain format v15 and the current experiment branch.
Header byte 6 uses bits 0–1 for **Sleep Timeout** (15, 30, 60, 120 minutes), bit 2
for **Consume Wake Input**, bit 3 for **Show Layer Indicator** and bit 4 for
**Dim Instead of Off**. Bits 5–7 remain reserved. New profiles default to `0x0D`,
preserving former behavior. Configurable **Dim Brightness** was declined;
dimming reuses **Layers and Keys Dim** and its existing fixed brightness.

The header plan is [Header Repacking Target and Firmware Plan](header-repacking-plan.md).
The historical fixed-timeout baseline and feasibility analysis follow.

## Goal

Evaluate whether selectable **Auto-Sleep** intervals of **15 Minutes**,
**30 Minutes**, **1 Hour**, and **2 Hours** justify additional configuration
storage and firmware code. Preserve the existing fixed-timeout implementation
as the baseline and a valid outcome if the extension provides insufficient value.

The selected target allocates five sleep-setting bits within a repacked nine-byte
header, retaining the current payload capacity. It uses a single-byte marker,
CRC-16 at bytes 7–8, a five-bit chord count and eight **Chord Window** choices
from 20ms through 90ms. Three bits remain reserved within the sleep-settings byte.
The existing fixed-timeout behavior was retained as the baseline for measuring extensions.

## Original Fixed-Timeout Baseline

- The saved image is 128 bytes, with a nine-byte header.
- Each layer enables **Auto-Sleep** through layer-option bit 1.
- The configurator already offers profile-level **On**, **Per Layer**, and **Off**
  controls. **On** and **Off** apply to every layer, so the usual profile-wide
  experience does not require changing the stored representation.
- The timeout is 440 ticks of 4.096 seconds: 30 minutes 2.240 seconds.
- Debounced physical presses and completed encoder detents restart the interval;
  releases, held inputs and USB traffic do not.
- Effective layer transitions restart the interval, preserving a pending wake.
- Expiry applies **Both Off**. The next physical input applies
  **Both as Configured**, requests the current layer indicator, and is consumed
  along with its release.
- The built-in timer does not consume any of the four user-defined
  **Timed Actions** or additional saved configuration bytes.

See [Auto-Sleep Investigation](auto-sleep-findings.md) and the standalone
[Format v15 Reference](config-v15.md) for implementation and behavior details.

## Timeout Feasibility

The existing timer supports 1–2,048 ticks, approximately 2 hours 20 minutes at
its maximum. All proposed choices fit without widening its counter.

| Choice | Ticks | Nominal Interval |
| --- | ---: | --- |
| **15 Minutes** | 220 | 15 minutes 1.120 seconds |
| **30 Minutes** | 440 | 30 minutes 2.240 seconds |
| **1 Hour** | 879 | 1 hour 0.384 seconds |
| **2 Hours** | 1,758 | 2 hours 0.768 seconds |

These are proposed rounded tick counts, not measured new implementations.
The current timer's quantization, foreground delay and oscillator accuracy still
apply. Four timeout choices require two configuration bits; enablement is separate.

## Maximum Capacity Findings

The tenth-header-byte comparison below is retained as historical analysis. The
selected nine-byte target avoids those capacity losses. Its reduced chord-count
field represents every currently valid profile, including global chords; see the
capacity proof in the [header plan](header-repacking-plan.md).

Using the formula and assumptions in
[Action Capacity](../documentation/Action%20Capacity.md): no text, timers or
macros, unchanged layer sizes, and three bytes per chord.

`Maximum layer-specific chords = min(key pairs × layers, floor((128 − header bytes − layer bytes × layers) / 3))`

Three-key layers occupy 15 bytes and contain six fixed physical-input action
slots. Six-key layers occupy 22 bytes and contain nine fixed slots. Fixed slots
include the encoder press and both rotation directions.

| Pad | Layers | Total Slots With 9-Byte Header | Total Slots With 10-Byte Header |
| --- | ---: | ---: | ---: |
| 3-key | 1 | 9 | 9 |
| 3-key | 2 | 18 | 18 |
| 3-key | 3 | 27 | 27 |
| 3-key | 4 | 36 | 36 |
| 3-key | 5 | 44 | 44 |
| 3-key | 6 | 45 | 45 |
| 3-key | 7 | 46 | 46 |
| 6-key | 1 | 24 | 24 |
| 6-key | 2 | 43 | 42 |
| 6-key | 3 | 44 | 44 |
| 6-key | 4 | 46 | 46 |
| 6-key | 5 | 48 | 47 |

For the documented optimal layout, one global **Relative Layer: +1** chord
provides layer switching. The totals below include that chord once, with the
remaining chord slots available for other actions.

| Maximum Capacity | 9-Byte Header | 10-Byte Header |
| --- | ---: | ---: |
| 3-key total action slots | 46 | 46 |
| 3-key usable slots after one layer-switching action | 45 | 45 |
| 6-key total action slots | 48 | 47 |
| 6-key usable slots after one layer-switching action | 47 | 46 |

The current three-key maximum leaves two bytes free, so the extra byte fits.
The current six-key maximum fills all 128 bytes and would lose one chord/action
slot. Its two-layer maximum also loses one slot; all other listed counts remain
unchanged. Text and macro capacity can still decrease even where these action
totals do not change.

## Storage Options to Compare

These are historical alternatives; the user selected repacking existing header
storage, without a tenth byte or conditional settings-byte offsets.

The [DataFlash Header and CRC Investigation](dataflash-header-crc-investigation.md)
records additional ways to reclaim existing header storage, marker/version layout
identification, corruption mechanisms and measured CRC-8/CRC-10 implementations.
It leaves the active firmware and configuration format unchanged.

| Option | Saved Storage Cost | Assessment |
| --- | --- | --- |
| Retain current behavior | No additional bytes | Already supports profile-wide enablement; simplest outcome if timeout choices are not valuable enough. |
| Required tenth header byte | One byte for every profile | Fixed setting address and constant layer offsets; likely the simplest extension. |
| Optional settings byte | One byte only when present | Needs a presence rule, conditional bounds/offsets and validation; potentially more firmware code to preserve one byte for other profiles. |

A required byte stays within the 128-byte image; it does not make the image or
DataFlash writes 129 bytes. It reduces payload capacity from 119 to 118 bytes.

An optional byte could follow the layers to preserve their fixed starting
offsets. Chords, timers, strings and macros would still need to account for its
presence. Determine an unambiguous presence encoding before measuring this
approach; no presence flag or exact layout has been selected.

Firmware size differences between the proposed extensions are expectations,
not measured results. The current-implementation measurements are 14,210/14,208
flash bytes for six-/three-key builds against a 14,336-byte limit, leaving
126/128 bytes free. Total external RAM allocation remains 752/743 bytes, and
linker-reserved stack capacity is 90/93 bytes. Rebuild the baseline before
evaluating candidates. Consult
`potential_optimizations.md` before choosing optimizations and preserve all
existing features and stack capacity.

## Global Versus Per-Layer Enablement

The user is willing to consider truly global **Auto-Sleep**, but has not selected
it. Its benefits would be simpler semantics and potentially simpler firmware;
the existing profile controls already provide most of its UI convenience.

A global representation could use one enable bit and two timeout bits in the new
byte, leaving five bits reserved and freeing layer-option bit 1. Alternatively,
three bits could encode disabled plus the four timeout choices. Measure the
encodings rather than assuming equal firmware cost.

If global behavior is chosen, consider letting inactivity continue across layer
changes. Removing the current per-layer enable check and built-in layer-reset
special case may offset some selection code, but savings are unmeasured.
Decide this behavior explicitly, including layer changes caused by timers or
macros. Physical input should still restart inactivity.

Per-layer enablement is useful when layers have different roles:

- Presentation or performance controls should execute the first input after a
  long pause immediately, avoiding a consumed wake input.
- A status or mode layer may need persistent LEDs to communicate the selected
  application, audio routing or control mode.
- An ambient lighting layer may intentionally stay illuminated while ordinary
  shortcut layers sleep.
- Occasional media controls may tolerate a wake-only input while work controls
  need immediate response.
- Layers without an **Always On** indicator can look identical when awake and
  asleep. The user cannot tell whether the next input will execute its binding
  or be consumed by waking the pad. Per-layer opt-out avoids this invisible
  wake-only state on layers that provide no persistent indication.

These support per-layer opt-out more strongly than different timeouts per layer.
Preserving per-layer enablement with one profile-wide timeout is another candidate.
Migrating mixed enabled/disabled layers to global enablement cannot preserve every
old behavior; select and explain a conversion policy if that option proceeds.

## Other Settings Worth Considering

These are candidates, not a commitment to fill the new byte.

| Setting | Bits | Value and Open Questions |
| --- | ---: | --- |
| **Consume Wake Input** | 1 | Highest-priority companion candidate: wake only versus wake and execute. Verify press/release handling, encoder input, one-shot layers and action ordering. |
| **Dim Instead of Off** | 1 | Potentially useful for retaining a faint indication. Existing presets are a starting point; specify whether both indicator and pressed-key policies dim. |
| **Dim Brightness** | 2 | Useful beyond sleep because dimming is currently fixed. Measure rendering cost and define preview/effect interactions. |
| **Show Layer Indicator on Wake** | 1 | Makes the existing reminder optional; probably lower value than timeout or input behavior. |

Prefer implementing only settings with demonstrated value and leaving other bits
reserved. Spare DataFlash bits do not imply free firmware behavior.

## Original Investigation and Implementation Sequence

1. Implement and validate the approved nine-byte header using the
   [firmware plan](header-repacking-plan.md), initially preserving the current
   sleep behavior. There is no payload-capacity loss from the selected layout.
2. Define the five sleep-setting bits, defaults and behavior before implementing
   them. Decide per-layer versus global enablement and any wake/dim controls;
   the header allocation alone does not choose those semantics.
3. Record a fresh baseline revision, working-tree state, flash/RAM/stack results
   for both pads, and regression results. Use temporary build outputs.
4. Prototype the smallest timeout-only candidate first. Measure code and memory
   costs; add companion settings only after their value and cost are understood.
5. Verify all presets, disabled behavior, layer transitions, pending wake,
   consumed versus executed inputs if supported, resets, and coexistence with
   all four user timers. Check exact-capacity and malformed image boundaries.
6. Before adopting a layout change, define format identification and migration.
   Follow the outgoing-format archive requirements before changing the active
   configurator. Preserve existing archives and checked-in releases.
7. Update encoding/decoding, storage accounting, comparisons, undo/redo,
   profile/live views, capacity documentation and the complete format reference.
   Run the required build and shared deployment gate after relevant changes.
8. Present measured costs and final capacity effects before selecting the
   implementation. Follow project approval requirements if fitting requires
   any feature cuts or degradations.

The original investigation did not authorize implementation. The October 14
request subsequently authorized implementing the selected settings under the
experiment guidelines, including firmware and configurator checkpoints. It did
not request release generation, flashing, push or deployment.
