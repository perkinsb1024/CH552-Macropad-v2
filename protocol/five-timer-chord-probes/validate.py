"""Differential chord/bounds checks and five-timer source/expiry regressions."""
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
FLAGS = ["cc", "-std=c99", "-Wall", "-Wextra", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses", "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=", "-D__xdata=", "-D__code=", "-fsanitize=address,undefined", "-g"]

HARNESS = r'''
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "config.h"
#include "config_fixture.h"
extern uint8_t reference_activeConfig[CONFIG_ACTIVE_SIZE];
extern uint8_t reference_configValid(const uint8_t *, uint8_t);
extern uint8_t reference_configChord(uint8_t, uint8_t, uint8_t, uint8_t *, uint8_t *);
static unsigned profiles, lookups, bounds;
static uint32_t randomState = 0x752390AC;
static unsigned randomValue(void) { randomState ^= randomState << 13; randomState ^= randomState >> 17; randomState ^= randomState << 5; return randomState; }
static void seal(uint8_t *image) { uint16_t crc = configCrc(image); image[7] = crc; image[8] = crc >> 8; }
static void blank(uint8_t variant, uint8_t layers, uint8_t timers) {
    memset(activeConfig, 0, CONFIG_ACTIVE_SIZE); activeConfig[0] = CONFIG_MARKER;
    activeConfig[1] = CONFIG_VERSION; testSetVariant(variant); testSetLayout(layers, 0, timers);
}
static uint8_t encoded(uint8_t old) {
#if MODE == 7
    return old & 128 ? 0x70 | (old & 15) : old;
#elif MODE == 0
    return old & 128 ? old & 15 : old + 16;
#else
    return old;
#endif
}
static void differential(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        unsigned keys = variant ? 3 : 6, size = variant ? 15 : 22, pairs = keys * (keys - 1) / 2;
        for (unsigned layers = 1; layers <= (variant ? 7 : 5); layers++) {
            for (unsigned sample = 0; sample < 200; sample++) {
                unsigned timers = randomValue() % (CONFIG_TIMED_MAX + 1);
                if (9 + size * layers + 6 * timers > 128) timers = 0;
                blank(variant, layers, timers);
                unsigned capacity = (119 - size * layers - 6 * timers) / 3, count = 0;
                if (capacity > 31) capacity = 31;
                for (unsigned scope = 0; scope <= layers; scope++) {
                    for (unsigned pair = 0; pair < pairs && count < capacity; pair++) {
                        if (randomValue() % 3 == 0) continue;
                        unsigned offset = 9 + size * layers + 3 * count++;
                        activeConfig[offset] = (scope == layers ? 128 : scope << 4) | pair;
                        activeConfig[offset + 1] = CONFIG_ACTION_KEY_TAP;
                        activeConfig[offset + 2] = 4 + scope + pair;
                    }
                }
                testSetChordCount(count);
                memcpy(reference_activeConfig, activeConfig, CONFIG_ACTIVE_SIZE);
                seal(reference_activeConfig);
                for (unsigned i = 0; i < count; i++) {
                    unsigned offset = 9 + size * layers + 3 * i;
                    activeConfig[offset] = encoded(activeConfig[offset]);
                }
                seal(activeConfig);
                assert(reference_configValid(reference_activeConfig, variant));
                assert(configValid(activeConfig, variant)); profiles++;
                for (unsigned layer = 0; layer <= layers; layer++) {
                    for (unsigned a = 0; a <= keys; a++) for (unsigned b = 0; b <= keys; b++) {
                        uint8_t first = 0xAA, second = 0xBB, refFirst = 0xAA, refSecond = 0xBB;
                        assert(!!configChord(layer, a, b, &first, &second) == !!reference_configChord(layer, a, b, &refFirst, &refSecond));
                        assert(first == refFirst && second == refSecond); lookups++;
                    }
                }
            }
#if MODE != -1
            for (unsigned id = 0; id < 256; id++) {
                blank(variant, layers, 0); testSetChordCount(1);
                unsigned offset = 9 + size * layers;
                activeConfig[offset] = id; seal(activeConfig);
                unsigned scope = id >> 4;
                unsigned valid = (id & 15) < pairs &&
#if MODE == 7
                    (scope < layers || scope == 7);
#else
                    scope <= layers;
#endif
                assert(!!configValid(activeConfig, variant) == valid); bounds++;
            }
#endif
        }
    }
}
static void metadataBounds(void) {
    for (unsigned variant = 0; variant < 2; variant++) {
        for (unsigned layers = 1; layers <= (variant ? 7 : 5); layers++) {
            for (unsigned timers = 0; timers < 8; timers++) for (unsigned chords = 0; chords < 32; chords++) {
                for (unsigned pool = 0; pool < 128; pool++) {
                    blank(variant, layers, timers); testSetChordCount(chords); testSetStringLength(pool);
                    memcpy(reference_activeConfig, activeConfig, CONFIG_ACTIVE_SIZE);
                    if (9 + (variant ? 15 : 22) * layers + 3 * chords <= 128) {
                        for (unsigned i = 0; i < chords; i++) {
                            unsigned offset = 9 + (variant ? 15 : 22) * layers + 3 * i;
                            activeConfig[offset] = encoded(activeConfig[offset]);
                        }
                    }
                    seal(reference_activeConfig); seal(activeConfig);
                    assert(!!configValid(activeConfig, variant) == !!reference_configValid(reference_activeConfig, variant)); bounds++;
                }
            }
        }
    }
}
int main(void) { differential(); metadataBounds(); printf("profiles=%u lookups=%u bounds=%u\n", profiles, lookups, bounds); }
'''

TIMERS = r'''
#define main originalActionsMain
#include "actions_test.c"
#undef main
#undef actionsTimedReset
#undef actionsTimedPoll
extern uint8_t liveBindings[];
static uint8_t fine;
static void advance(unsigned coarse) {
    for (unsigned i = 0; i < coarse * 2; i++) { fine += 128; actionsTimedPoll(fine); }
}
int main(void) {
    reset(); testLoadStarterProfile(PHYSICAL_VARIANT); testSetTimedCount(5);
    unsigned start = configTimedOffset();
    for (unsigned i = 0; i < 5; i++) {
        unsigned offset = start + 6 * i;
        activeConfig[offset] = i;
        activeConfig[offset + 1] = ((i % 3) << 4) | CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 2] = CONFIG_LED_KEY_SET;
        activeConfig[offset + 3] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 4] = CONFIG_LED_KEY_SET;
        activeConfig[offset + 5] = CONFIG_TIMED_CONSUME;
    }
    uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsInit(); actionsTimedReset(0); fine = 0; ledCalls = 0;
    advance(5); assert(ledCalls == 10 && liveBindings[9] == 0x8D);
    assert(actionsTimedInput()); assert(ledCalls == 15 && liveBindings[9] == 0x8D);
    assert(!actionsTimedInput());
    // Long user timers leave the sixth runtime slot available for Auto-Sleep.
    for (unsigned i = 0; i < 5; i++) { activeConfig[start + 6 * i] = 255; activeConfig[start + 6 * i + 5] = 56; }
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
    actionsTimedReset(0); fine = 0; ledCalls = 0;
    advance(440); assert(ledCalls == 1 && liveBindings[9] == 0x8E);
    assert(actionsTimedInput()); assert(ledCalls == 2 && liveBindings[9] == 0x8E);
    // Macro dispatch has a distinct source after moving the sleep slot to ID 14.
    unsigned macro = start + 30;
    activeConfig[9] = CONFIG_ACTION_MACRO; activeConfig[10] = macro;
    activeConfig[macro] = CONFIG_ACTION_LED_CONTROL; activeConfig[macro + 1] = CONFIG_LED_KEY_SET;
    activeConfig[macro + 2] = 0;
    actionsPress(0, 0); actionsRelease(0);
    for (unsigned i = 0; i < 20; i++) actionsPoll(i);
    assert(liveBindings[9] == 0x8F);
    return 0;
}
'''


def main():
    source = Path(sys.argv[1]).resolve()
    mode = 7 if "seven" in source.parent.name else 0 if "zero" in source.parent.name else -1
    temporary = Path(tempfile.mkdtemp(prefix="macropad-timer-chord-validation-"))
    reference = (ROOT / "src/config.c").read_text()
    header = (ROOT / "src/config.h").read_text()
    if "five" in source.parent.name:
        header = header.replace("#define CONFIG_TIMED_MAX 4", "#define CONFIG_TIMED_MAX 5")
    identifiers = set(re.findall(r"\bconfig[A-Z]\w*", header)) | {"activeConfig"}
    for identifier in sorted(identifiers, key=len, reverse=True):
        reference = re.sub(r"\b" + identifier + r"\b", "reference_" + identifier, reference)
        header = re.sub(r"\b" + identifier + r"\b", "reference_" + identifier, header)
    (temporary / "reference_config.h").write_text(header)
    (temporary / "reference.c").write_text(reference.replace('"config.h"', '"reference_config.h"'))
    (temporary / "chords.c").write_text(HARNESS)
    includes = ["-I" + str(source / "src"), "-I" + str(source / "tests"), "-I" + str(source / "tests/stubs"), "-I" + str(ROOT / "webUploader/upstream/ch55xduino/ch55x/variants/ch552"), "-I" + str(ROOT / "webUploader/upstream/ch55xduino/ch55x/cores/ch55xduino")]
    binary = temporary / "chords"
    subprocess.run([*FLAGS, *includes, f"-DMODE={mode}", str(temporary / "chords.c"), str(temporary / "reference.c"), str(source / "src/config.c"), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
    if "five" in source.parent.name:
        (temporary / "timers.c").write_text(TIMERS)
        for variant in (0, 1):
            binary = temporary / f"timers-{variant}"
            subprocess.run([*FLAGS, *includes, f"-DPHYSICAL_VARIANT={variant}", str(temporary / "timers.c"), str(source / "src/config.c"), str(source / "src/actions.c"), "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)
            print(f"Passed five timers, Auto-Sleep and macro source: variant={variant}", flush=True)
    print(f"Passed {source.parent.name}; sanitizer artifacts: {temporary}", flush=True)


if __name__ == "__main__":
    main()
