"""Measure behavior-preserving Rainbow candidates in isolated temporary copies.

No release generation, uploads, commits, or edits to active firmware sources.
Oversize candidates use a diagnostic 16KiB link; --limit 14336 verifies fit.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import difflib
from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SKETCH = "CH552_Universal_Macropad.ino"
BASELINE_REVISION = "069be2a2c618bf65bdb6eee29c95f6771d15ec4e"


@lru_cache(maxsize=None)
def baseline_file(name):
    return subprocess.check_output(["git", "show", f"{BASELINE_REVISION}:{name}"], cwd=ROOT)


@lru_cache(maxsize=1)
def baseline_archive():
    return subprocess.check_output(["git", "archive", "--format=zip", BASELINE_REVISION,
                                    "src", "tests", "pio-platform", SKETCH, "platformio.ini"], cwd=ROOT)


def replace(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected exactly one occurrence: {old!r}")
    return text.replace(old, new)


def transform(text, case):
    if case == "baseline":
        return text
    if "+" in case:
        for part in case.split("+"):
            text = transform(text, part)
        return text
    if case.startswith("ramp-"):
        start = text.index("      // Three linear ramps")
        end = text.index("    } else {\n      const __code", start)
        if case in ("ramp-shared", "ramp-reuse"):
            ramp = """      // Subtracting 85*3 adds one modulo 256; 170*3 adds two.
      uint8_t ramp = wheel * 3;
      if (wheel < 85) {
        green = 0; blue = ramp; red = (uint8_t)~ramp;
      } else if (wheel < 170) {
        ramp++; red = 0; green = ramp; blue = (uint8_t)~ramp;
      } else {
        ramp += 2; red = ramp; green = (uint8_t)~ramp; blue = 0;
      }
"""
            if case == "ramp-reuse":
                ramp = ramp.replace("uint8_t ramp = wheel * 3;", "color = wheel;\n      wheel *= 3;").replace("if (wheel < 85)", "if (color < 85)").replace("if (wheel < 170)", "if (color < 170)").replace("ramp", "wheel")
        elif case == "ramp-normalize":
            ramp = """      uint8_t sector = 0;
      if (wheel >= 170) { wheel -= 170; sector = 2; }
      else if (wheel >= 85) { wheel -= 85; sector = 1; }
      wheel *= 3;
      red = green = blue = 0;
      if (sector == 0) { blue = wheel; red = (uint8_t)~wheel; }
      else if (sector == 1) { green = wheel; blue = (uint8_t)~wheel; }
      else { red = wheel; green = (uint8_t)~wheel; }
"""
        elif case == "ramp-divmod":
            ramp = """      uint8_t sector = wheel / 85;
      if (sector == 3) sector = 2;
      uint8_t ramp = (wheel - sector * 85) * 3;
      red = green = blue = 0;
      if (sector == 0) { blue = ramp; red = (uint8_t)~ramp; }
      else if (sector == 1) { green = ramp; blue = (uint8_t)~ramp; }
      else { red = ramp; green = (uint8_t)~ramp; }
"""
        else:
            raise ValueError(case)
        return text[:start] + ramp + text[end:]
    if case == "phase-table":
        text = re.sub(r"__code uint8_t rainbowPositions\[\d\] = .*;\n", "", text)
        table = """#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
__code uint8_t rainbowOffsets[24] = {
  0,0,0,0,0,0, 0,21,42,105,84,63,
  0,42,84,210,168,126, 0,109,218,33,180,71
};
#else
__code uint8_t rainbowOffsets[12] = {0,0,0, 0,21,42, 0,42,84, 0,109,218};
#endif"""
        text = replace(text, "__code uint8_t rainbowSteps[4] = {0, 21, 42, 109};", table)
        return replace(text, "rainbowPositions[i] * rainbowSteps[spacing]",
                       "rainbowOffsets[(uint8_t)(spacing * NUM_LEDS) + i]")
    if case == "phase-pointer":
        text = transform(text, "phase-table")
        text = replace(text, "  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color", "  const __code uint8_t *offsets = rainbowOffsets + (uint8_t)(spacing * NUM_LEDS);\n  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color")
        return replace(text, "rainbowOffsets[(uint8_t)(spacing * NUM_LEDS) + i]", "offsets[i]")
    if case == "phase-cache":
        text = replace(text, "  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color", "  uint8_t phaseStep = rainbowSteps[spacing];\n  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color")
        return replace(text, "rainbowPositions[i] * rainbowSteps[spacing]", "rainbowPositions[i] * phaseStep")
    if case in ("gate-byte", "gate-match", "speed-byte"):
        if case == "speed-byte":
            return replace(text, "rainbowFrameMs[previewOptions ? activeConfig[8] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT : ledSettings[1]]", "rainbowFrameMs[previewOptions ? (uint8_t)(activeConfig[8] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT) : ledSettings[1]]")
        old = """((previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) > 0xF0"""
        if case == "gate-byte":
            new = """((uint8_t)(previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) > 0xF0"""
        else:
            new = """(uint8_t)(((previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) - 0xF4) < 12"""
        return replace(text, old, new)
    if case in ("gate-threshold", "gate-direct", "gate-due-threshold"):
        if case == "gate-due-threshold":
            text = transform(text, "gate-due")
            return replace(text, "(animationOptions & 0xF0) == 0xF0 && (animationOptions & 12)", "animationOptions >= 0xF4")
        old = """((previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) > 0xF0"""
        if case == "gate-direct":
            new = """(previewOptions ? previewOptions >= 0xF8 :
        (activeConfigValid && configLayerOptions(actionsLayer()) >= 0xF4))"""
        else:
            new = """(uint8_t)(previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) >= 0xF4"""
        return replace(text, old, new)
    if case in ("gate-local", "gate-helper", "gate-due"):
        old = """((previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) > 0xF0"""
        helper = """ACTION_BIT rainbowAnimationActive(void) {
  uint8_t options = previewOptions;
  if (options) {
    if (!(options & 8)) return 0;
  } else {
    if (!activeConfigValid) return 0;
    options = configLayerOptions(actionsLayer());
  }
  return (options & 0xF0) == 0xF0 && (options & 12);
}

"""
        if case == "gate-helper":
            text = replace(text, "void loop() {", helper + "void loop() {")
            return replace(text, old, "rainbowAnimationActive()")
        if case == "gate-due":
            text = replace(text, " : ledSettings[1]] &&\n      " + old, " : ledSettings[1]]")
            start = text.index("  if ((uint8_t)((uint8_t)now - rainbowChanged) >=")
            open_brace = text.index("  {\n", start)
            text = text[:open_brace] + text[open_brace:].replace("  {\n", """  {
    uint8_t animationOptions = previewOptions;
    if (animationOptions) {
      if (!(animationOptions & 8)) animationOptions = 0;
    } else if (activeConfigValid) animationOptions = configLayerOptions(actionsLayer());
    if ((animationOptions & 0xF0) == 0xF0 && (animationOptions & 12)) {
""", 1)
            text = replace(text, "    updateLeds();\n  }\nerrorLed:", "    updateLeds();\n    }\n  }\nerrorLed:")
            begin = text.index("    if ((animationOptions & 0xF0) == 0xF0 && (animationOptions & 12)) {\n")
            begin = text.index("\n", begin) + 1
            end = text.index("    }\n  }\nerrorLed:", begin)
            return text[:begin] + "".join("  " + line for line in text[begin:end].splitlines(keepends=True)) + text[end:]
        local = """  uint8_t animationOptions = previewOptions;
  if (animationOptions) {
    if (!(animationOptions & 8)) animationOptions = 0;
  } else if (activeConfigValid) animationOptions = configLayerOptions(actionsLayer());
"""
        text = replace(text, "  if ((uint8_t)((uint8_t)now - rainbowChanged) >=", local + "  if ((uint8_t)((uint8_t)now - rainbowChanged) >=")
        return replace(text, old, "(animationOptions & 0xF0) == 0xF0 && (animationOptions & 12)")
    if case in ("drift-derived", "drift-derived-byte"):
        text = replace(text, "#define DEBOUNCE_MS", "#if RAINBOW_DRIFT_MASK != 3\n#error This probe requires the current four-frame base drift interval\n#endif\n#define DEBOUNCE_MS")
        text = replace(text, "__data uint8_t rainbowHue;", """union RainbowFrame {
  struct { uint8_t hue, cycles; } bytes;
  uint16_t frames;
};
__data union RainbowFrame rainbowFrame;
#define rainbowHue rainbowFrame.bytes.hue""")
        text = replace(text, "// Per-LED extra hue steps; staggered rates gently change relative phases.\n__idata uint8_t rainbowDrift[NUM_LEDS];", "// Drift slot s is (frames >> (s + 2)) modulo 256.")
        text = replace(text, "    rainbowHue = 0;\n    for (uint8_t i = 0; i < NUM_LEDS; i++) rainbowDrift[i] = 0;", "    rainbowFrame.frames = 0;")
        old = """    rainbowHue++;
    // One extra step every 4, 8, 16, 32, 64, or 128 rainbow frames.
    uint8_t mask = RAINBOW_DRIFT_MASK;
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      if (!(rainbowHue & mask)) rainbowDrift[i]++;
      mask = (mask << 1) | 1;
    }"""
        text = replace(text, old, "    rainbowFrame.frames++;")
        if case == "drift-derived":
            expr = "(uint8_t)(rainbowFrame.frames >> (2 + rainbowDriftPositions[i]))"
        else:
            # Slot 0 uses the low two bits of cycles, slot 5 the low seven.
            expr = "(uint8_t)((rainbowFrame.bytes.hue >> 2) >> rainbowDriftPositions[i]) + (uint8_t)(rainbowFrame.bytes.cycles << (6 - rainbowDriftPositions[i]))"
        return replace(text, "rainbowDrift[rainbowDriftPositions[i]]", expr)
    if case in ("drift-break", "drift-shift", "drift-pointer", "drift-unroll"):
        old = """    uint8_t mask = RAINBOW_DRIFT_MASK;
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      if (!(rainbowHue & mask)) rainbowDrift[i]++;
      mask = (mask << 1) | 1;
    }"""
        if case == "drift-break":
            new = old.replace("if (!(rainbowHue & mask)) rainbowDrift[i]++;", "if (rainbowHue & mask) break;\n      rainbowDrift[i]++;")
        elif case == "drift-shift":
            new = """    uint8_t hue = rainbowHue;
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      if (hue & RAINBOW_DRIFT_MASK) break;
      rainbowDrift[i]++;
      hue >>= 1;
    }"""
        elif case == "drift-pointer":
            new = """    uint8_t hue = rainbowHue;
    __idata uint8_t *drift = rainbowDrift;
    uint8_t remaining = NUM_LEDS;
    do {
      if (hue & RAINBOW_DRIFT_MASK) break;
      (*drift++)++;
      hue >>= 1;
    } while (--remaining);"""
        else:
            new = "\n".join(f"    if (!(rainbowHue & {(4 << i)-1})) rainbowDrift[{i}]++;" if i < 3 else
                            f"#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS\n    if (!(rainbowHue & {(4 << i)-1})) rainbowDrift[{i}]++;\n#endif" for i in range(6))
        return replace(text, old, new)
    if case == "drift-physical":
        text = replace(text, "#define DEBOUNCE_MS", "#if RAINBOW_DRIFT_MASK != 3\n#error This probe requires the current four-frame base drift interval\n#endif\n#define DEBOUNCE_MS")
        text = replace(text, "__code uint8_t rainbowDriftPositions[6] = {0, 3, 1, 4, 2, 5};", "__code uint8_t rainbowDriftMasks[6] = {3, 31, 7, 63, 15, 127};")
        text = replace(text, "__code uint8_t rainbowDriftPositions[3] = {0, 2, 1};", "__code uint8_t rainbowDriftMasks[3] = {3, 15, 7};")
        text = replace(text, "rainbowDrift[rainbowDriftPositions[i]]", "rainbowDrift[i]")
        text = replace(text, "    uint8_t mask = RAINBOW_DRIFT_MASK;\n", "")
        text = replace(text, "if (!(rainbowHue & mask)) rainbowDrift[i]++;", "if (!(rainbowHue & rainbowDriftMasks[i])) rainbowDrift[i]++;")
        return replace(text, "      mask = (mask << 1) | 1;\n", "")
    if case == "rainbow-bit":
        return replace(text, "    uint8_t rainbow = palette == 15 &&", "    ACTION_BIT rainbow = palette == 15 &&")
    if case == "rainbow-hoist":
        expr = """    uint8_t rainbow = palette == 15 &&
        (colorPreviewActive ? behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON : behavior != CONFIG_LAYER_INDICATOR_NONE);"""
        text = replace(text, "  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color", expr.replace("    uint8_t rainbow", "  ACTION_BIT baseRainbow") + "\n  __xdata uint8_t *ledPtr = ledData;\n  for (uint8_t i = 0; i < NUM_LEDS; i++) {\n    uint8_t color")
        return replace(text, expr, "    ACTION_BIT rainbow = baseRainbow;")
    if case in ("timer-data", "drift-data", "drift-pdata", "hue-idata"):
        old, new = {
            "timer-data": ("__idata uint8_t rainbowChanged;", "__data uint8_t rainbowChanged;"),
            "drift-data": ("__idata uint8_t rainbowDrift[NUM_LEDS];", "__data uint8_t rainbowDrift[NUM_LEDS];"),
            "drift-pdata": ("__idata uint8_t rainbowDrift[NUM_LEDS];", "__pdata uint8_t rainbowDrift[NUM_LEDS];"),
            "hue-idata": ("__data uint8_t rainbowHue;", "__idata uint8_t rainbowHue;"),
        }[case]
        return replace(text, old, new)
    raise ValueError(case)


def prepare(destination, case):
    destination.mkdir(parents=True)
    with ZipFile(BytesIO(baseline_archive())) as archive:
        archive.extractall(destination)
    (destination / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)
    original = (destination / SKETCH).read_text()
    modified = transform(original, case)
    (destination / SKETCH).write_text(modified)
    (destination.parent / "candidate.patch").write_text("".join(difflib.unified_diff(
        original.splitlines(keepends=True), modified.splitlines(keepends=True),
        fromfile="a/" + SKETCH, tofile="b/" + SKETCH)))


def measure(root, case, variant, limit):
    directory = root / case / ("six" if variant == 0 else "three")
    source, output = directory / "source", directory / "build"
    prepare(source, case)
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, str(source / "pio-platform/build_firmware.py"),
                                 "build", str(source), str(output), "24000000", "148", str(limit), str(variant)],
                                stdout=log, stderr=subprocess.STDOUT)
    row = dict(case=case, variant=variant, exit=result.returncode, limit=limit)
    if (output / "firmware.mem").exists():
        mem = (output / "firmware.mem").read_text()
        for key, label in (("flash", "ROM/EPROM/FLASH"), ("paged", "PAGED EXT. RAM"), ("external", "EXTERNAL RAM")):
            row[key] = int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
        row["stack"] = int(re.search(r"with (\d+) bytes available", mem)[1])
        row["headroom"] = 14336 - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def validate(source, case, variant, no_preview=False):
    """Run the existing input tests and an independent, byte-exact comparison."""
    baseline = baseline_file(SKETCH).decode()
    start = baseline.index("void updateLeds() {")
    end = baseline.index("\n// Three whole cycles", start)
    renderer = baseline[start:end].replace("void updateLeds()", "void referenceUpdateLeds()")
    renderer = renderer.replace("rainbowPositions", "referencePositions").replace("rainbowSteps", "referenceSteps")
    renderer = renderer.replace("rainbowDrift[rainbowDriftPositions[i]]", "referenceDrift[referenceDriftPositions[i]]")
    tables = """const uint8_t referencePositions[6] = {0,1,2,5,4,3};
const uint8_t referenceSteps[4] = {0,21,42,109};
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
const uint8_t referenceDriftPositions[6] = {0,3,1,4,2,5};
#else
const uint8_t referenceDriftPositions[3] = {0,2,1};
#endif
"""
    (source / "rainbow-reference.inc").write_text(tables + renderer)
    shutil.copy2(ROOT / "protocol/rainbow-optimization-probe.c", source / "rainbow-probe.c")
    flags = ["cc", "-O2", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses", "-Wno-pointer-to-int-cast",
             "-D__data=", "-D__idata=", "-D__pdata=", "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
             "-Itests/stubs", "-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552",
             "-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino"]
    if "drift-derived" in case:
        flags.append("-DPROBE_DERIVED")
        test = source / "tests/input_test.c"
        text = baseline_file("tests/input_test.c").decode()
        old = "    uint8_t drift[NUM_LEDS];\n    memcpy(drift, rainbowDrift, NUM_LEDS);"
        if old in text:
            text = replace(text, old, "    uint16_t drift = rainbowFrame.frames;")
            text = replace(text, "rainbowHue == hue && memcmp(drift, rainbowDrift, NUM_LEDS) == 0", "rainbowHue == hue && rainbowFrame.frames == drift")
            test.write_text(text)
        old = "            for (uint16_t hue = 0; hue < 256; hue++) {\n                for (uint8_t i = 0; i < NUM_LEDS; i++) {"
        if old in text:
            text = replace(text, old, """            uint8_t nextFrame[NUM_BYTES];
            if (phase == 3) {
                rainbowFrame.frames = 256;
                updateLeds();
                memcpy(nextFrame, ledData, NUM_BYTES);
                rainbowFrame.frames = 255;
            }
            for (uint16_t hue = 0; hue < 256; hue++) {
                for (uint8_t i = 0; i < NUM_LEDS; i++) {""")
            text = replace(text, "int delta = samples[(hue+1)&255][3*i+channel] - samples[hue][3*i+channel];", "int delta = (phase == 3 && hue == 255 ? nextFrame[3*i+channel] : samples[(hue+1)&255][3*i+channel]) - samples[hue][3*i+channel];")
            test.write_text(text)
        # This unit test writes hue directly while assuming zero independent
        # drift. The new representation makes the low hue byte part of the
        # frame counter. Check its reachable variable colors independently;
        # retain the original fixed-spacing comparisons unchanged.
        old = "                    assert(memcmp(samples[hue] + 3*i, samples[shifted], 3) == 0);"
        if old in text:
            new = """                    if (phase == 3) {
                        const uint8_t sixSlots[6] = {0,3,1,4,2,5};
                        const uint8_t threeSlots[3] = {0,2,1};
                        uint8_t slot = PHYSICAL_VARIANT ? threeSlots[i] : sixSlots[i];
                        uint8_t wheel = shifted + (hue >> (2 + slot));
                        uint8_t r, g, b;
                        if (wheel < 85) { g = 0; b = wheel * 3; r = 255 - b; }
                        else if (wheel < 170) { r = 0; g = (wheel - 85) * 3; b = 255 - g; }
                        else { b = 0; r = (wheel - 170) * 3; g = 255 - r; }
                        if (!full) {
                            r = r ? (r >> 4) | 1 : 0;
                            g = g ? (g >> 4) | 1 : 0;
                            b = b ? (b >> 4) | 1 : 0;
                        }
                        uint8_t expected[3] = {g,r,b};
                        assert(memcmp(samples[hue] + 3*i, expected, 3) == 0);
                    } else {
                        assert(memcmp(samples[hue] + 3*i, samples[shifted], 3) == 0);
                    }"""
            text = replace(text, old, new)
            text = replace(text, "assert(delta >= -(full ? 3 : 2) && delta <= (full ? 3 : 2));", "assert(delta >= -(full ? (phase == 3 ? 6 : 3) : 2) && delta <= (full ? (phase == 3 ? 6 : 3) : 2));")
            text = replace(text, "            if (full) {\n                assert(samples[0]", "            if (full && phase != 3) {\n                assert(samples[0]")
            test.write_text(text)
    if "drift-physical" in case:
        flags.append("-DPROBE_PHYSICAL")
    if no_preview:
        flags.append("-DENABLE_COLOR_PREVIEW=0")
    name = "probe-no-preview" if no_preview else "probe"
    with (source.parent / (name + ".log")).open("w") as log:
        subprocess.run([*flags, "rainbow-probe.c", "src/config.c", "src/actions.c", "-o", name],
                       cwd=source, stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(source / name)], cwd=source, stdout=log, stderr=subprocess.STDOUT, check=True)
    print(f"Validated {case}, variant={variant}, preview={not no_preview}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="+", help="Candidate names; join independent transformations with +")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=16384)
    parser.add_argument("--validate-only", action="store_true", help="Validate existing copies in --output")
    parser.add_argument("--no-preview", action="store_true", help="Disable preview in --validate-only host checks")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.validate_only:
        for case in args.cases:
            for variant, label in ((0, "six"), (1, "three")):
                validate(args.output / case / label / "source", case, variant, args.no_preview)
        return 0
    (args.output / "provenance.json").write_text(json.dumps({
        "revision": BASELINE_REVISION,
        "checkout_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "status": subprocess.check_output(["git", "status", "--short"], cwd=ROOT, text=True),
        "sketch_sha256": __import__("hashlib").sha256(baseline_file(SKETCH)).hexdigest(),
    }, indent=2) + "\n")
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: measure(args.output, *job, args.limit),
                             [(case, variant) for case in args.cases for variant in (0, 1)]))
    (args.output / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    return int(any(row["exit"] for row in rows))


if __name__ == "__main__":
    sys.exit(main())
