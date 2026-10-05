# Held scrolling and acceleration experiment

## Flashable standalone test build

The branch now builds with `ENABLE_COLOR_PREVIEW=0` and
`ENABLE_RAINBOW_ANIMATION=0` in `platformio.ini`. Normal layer colors, key LEDs,
layer indication timing/blinks, temporary LED effects and invalid-config error
blinking remain. Rainbow colors render at a static phase. Disabling error
blinking was tried and discarded; it was not needed for the final fit.

With shared eight-bit arithmetic/repeat optimizations the six-key image uses
**14,235 bytes** (101 free), and the three-key image **14,231 bytes** (105 free).
RAM: PSEG 108, XSEG 526 / 517, DSEG 127, ISEG 15 / 12, BSEG 31 bits,
stack reserve 114 / 117. These builds include held scrolling and acceleration,
but neither Consumer Hold nor the timer precision experiment.

To test, use this branch's configurator (`cd webapp`, `npm run build`) and ordinary
firmware build/upload workflow. No firmware has been uploaded by this work.
Select a Scroll action and choose Off, Slow or Fast from **Scroll acceleration
(experiment)**. Keys/chords/encoder press also offer Tap/Hold. Try a base step of
1 first; reverse direction, pause longer than 200 ms and trigger another action
to compare resets. Start with a fresh profile or an original v7 backup: this
branch's configurator does not import v8 backups with Consumer Hold. Keep steps
small while judging feel because each computed
step plays as unit wheel reports before the next queued action.

This isolated branch still uses the experimental extension of the v7 encoding;
its configurator understands those auxiliary bits. Ordinary v7 firmware and the
v8 merged firmware reject acceleration settings. Export a backup before testing;
do not transfer accelerated profiles between these branches. The merged branch
has its own v8 migration and retains color preview/rainbow animation.

Temporary flashable images/maps: `/private/tmp/macropad-v8-builds/scroll-test-budget/`.
Validation includes firmware host suites with the actual lighting flags, both
hardware builds at the real 14,336-byte limit, web codec/JSON/release restrictions,
the full web suite and production web build. Hardware feel remains untested.

Branch: `experiment/v8-scroll-acceleration`, independently based on `196e81e`.
Firmware milestone measurements; final format/migration will be v8 on the merged
branch. The standalone experiment retains the baseline version stamp until the
Consumer Hold encoding/version change is combined. Do not use the unchanged
configurator to edit experiment-only action encodings.

| Build | Six-key flash | Three-key flash | Delta from baseline (6/3 key) | Free (6/3 key) |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 14,263 | 14,259 | 0 / 0 | 73 / 77 |
| Held scrolling only | 14,343 | 14,341 | +80 / +82 | -7 / -5 |
| Held scrolling + initial acceleration | 14,817 | 14,815 | +554 / +556 | -481 / -479 |
| Held scrolling + packed default presets | 14,785 | 14,783 | +522 / +524 | -449 / -447 |
| Held scrolling + Y=1, Slow X=1 / Fast X=2 | 14,815 | 14,813 | +552 / +554 | -479 / -477 |

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

## Acceleration milestone

Default acceleration's incremental cost over the isolated held-scrolling
milestone is **442 flash bytes**. It adds six persistent indirect-RAM bytes:
the published input clock, last accepted event timestamp, stream context, and
packed gain counter. Linked areas are PSEG 108, XSEG 526 / 517, DSEG 127,
ISEG 15 / 12, BSEG 33 bits, stack reserve 113 / 116 bytes. Compiler scratch and
bit allocation also change; area figures should not be mistaken for just the
new persistent state.

Modes: Off=0, Slow=1, Fast=2 in the low two auxiliary bits; hold uses bit 2.
Other values reject. The initial firmware presets are +1 every two subsequent
events for Slow and +1 every subsequent event for Fast. X/Y constants support
1–8; the common initial presets use one packed half-step counter instead of a
separate spacing byte. Alternative constants select the general algorithm.
Y=1 with different X values is not smaller than the packed defaults in this
build, so simplifying presets alone does not solve the flash shortfall.

Maximum resulting magnitude is 127. Input timeout is a firmware constant of
200 ms. Ordinary releases do not reset repeated scroll taps; releasing a scroll
hold stops repeats and resets its stream. A continuously held scrolling key
does not expire solely because USB playback takes more than 200 ms. Other input
triggers still reset gain. Holds and non-held physical Scroll Steps participate;
timed actions use their configured unaccelerated step without affecting the
physical stream, even if their action bytes contain an acceleration mode.

Stream context includes mode, hold flag, output sign, and physical wheel
direction. A reversal resets even when both detents map to the same output sign.
Switching base magnitudes within the same context applies existing gain to the
new base; configuration/layer changes explicitly reset. This avoids a redundant
stored base byte. Each accepted event computes its delta once before queueing;
USB retries and individual unit reports never advance gain. Dropped events do
not add gain, but different-context physical triggers reset even if dropped.
Pending chord input also resets the stream; chord holds can then build gain
through their generated repeats. Non-held repeated chords may restart at base
because their pending key presses are distinct intervening physical triggers.

All host suites pass with default presets and alternative X/Y presets (Slow
X=2/Y=3, Fast X=3/Y=2). Added tests cover fractional growth, maximum saturation,
inactivity boundary, clock wrap, mode/sign changes, no-op triggers, physical
reversal with identical output signs, queue drops, timer isolation, and held
repeat acceleration. Both hardware builds pass RAM layout. Default artifact
path: `/private/tmp/macropad-v8-builds/scroll-packed-final/`.
