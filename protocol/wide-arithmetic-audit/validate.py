"""Validate measured sources against the unchanged baseline, with sanitizers."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ARTIFACTS = Path("/private/tmp/macropad-wide-audit")
FLAGS = ["cc", "-std=c99", "-O1", "-g", "-Wall", "-Wextra",
         "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
         "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
         "-D__xdata=", "-D__code=", "-fsanitize=address,undefined",
         "-fno-sanitize-recover=all"]

WRAPPER = r'''
uint8_t auditAction(const uint8_t *image, uint8_t rotation, uint8_t layers,
                    uint8_t pool, uint8_t used) {
    validationImage = image; validationLayers = layers;
    validationPool = pool; validationUsed = used;
    return actionValid(0, rotation);
}
'''

HARNESS = r'''
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "config.h"
#include "config_fixture.h"
extern uint8_t reference_configValid(const uint8_t *, uint8_t);
extern uint8_t reference_configLedColorAt(uint8_t, uint8_t);
extern uint8_t reference_configStringChar(uint8_t, uint8_t);
extern uint8_t reference_activeConfig[CONFIG_ACTIVE_SIZE];
extern uint8_t auditAction(const uint8_t *, uint8_t, uint8_t, uint8_t, uint8_t);
extern uint8_t reference_auditAction(const uint8_t *, uint8_t, uint8_t, uint8_t, uint8_t);
static unsigned actions, images, colors, strings;
static uint32_t seed = 0xD153A7F0;
static uint32_t randomValue(void) { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed; }
static void compareImage(uint8_t *image, uint8_t variant) {
    uint16_t crc = configCrc(image); image[7] = crc; image[8] = crc >> 8;
    assert(!!configValid(image, variant) == !!reference_configValid(image, variant));
    images++;
}
int main(void) {
    // Both real validators see exactly 128 accessible bytes, including rejects.
    uint8_t image[CONFIG_SIZE];
    memset(image, 0, sizeof image);
    for (unsigned layers = 1; layers <= 7; layers++) {
        for (unsigned rotation = 0; rotation < 3; rotation++) {
            for (unsigned first = 0; first < 256; first++) {
                for (unsigned second = 0; second < 256; second++) {
                    image[0] = first; image[1] = second;
                    assert(!!auditAction(image, rotation, layers, 80, 16) ==
                           !!reference_auditAction(image, rotation, layers, 80, 16));
                    actions++;
                }
            }
        }
    }
    for (unsigned variant = 0; variant < 2; variant++) {
        unsigned size = variant ? 15 : 22;
        for (unsigned layers = 1; layers <= (variant ? 7 : 5); layers++) {
            for (unsigned palettes = 0; palettes < 2; palettes++) {
                for (unsigned timers = 0; timers < 8; timers++) {
                    for (unsigned chords = 0; chords < 32; chords++) {
                        for (unsigned pool = 0; pool < 128; pool++) {
                            memset(activeConfig, 0, CONFIG_ACTIVE_SIZE);
                            activeConfig[0] = CONFIG_MARKER; activeConfig[1] = CONFIG_VERSION;
                            testSetVariant(variant); testSetLayout(layers, 0, timers);
                            testSetChordCount(chords); testSetStringLength(pool);
                            for (unsigned i = 0; i < layers; i++)
                                activeConfig[9 + size * (i + 1) - 1] = palettes ? 0x10 : 0;
                            memcpy(image, activeConfig, sizeof image);
                            compareImage(image, variant);
                        }
                    }
                }
            }
        }
        // Exercise every timer field through configValid, with valid earlier records.
        for (unsigned count = 1; count <= CONFIG_TIMED_MAX; count++) {
            testLoadStarterProfile(variant); testSetTimedCount(count);
            unsigned start = configTimedOffset();
            memset(activeConfig + start, 0, count * CONFIG_TIMED_SIZE);
            for (unsigned record = 0; record < count; record++) {
                for (unsigned field = 0; field < CONFIG_TIMED_SIZE; field++) {
                    for (unsigned value = 0; value < 256; value++) {
                        memcpy(image, activeConfig, sizeof image);
                        image[start + record * CONFIG_TIMED_SIZE + field] = value;
                        compareImage(image, variant);
                    }
                }
            }
        }
    }
    for (unsigned sample = 0; sample < 20000; sample++) {
        for (unsigned i = 0; i < sizeof image; i++) image[i] = randomValue();
        // Keep header and most layer bounds plausible to reach deeper validation.
        image[0] = CONFIG_MARKER; image[1] = CONFIG_VERSION;
        compareImage(image, sample & 1);
    }
    for (unsigned value = 0; value < 256; value++) {
        memset(activeConfig, value, CONFIG_ACTIVE_SIZE);
        memcpy(reference_activeConfig, activeConfig, CONFIG_ACTIVE_SIZE);
        for (unsigned offset = 0; offset < 128; offset++) {
            for (unsigned key = 0; key < 6 && offset + key / 2 < 128; key++) {
                assert(configLedColorAt(offset, key) == reference_configLedColorAt(offset, key));
                colors++;
            }
        }
    }
    for (unsigned variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        unsigned start = configTimedOffset();
        unsigned length = 128 - start;
        testSetStringLength(length);
        for (unsigned i = 0; i < length; i++) activeConfig[start + i] = 32 + i % 95;
        memcpy(reference_activeConfig, activeConfig, CONFIG_ACTIVE_SIZE);
        for (unsigned offset = 0; offset < 256; offset++) {
            for (unsigned index = 0; index < 256; index++) {
                assert(configStringChar(offset, index) == reference_configStringChar(offset, index));
                strings++;
            }
        }
    }
    // Prove the USB range transformation for every possible byte operand, not
    // merely the reachable 2/32-byte transfers. Both must reject overflowing sums.
    unsigned usb = 0;
    for (unsigned received = 0; received < 256; received++) {
        for (unsigned expected = 0; expected < 256; expected++) {
            for (unsigned length = 0; length < 256; length++) {
                assert((received + length <= expected) ==
                       (received <= expected && length <= (uint8_t)(expected - received)));
                usb++;
            }
        }
    }
    printf("action_encodings=%u config_images=%u palette_reads=%u string_reads=%u USB_ranges=%u\n",
           actions, images, colors, strings, usb);
    return 0;
}
'''


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "combined"
    source = ARTIFACTS / name / "source"
    baseline = ARTIFACTS / "baseline/source"
    output = ARTIFACTS / name / "validation"
    output.mkdir(parents=True, exist_ok=True)
    includes = ["-I" + str(source / directory) for directory in ("src", "tests", "tests/stubs")]
    includes += ["-I" + str(ROOT / "webUploader/upstream/ch55xduino/ch55x" / directory)
                 for directory in ("variants/ch552", "cores/ch55xduino")]
    identifiers = set(re.findall(r"\bconfig[A-Z]\w*", (baseline / "src/config.h").read_text())) | {"activeConfig", "auditAction"}
    definitions = "".join(f"#define {word} reference_{word}\n" for word in sorted(identifiers))
    (output / "reference.c").write_text(definitions + f'#include "{baseline / "src/config.c"}"\n' + WRAPPER)
    (output / "candidate.c").write_text(f'#include "{source / "src/config.c"}"\n' + WRAPPER)
    (output / "differential.c").write_text(HARNESS)
    binary = output / "differential"
    subprocess.run([*FLAGS, *includes, str(output / "reference.c"), str(output / "candidate.c"), str(output / "differential.c"), "-o", str(binary)], check=True)
    result = subprocess.run([str(binary)], check=True, capture_output=True, text=True)
    print(result.stdout, end="", flush=True)
    suites = {
        "config": ["src/config.c"],
        "protocol": ["src/config.c", "src/storage.c", "src/protocol_firmware.c"],
        "usb": [],
        "actions": ["src/config.c", "src/actions.c"],
        "macros": ["src/config.c", "src/actions.c"],
        "timed_actions": ["src/config.c", "src/actions.c"],
        "timed_capacity": ["src/config.c", "src/actions.c"],
    }
    for variant in (0, 1):
        for suite, files in suites.items():
            binary = output / f"{suite}-{variant}"
            subprocess.run([*FLAGS, *includes, f"-DPHYSICAL_VARIANT={variant}", str(source / f"tests/{suite}_test.c"), *[str(source / file) for file in files], "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)
            print(f"Sanitizers passed: {suite}, variant={variant}", flush=True)
    # The optional scanner rewrite uses a byte offset converted back to a word
    # pointer. Exercise its real sketch paths for memory safety and alignment.
    scanner_suites = {
        "input": ["src/config.c", "src/actions.c"],
        "sleep_integration": ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"],
        "live_state": ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"],
        "per_key_palette": ["src/config.c", "src/actions.c"],
    }
    scanner_flags = [flag.replace("-fsanitize=address,undefined", "-fsanitize=address,alignment") for flag in FLAGS]
    for variant in (0, 1):
        for suite, files in scanner_suites.items():
            binary = output / f"{suite}-{variant}"
            subprocess.run([*scanner_flags, *includes, f"-DPHYSICAL_VARIANT={variant}", str(source / f"tests/{suite}_test.c"), *[str(source / file) for file in files], "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)
            print(f"Address/alignment sanitizers passed: {suite}, variant={variant}", flush=True)
    results = dict(candidate=name, differential=result.stdout.strip(), sanitizer_suites=list(suites), variants=[0, 1])
    results["address_alignment_suites"] = list(scanner_suites)
    results["source_manifest_sha256"] = hashlib.sha256((ARTIFACTS / name / "source-sha256.json").read_bytes()).hexdigest()
    (HERE / f"validation-{name}.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
