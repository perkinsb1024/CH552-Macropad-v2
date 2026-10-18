# HID Layer Selection Investigation

Measured October 17, 2026 against revision
`0dc5ebbb69f9dafc3fa6723c0e3b52eaabd7d013` on
`experiment/v18-additional-features`. This baseline has 131/135 flash bytes free
(six-/three-key). Candidate implementations remain isolated source snapshots;
the active firmware, configurator, saved format and release files are unchanged.
Investigation artifacts are uncommitted.

## Result

| Candidate | Added Flash per Pad | Flash Six/Three | Free Flash Six/Three | Stack Reserve Six/Three |
| --- | ---: | --- | --- | --- |
| Baseline | 0 | 14,205 / 14,201 | 131 / 135 | 102 / 105 |
| Initial Layer Selection Only | 72 | 14,277 / 14,273 | 59 / 63 | 102 / 105 |
| Initial Optional Direct Wake | 154 | 14,359 / 14,355 | Over by 23 / 19 | 101 / 104 |
| Optimized Optional Direct Wake | 110 | 14,315 / 14,311 | 21 / 25 | 102 / 105 |
| Always Treat as Input (Final Alternative) | 76 | 14,281 / 14,277 | 55 / 59 | 102 / 105 |
| Optional Input Handling (Recommended) | 84 | 14,289 / 14,285 | 47 / 51 | 102 / 105 |

The recommended version keeps the original choice for eight additional bytes:
the caller can select a layer quietly or first run normal input handling to
wake the device. Input handling also services user timers; it is not a wake-only
operation. The separate direct-wake implementation is larger and not recommended.

Both final input-style candidates add zero allocated RAM bytes and preserve the
102/105-byte linker stack reserves. PSEG remains 108 bytes, ordinary XSEG remains
404/395 bytes, absolute image/runtime storage remains 134 bytes and USB DMA remains
148 bytes (794/785 total external bytes). No runtime bits or configuration bytes
are added. Linker reserves are not runtime stack high-water measurements.

Measurements use CH55xDuino 0.0.25, SDCC build.13407_4, existing small-model size
flags and callee-save settings, 24MHz, and the real 14,336-byte application limit.
Both final candidates pass native build/layout/startup/USB interrupt-parameter
checks on both geometries. See [complete measurements](results.json) and
[candidate comparisons](candidate-table.md).

## Command and Behavior

The provisional **Set Layer** opcode is 13 (`0x0D`), using the existing 32-byte
packet framing and HID transport version 1. Configuration format remains 18.

For the recommended optional-input implementation:

- Packet byte 6, normally offset: bits 0–6 contain a zero-based absolute layer
  index; bit 7 enables normal input handling before layer selection.
- Packet byte 7, length: zero. Byte 8 and all payload/padding bytes: zero.
- Success: status 0, empty response, with the request's options echoed in byte 6.
- Invalid layer or nonzero length: status 3 (**BAD_RANGE**). Invalid active
  configuration: status 6 (**BAD_CONFIG**). Existing packet/version validation
  applies before dispatch. Invalid requests do not wake or change runtime state.

For the always-input alternative, byte 6 is solely the layer index; bit 7 is not
an option and is rejected by the layer bound check. All valid commands first run
normal input handling. Neither implementation writes DataFlash or alters the
saved startup layer, active image, upload staging or configuration CRC.

Layer selection changes the persistent base layer, cancels a pending one-shot
selection and uses the existing previous-layer history and transition cleanup.
Held momentary layers retain priority until released, as for a physical persistent
layer action. Held key bindings survive transitions; scoped timers and queued
playback follow existing layer-transition rules. Pending chord singles retain
their existing resolution semantics. Host selection itself adds no fabricated
physical/timer binding event to **Live View**.

A quiet command preserves sleep across sleep-enabled layers and does not restart
global inactivity timers. Selecting a different sleep-disabled layer still wakes
through the existing transition behavior. Actual layer transitions reset scoped
user timers as before; quiet does not mean bypassing layer-transition rules.

An input-style command resets the built-in sleep timer, restores pre-sleep
brightness when needed, and services pending user-timer follow-ups exactly like
normal input. Any consuming follow-up can suppress that command's layer selection.
Success acknowledges processing, including consumption; it does not guarantee
the requested layer became effective. Repeated command packets each count as
new input, while USB reply backpressure does not execute one packet repeatedly.

Usually an immediate second input-style command gets past consumption. Two are
not an unconditional guarantee: a non-restarting repeating timer can expire
again between requests. With the recommended implementation, a helper can send
an input-style command followed by a quiet command for the same layer. The quiet
command bypasses timer consumption. For example, selecting **Layer 2** uses byte 6
`0x81` first, then `0x01`. Existing held-layer priority still applies.

Older firmware has no capability bit for this provisional opcode. Hosts must
handle rejection and must not assume every format-18 firmware supports it.
Configurator controls and a foreground-application helper are deferred.

## Optimization Notes

The initial direct-wake design duplicated sleep reset/restore work and added a
second function parameter. Byte-narrowed bounds, a packed request, clearing sleep
state before restoration, shared persistent layer history and shared wake/reset
logic reduced that design from 154 to 110 added bytes and recovered its one-byte
stack-reserve loss. It remains an investigation alternative, not adopted code.

The user's suggestion to reuse normal input handling eliminated the separate
wake helper. Final code shares persistent base-layer selection with physical
actions, keeps bound calculations byte-sized and calculates the target after
input handling so it need not preserve another local across that call. This
reduces the input-style implementations by two bytes to 76/84 added bytes.

Early opcode dispatch, inlined packed-header layer bounds and an opcode bit-mask
test were measured and rejected: they saved nothing or grew the selected code.
The full ledger preserves each candidate rather than assuming additive savings.
No features, timer slots, validation rules, intervals or precision were cut.

## Patches, Validation and Reproduction

- [Recommended combined firmware and regression patch](recommended.patch).
- [Always-input combined alternative](always-input.patch); apply instead of the
  recommended patch, not on top of it.
- Firmware-only patches: [optional input](optional-input-clean.patch) and
  [always input](input-clean.patch). Matching `*-tests.patch` files are separate.
- [Measurement driver](measure.py) and [validation driver](validate.py).

Both final candidates pass the complete normal host runner on both geometries,
including the new input-layer suite, existing input/sleep/live-state suites,
palette comparison (508,064 frames per geometry), eight build-layout tests and
nineteen mocked bootloader tests. Additional real-sketch integration tests pass
ASan/UBSan with recovery disabled on both candidates/geometries.

New coverage includes all 256 offset values and 256 lengths at every supported
layer count, padding and invalid-profile rejection, all 32 sleep settings and
16 brightness-policy pairs, same/different-layer wake, five simultaneous user
follow-ups and every consumption mask, a repeated-expiry boundary between
requests, one-shot/history/held-layer behavior, held keys, queued actions,
pending chords, scoped timers, retries, reply backpressure and USB reset.
Validation JSON and source SHA-256 manifests identify the exact tested snapshots.

Reproduce from the recorded baseline:

```sh
python3 protocol/hid-layer-investigation/measure.py input-clean optional-input-clean
python3 protocol/hid-layer-investigation/validate.py input-clean
python3 protocol/hid-layer-investigation/validate.py optional-input-clean
python3 protocol/hid-layer-investigation/finalize.py
```

Native outputs, assembly, maps and source snapshots are under
`/private/tmp/macropad-hid-layer/`. Durable patches and memory reports are in this
directory. Check source/toolchain agreement before applying to another revision,
then remeasure both boards. Normal input handling is a deliberate behavior choice,
not a semantics-preserving substitute for waking only the built-in sleep slot.

No active deployment inputs changed, so configurator, uploader and complete-site
gates were not run. Hardware validation, flashing, release generation, adoption,
commits and publication were not performed.
