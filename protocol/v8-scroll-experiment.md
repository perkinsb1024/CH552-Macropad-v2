# Held scrolling and acceleration experiment

Branch: `experiment/v8-scroll-acceleration`, independently based on `196e81e`.
Firmware milestone measurements; final format/migration will be v8 on the merged
branch. The standalone experiment retains the baseline version stamp until the
Consumer Hold encoding/version change is combined. Do not use the unchanged
configurator to edit experiment-only action encodings.

| Build | Six-key flash | Three-key flash | Delta from baseline (6/3 key) | Free (6/3 key) |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 14,263 | 14,259 | 0 / 0 | 73 / 77 |
| Held scrolling only | 14,343 | 14,341 | +80 / +82 | -7 / -5 |

Held scrolling adds no persistent state: PSEG 108, XSEG 526 / 517, DSEG 128,
ISEG 9 / 6, BSEG 30 bits, stack reserve 120 / 123 bytes, matching baseline.
It uses the existing pointer repeat clock, at least eight milliseconds between
idle repeat opportunities. Initial presses queue one configured Scroll Step;
held keys/chords queue another step when output playback and USB are idle.
Either chord member releases a chord hold. Release stops future repeats, while
already accepted steps complete. Holds keep their original binding across layers,
like existing keyboard holds. Multiple held scroll bindings repeat in input-index
order when eligible, following the existing pointer-hold traversal pattern.

Encoding uses auxiliary bit 2 (`0x40` in the first action byte). Wheel rotation
and timed actions reject hold. Configuration size and the signed delta range
-127–127 remain unchanged. Zero remains a no-op. Existing non-held scrolls retain
their original unit-report playback.

Validation: host action tests cover initial output, repeats, release, chords,
short press/backpressure, and clearing. Validator tests cover key/chord acceptance,
rotation/timer rejection, and -128 rejection. Both geometries pass SDCC RAM layout.
Temporary builds: `/private/tmp/macropad-v8-builds/scroll-hold-only/`.

Flash priority: retain held scrolling before acceleration. If combined firmware
does not fit, remove acceleration first. No hardware flashing performed.
