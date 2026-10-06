# v10 hardware validation

Preparation steps 1–4 are complete. Hardware validation is step 5; release
generation and publication remain pending. The six-byte records, 11-bit interval,
layer scopes and per-timer fractional counters are enabled in production source.

## Test builds

These temporary HEX files advertise format 10 and use the actual 14,336-byte
application limit. They were built from the uncommitted preparation source.

- [Three-key HEX](/private/tmp/macropad-v10-test-builds-yyy9oi45/three-key.hex)
- [Six-key HEX](/private/tmp/macropad-v10-test-builds-yyy9oi45/six-key.hex)
- [Build measurements](/private/tmp/macropad-v10-test-builds-yyy9oi45/results.json)
- [HEX checksums](/private/tmp/macropad-v10-test-builds-yyy9oi45/sha256.json)

| Hardware | Flash used | Flash spare | Paged RAM | External RAM | Stack capacity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three keys | 14,292 | 44 | 108 | 487 | 78 |
| Six keys | 14,294 | 42 | 108 | 496 | 75 |

The configurator preview has been rebuilt for v10. The bundled web uploader
continues to install the checked-in v9 release; use the matching test HEX above
with the normal file-based upload procedure for this validation.

## Hardware checklist

Run on both hardware variants where available. Export the existing profile with
the matching v9 editor before installing a v10 test image.

1. Install the matching v10 HEX. Existing v9 DataFlash should remain readable,
   with ordinary inputs inactive until a valid v10 profile is saved. Connect
   with the latest local configurator, read/import the old profile, and verify
   its bindings, text, timer durations and flags. Save, read back, then unplug
   and reconnect. Inputs should work and the saved profile should persist.
2. Set a global timer to one tick (4.096 seconds), with input restart off and a
   visible expiry action. Confirm repetition while using the pad and changing
   layers. Enable **Restart on key / encoder input** and confirm that key
   presses, wheel-button presses and completed detents postpone expiry.
3. Assign a timer to **Layer 2** with an 8.192-second interval. It should stay
   inactive on **Layer 1**. Enter **Layer 2**, leave before expiry, and return:
   the complete interval should restart. Also exercise **Layer while held**
   and one-shot returns. Selecting the already-active layer should not reset it.
4. Arm a scoped timer's **On next input** action, change layers, then use the
   pad. The armed action should still run once. Repeat with **Consume this
   input** off and on, and with the follow-up set to **Nothing**. Verify that
   consuming an input preserves a pending one-shot return.
5. Use four timers with distinct expiry/follow-up actions. Confirm independent
   reset phases, all armed follow-ups running in list order, and one consumed
   physical input when any pending timer requests consumption. Include a
   timer-generated layer change while another follow-up is armed.
6. Exercise ordinary keys, chords, mouse/consumer holds, horizontal scrolling,
   text playback, LED effects and both bootloader-entry methods. Repeat under
   busy USB/output queues. If using the stack diagnostic, record the observed
   peak against the 75/78-byte capacities; these are linker capacities rather
   than measured worst-case stack usage.
   The [v10 stack sanity check](../Stack%20Test/README.md) supplies the diagnostic,
   reader and a single workload profile adapted to each board variant.
7. In the editor, enter an arbitrary duration such as 300 seconds (rounds to
   299.008), select the maximum interval (8,388.608), reorder layers, and remove
   a timer's assigned layer. Removal should require explicit reassignment and
   preserve both timer actions. Verify undo and JSON backup/restore.

The maximum interval and all counter boundaries have automated coverage; a
maximum-duration wall-clock test is optional. Record the hardware variant,
profile, elapsed time and any unexpected behavior for failures.

## Completed automated checks

- Firmware host tests: configuration, dispatcher, protocol, USB, timed actions
  and real input scanning on both variants, plus five build-memory checks.
- Native firmware builds: both variants fit, with unchanged flash/stack values
  from the approved experiment.
- Configurator: 403 tests across 38 files, including actual firmware validation
  and protocol simulation, exact legacy interval conversion, and preserving
  oversized migrated profiles while blocking device saving.
- Uploader: 15 tests, including matching archived-editor links and intact v9
  release images.
- Web production build and archived-editor checksum verification: pass.

No device upload, release generation, publication or commit was performed during
preparation. The format specification is [config-v10.md](config-v10.md).
