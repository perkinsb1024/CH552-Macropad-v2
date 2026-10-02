# Timed actions investigation plan

## Goal and constraints

Investigate a new profile-wide trigger alongside physical keys, encoder inputs,
and chords. A timer interval is 1–128 ticks of 65.536 seconds, with an optional
reset on physical input. Actions repeat on successive intervals. Inactivity
timers restart on debounced presses and completed encoder detents, not USB traffic,
releases, or electrical bounce. Preserve existing actions and lighting features.
Use temporary firmware outputs only; do not generate releases or push changes.

The committed LED-sleep experiment already exceeds the 14,336-byte limit. Remove
that experiment from the timed-actions prototype so measurements compare against
the working preset-toggle firmware. Retain its source in commit 2709c23.

## Questions and semantic decisions

- Timers are global, not duplicated per layer. Resolve layer-changing actions
  against the active layer at execution time. Store action bytes with each timer.
- Interval byte encodes `(ticks - 1)` in bits 0–6; bit 7 enables input reset.
  Thus 128 is representable. Six bits can represent **1–64**, not 1–65.
- Independent periodic timers need independent phase/counters if reset flags
  differ. Up to four independent timers costs four counter bytes plus one shared
  clock-phase byte. A shared inactivity age can support multiple inactivity
  thresholds, but independent repeated intervals still need per-record state or
  more expensive modulo logic; measure before assuming RAM is the bottleneck.
- A generic LED-off action persists after firing. Add an optional explicit
  **resume action** per timer, dispatched once on the first physical input after
  that timer fired. This permits brightness preset → configured restoration,
  without hidden global restoration of unrelated settings. Run resume actions
  before the input's binding so the user's explicit action wins.
- Restoring brightness overrides is distinct from suppressing only always-on
  background. Generic brightness off also affects timed/blink indications.
  Retain that distinction in findings; do not claim exact auto-sleep equivalence.
- Key/mouse holds and momentary layers need a release lifecycle. A timer cannot
  honestly offer every key action merely by treating itself as an encoder input.
  Investigate virtual inputs/pulses separately. The first size probe will cover
  rotation-compatible actions only and explicitly reject release-dependent
  bindings; this is a lower-bound prototype, not fulfillment of “any action.”
- Scheduled actions must not consume an armed one-shot layer accidentally.
  Physical resume actions must obey an explicit documented ordering. Test both.
- Overflow/catch-up: at most one firing per timer per observed tick, never an
  unbounded backlog after a delayed loop. Reset/reconfiguration clears timers.
- A mouse jiggler needs alternating directions or net-zero movement; a single
  repeating mouse delta drifts. Two opposing periodic actions can demonstrate
  the scheduling primitive, but a dedicated jiggle action is out of scope.

## Encoding proposal for the first probe

Use format **7** for the structural extension; support reading existing v6 images
in updated firmware. Old firmware must reject v7 rather than reinterpret records.
Keep the image at 128 bytes and preserve existing layer/chord/action encodings.

Use header byte 3 bits 6–7 for timer-count low bits and header byte 4 bit 7 for
timer-count high bit. Mask byte 4 to seven bits for string-pool length (the whole
image is only 128 bytes). Count 0–4 is legal in the initial probe. Reserved counts
5–7 fail validation. Timers follow layers and chords, before strings. Each record
contains interval/flags, a two-byte action, and a two-byte resume action (None is
encoded as zero). Cost: five configuration bytes per timer, no runtime copy of
action records. String offsets must account for the timer region.

## Work sequence

1. Save this plan before firmware edits; record clean branch and baseline sizes.
2. Inspect existing action dispatcher/queue, one-shot state, validation and pool
   addressing. Implement a reusable timed dispatch entry point and the core
   timer scheduler. Preserve existing HID queue bounds and drop accounting.
3. Add validation for counts, bounds, timers, resume actions and strings. Test old
   v6 acceptance and v7 rejection of malformed records independently of browser.
4. Add host tests for independent periodic/inactivity intervals, 1/128 endpoints,
   input reset, resume ordering, simultaneous expiry, one-shot preservation,
   no-op activity, repeated actions, timer wrap, and configuration resets.
5. Build both physical variants with normal linker limit, preview enabled.
   Measure flash/xRAM/stack capacity against working toggle and committed sleep.
6. Measure the concessions as compile-time experiment variants: all timers reset
   on input, optionally six-bit intervals, and four timers maximum. Retain the
   least restrictive design only if its measured benefit warrants it. Document
   code/behavior differences; do not remove existing features to force a fit.
7. If even the lower-bound scheduler is far beyond available flash, document
   that evidence and outstanding “any action”/UI work rather than build a polished
   editor for an unflashable design. If it fits or looks credibly close, implement
   full release lifecycles and editor/model/binary/JSON/capacity/migration support.
8. For a viable design, add a Timed actions list with interval, reset-on-input,
   action inspector and optional resume action. Display approximate duration and
   image capacity, keep detailed options collapsed. Preserve old draft/profile
   defaults and version archives. Run browser tests/build and firmware suites.
9. Update this plan with measured results, limitations, retained variants and
   exact reproduction commands. No release build or push is authorized.

## Acceptance evidence

Distinguish compiled/host-tested prototypes from hardware-tested behavior. Record
the normal linker failures rather than raising the hardware code limit. Report
stack capacity as capacity, never measured usage. Record features omitted from
the prototype separately from existing features removed (target: none).

## Investigation result

The retained prototype and compile-time concession variants were implemented and
measured. The six-key retained build is 803 bytes over, and even the no-resume
compact variant is 653 bytes over. No existing release features were removed;
the committed auto-sleep experiment was replaced as authorized. Full physical
host regressions and new scheduler/renderer tests pass. Browser/editor and timed
hold-release lifecycles remain deferred under step 7 because the lower-bound
prototype is substantially over the available space. See
[timed-actions-findings.md](timed-actions-findings.md) for measured variants,
limitations, optimizations and reproduction instructions.
