# Previous-layer investigation

The firmware prototype fits both variants without removing existing features.
It reuses Set layer action A with parameter **`0xFF` (255)** to mean the previous persistent
base layer. Real indices remain 0–4 on six-key and 0–6 on three-key hardware.
Record size remains two bytes; there is no extra configuration storage or version
bump. This can be folded into the still-unpublished v7 after the UI work is added.
The preserved baseline is `experiment/timed-alerts-v7-64` at `7a7d066`; the
prototype is committed separately on `experiment/previous-layer`.

## Measured cost

The original measurements below used parameter 7. Fresh comparison builds confirm
that replacing it with `0xFF` changes neither flash usage nor RAM/stack capacity
in either variant. Parameter 7 is no longer accepted as a previous-layer target.

| Variant | Baseline flash | Prototype flash | Added | Remaining flash | Baseline stack | Prototype stack |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,165 | 14,217 | 52 | 119 | 121 | 120 |
| Three keys | 14,161 | 14,213 | 52 | 123 | 124 | 123 |

Limit: 14,336 bytes. One new `__data` byte remembers the prior layer; stack
capacity decreases by one byte. Paged RAM remains 108 bytes and external RAM
remains 526/517 bytes (six/three). Contiguous external free RAM is unchanged at
222/231 bytes. These are historical linker capacities. Subsequent
[hardware stack validation](led-control-implementation.md#stack-usage-hardware-validation)
measured 36 bytes peak observed usage under heavy workloads, leaving ample headroom.

The initial `__idata` prototype used 56 more flash bytes and decreased stack by
two bytes. Reusing an existing local compiled identically. Inspecting the map
showed the extra stack loss was allocation layout, not an additional temporary
variable. Declaring the new state `__data` saved four flash bytes and recovered
one stack byte. Both variants pass the layout checks; no existing state was moved,
features removed, compiler flags changed, or timing logic changed.

Source copies, binaries and reports are preserved under:

- `/private/tmp/macropad-previous-layer/range64/`: initial indirect-RAM version.
- `/private/tmp/macropad-previous-layer-reuse-local/range64/`: equivalent local reuse.
- `/private/tmp/macropad-previous-layer-direct/range64/`: selected direct-RAM version.

`build-0` is six keys; `build-1` is three keys. Ordinary `pio run` after a clean
also produces the selected six-key result. The pre-clean build cache reported
up-to-date while holding the baseline output; measurements use fresh temporary
builds and the cleaned ordinary build, not that stale cached output.

## Proposed semantics

- Initialize history to the startup layer whenever actions are initialized.
  Selecting previous before any persistent switch therefore stays on startup.
- Actual persistent absolute and relative selections remember the layer being
  left. Same-layer selections preserve history, including repeated timer expiry
  actions that keep selecting the reminder layer.
- Previous is a one-entry swap, not a stack. A → B → C → previous goes to B;
  another previous goes to C. It does not continue back to A.
- Momentary overlays and one-shot visits/automatic returns do not replace the
  persistent history. A held momentary layer keeps its existing priority: selecting
  previous changes the underlying base, revealed when the hold ends.
- Existing auxiliary 0 remains persistent; auxiliary 1 supports one-shot previous.
  One-shot previous visits the remembered layer for one normal binding and then
  returns, without changing persistent history.
- Timer expiry and next-input actions can use previous; consuming wake input still
  works. For persistent timer changes during an armed one-shot visit, history
  remembers the underlying persistent layer rather than the transient visit.
  Existing pending one-shot return behavior is preserved, including its return
  on the next physical action; this prototype does not change those semantics.
- Layer changes use the existing action/update path, so held bindings, queued-output
  cancellation and temporary-effect clearing retain their existing behavior.
- Same-layer selections keep normal Set layer indication behavior; only history
  remains unchanged. This is not a new promise that selecting a layer has no effect.

Example: user selects layer 3; timer expiry selects layer 5; the next-input action
selects previous and returns to layer 3, even if the timer fired repeatedly while
layer 5 was active. Consume can suppress the dismissing input's normal binding.
The temporary LED feature already covers reminders without switching layers, so
this is an additional navigation/return option rather than a prerequisite.

## Validation and completed editor work

Firmware accepts parameter `0xFF` only for Set layer, with auxiliary 0 or 1, in v7.
It remains invalid for Momentary layer and v6. Other out-of-range parameters remain
invalid. Ordinary relative offsets retain their existing meaning.

The original investigation stopped at firmware. The v7 completion now includes
Previous layer in persistent and one-shot target selectors, excluding Momentary
layer, with named labels and explanatory history text. Model validation, binary
decoding, JSON and drafts accept `layer: 255` only in v7; older profiles reject it.
Encoding reuses the unchanged Set layer record.

The shared `isPreviousLayer` helper protects the target during layer insertion,
deletion, reorder/duplication, clipboard and undo, including per-change layer undo
and timer/chord remapping. Return-path advice describes the history dependency
instead of assuming a fixed destination or inventing entry paths to unreachable
layers. The simulator round-trips the target through configuration transport.

No additional firmware changes or flash/RAM bytes were needed for the editor work.
The historical measurements above predate subsequent LED changes; current free
flash is 135 bytes (three keys) and 131 bytes (six keys), with stack capacities
123/120 bytes. No physical-device tests were performed as part of that completion;
subsequent [hardware stack validation](led-control-implementation.md#stack-usage-hardware-validation)
measured 36 bytes peak observed usage under heavy workloads.

## Verification

- Firmware host suites pass with color preview enabled and disabled.
- New action regressions cover startup reset, repeated swapping, multi-layer
  history, same-layer selection, relative changes, momentary priority, one-shot
  previous and return, repeated timers and consume-on-resume, and timer changes
  during a pending one-shot visit.
- Configuration tests exhaustively check all 256 Set layer parameters and auxiliary
  values 0–2 for v6/v7 on both hardware variants, plus Momentary rejection.
- Both hardware builds pass the actual flash limit and RAM/startup layout checks.
- All 291 web regressions pass, including previous-layer binary/JSON/draft and
  simulator round trips, old-format rejection, selectors/labels, clipboard,
  layer insertion/deletion/reordering/duplication, undo and advisory checks.
- Checked-in release files are unchanged. Nothing was uploaded or pushed.

Reproduce on the prototype branch:

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 protocol/build-alert-variants.py previous-layer-reproduce 14336
```
