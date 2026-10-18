"""Measure behavior-preserving arithmetic candidates in isolated source copies.

No release generation or active firmware edits. Every candidate is relative to
the recorded working-tree snapshot; combined results must be measured afresh.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ARTIFACTS = Path("/private/tmp/macropad-wide-audit")
SKETCH = "CH552_Universal_Macropad.ino"
HID = "src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c"
USB = "src/userUsbHidKeyboardMouse/USBhandler.c"

# Each tuple is (file, exact original expression, replacement).
EDITS = {
    "validator-timer-index": [("src/config.c", "validationImage[offset + 5]", "validationImage[(uint8_t)(offset + 5)]")],
    "macro-index": [("src/actions.c", "activeConfig[macroNext + 1]", "activeConfig[(uint8_t)(macroNext + 1)]")],
    "press-mask": [("src/actions.c", "inputDown & (1 << input)", "inputDown & (uint8_t)(1u << input)")],
    "release-mask": [("src/actions.c", "inputDown & (1 << other)", "inputDown & (uint8_t)(1u << other)")],
    "encoder-index": [(SKETCH, "encoderTransitions[(encoderState << 2) | state]", "encoderTransitions[(uint8_t)((encoderState << 2) | state)]")],
    "palette-index": [(SKETCH, "configPalette[color]", "((const __code uint8_t *)configPalette) + (uint8_t)(color * 3)")],
    "string-descriptor-index": [(USB, "stringDescriptors[valueLow]", "*(const __code uint8_t * const __code *)((const __code uint8_t *)stringDescriptors + (uint8_t)(valueLow * sizeof(stringDescriptors[0])))")],
    "live-pointer-index": [("src/actions.c", "*liveInternal[i]", "**(const __idata uint8_t * const __code *)((const __code uint8_t *)liveInternal + (uint8_t)(i * sizeof(liveInternal[0])))")],
    "raw-changed-index": [(SKETCH, "rawChanged[input]", "*(__xdata uint16_t *)((__xdata uint8_t *)rawChanged + (uint8_t)(input * sizeof(rawChanged[0])))"), (SKETCH, "rawChanged[i] = now", "*(__xdata uint16_t *)((__xdata uint8_t *)rawChanged + (uint8_t)(i * sizeof(rawChanged[0]))) = now")],
    "binding-bound": [("src/config.c", "input >= configKeyCount() + 3", "input >= (uint8_t)(configKeyCount() + 3)")],
    "palette-stride": [("src/config.c", "(keys + 1) >> 1", "(uint8_t)(keys + 1) >> 1"), ("src/config.c", "(configKeyCount() + 1) >> 1", "(uint8_t)(configKeyCount() + 1) >> 1")],
    "rotation-selection": [("src/actions.c", "configKeyCount() + (clockwise ? 1 : 2)", "configKeyCount() + (uint8_t)(clockwise ? 1 : 2)")],
    "mouse-xy-shifts": [("src/actions.c", "((second & 15) + 1) << 2", "(uint8_t)((second & 15) + 1) << 2"), ("src/actions.c", "((second >> 4) + 1) << 2", "(uint8_t)((second >> 4) + 1) << 2")],
    "layer-indicator-shift": [(SKETCH, "(command - CONFIG_LED_EFFECT_ON) << 1", "(uint8_t)(command - CONFIG_LED_EFFECT_ON) << 1")],
    "layer-mask": [("src/actions.c", "source |= chordPartner[input] << 4", "source |= (uint8_t)(chordPartner[input] << 4)")],
    "rainbow-speed-index": [(SKETCH, "rainbowFrameMs[colorPreviewActive ? activeConfig[CONFIG_HEADER_LED] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT : ledSettings[1]]", "rainbowFrameMs[(uint8_t)(colorPreviewActive ? activeConfig[CONFIG_HEADER_LED] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT : ledSettings[1])]")],
    "usb-out-subtraction": [(USB, "ep0ReportReceived + USB_RX_LEN <= ep0ReportExpected", "ep0ReportReceived <= ep0ReportExpected &&\n      USB_RX_LEN <= (uint8_t)(ep0ReportExpected - ep0ReportReceived)")],
    "led-relative-sum": [(SKETCH, "current + delta + count + count + count", "current + (uint8_t)delta + (uint8_t)(3 * count)")],
    "relative-layer-sum": [("src/actions.c", "selectedLayer + second + (layers << 3)", "selectedLayer + second + (uint8_t)(layers << 3)")],
    "pair-intermediate": [("src/config.c", "a * (2 * keys - a - 3)", "a * (uint8_t)(2 * keys - a - 3)")],
    "bootloader-clock": [(SKETCH, "(uint16_t)(millis() - start)", "(uint16_t)((uint16_t)millis() - start)")],
    "short-clock-locals": [(SKETCH, "uint32_t clock = millis();\n  uint16_t now = clock;", "uint16_t now = millis();")],
    "validator-layer-mask": [("src/config.c", "aux & (rotation << 1)", "aux & (uint8_t)(rotation << 1)")],
    "validator-mouse-limit": [("src/config.c", "aux <= (rotation ? 2 : 3)", "aux <= (uint8_t)(rotation ? 2 : 3)")],
    "led-color-cursor": [("src/config.c", "uint8_t colors = activeConfig[(uint8_t)(offset + (key >> 1))];", "offset += key >> 1;\n    uint8_t colors = activeConfig[offset];")],
    "string-cursor": [("src/config.c", "return activeConfig[(uint8_t)(start + position)];", "start += position;\n    return activeConfig[start];")],
    "xy-byte-decode": [("src/actions.c", "((second & 15) + 1) << 2", "((second << 2) & 0x3C) + 4"), ("src/actions.c", "((second >> 4) + 1) << 2", "((second >> 2) & 0x3C) + 4")],
    "metadata-subtraction": [("src/config.c", """    uint16_t end;
    uint16_t crc;""", """#if CONFIG_TIMED_MAX <= 5
    uint8_t end;
#else
    uint16_t end;
#endif
    uint16_t crc;"""), ("src/config.c", """    // Fixed records <=242; pool plus palettes <=142. Widen only their sum.
    end = (uint8_t)(9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers)) + (uint16_t)(uint8_t)(validationUsed + paletteBytes);""", """    // Both subtotals fit a byte; check capacity before their addition.
    end = 9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers);
    if (end > CONFIG_SIZE || (uint8_t)(validationUsed + paletteBytes) >
        (uint8_t)(CONFIG_SIZE - end)) return 0;
    end += validationUsed + paletteBytes;"""), ("src/config.c", """#endif
    if (end > CONFIG_SIZE) {
        return 0;
    }
    validationPool""", """    if (end > CONFIG_SIZE) {
        return 0;
    }
#endif
    validationPool""")],
}


def prepare(name):
    source = ARTIFACTS / name / "source"
    source.mkdir(parents=True, exist_ok=True)
    for directory in ("src", "tests", "pio-platform"):
        shutil.copytree(ROOT / directory, source / directory, dirs_exist_ok=True)
    for filename in (SKETCH, "platformio.ini"):
        shutil.copyfile(ROOT / filename, source / filename)
    if not (source / "webUploader").exists():
        (source / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)
    names = (SELECTED if name == "combined" else SELECTED + OPTIONAL if name == "expanded"
             else SELECTED + OPTIONAL + ["metadata-subtraction"] if name == "maximal"
             else [] if name == "baseline" else [name])
    for candidate in names:
        for filename, old, new in EDITS[candidate]:
            path = source / filename
            original = path.read_text()
            assert old in original, (candidate, filename, old)
            path.write_text(original.replace(old, new))
    patch, hashes = [], {}
    for path in sorted(source.rglob("*")):
        if not path.is_file() or "webUploader" in path.parts or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(source)
        hashes[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
        original = ROOT / relative
        if original.exists() and original.read_bytes() != path.read_bytes():
            patch.extend(difflib.unified_diff(original.read_text().splitlines(True), path.read_text().splitlines(True), fromfile="a/" + str(relative), tofile="b/" + str(relative)))
    (ARTIFACTS / name / "source-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
    (HERE / (name + ".patch")).write_text("".join(patch))
    return source


def build(job):
    name, source, variant = job
    output = ARTIFACTS / name / ("three" if variant else "six")
    result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"), "build", str(source), str(output), "24000000", "148", "14336", str(variant)], capture_output=True, text=True)
    if result.returncode:
        print(result.stdout[-1500:] + result.stderr[-1500:], flush=True)
        raise RuntimeError((name, variant, result.returncode))
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(candidate=name, variant=variant, flash=size("ROM/EPROM/FLASH"), paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"), stack=int(re.search(r"with (\d+) bytes available", mem)[1]), artifacts=str(output), firmware_sha256=hashlib.sha256((output / "firmware.hex").read_bytes()).hexdigest())
    row["free"] = 14336 - row["flash"]
    print(json.dumps(row), flush=True)
    return row


SELECTED = ["validator-timer-index", "macro-index", "press-mask", "release-mask",
            "usb-out-subtraction", "validator-layer-mask", "validator-mouse-limit",
            "led-color-cursor", "string-cursor"]
OPTIONAL = ["raw-changed-index", "string-descriptor-index", "palette-stride"]


def main():
    names = sys.argv[1:] or ["baseline", *EDITS]
    sources = {name: prepare(name) for name in names}
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(build, [(name, source, variant) for name, source in sources.items() for variant in (0, 1)]))
    destination = HERE / "results.json"
    results = dict(baseline_revision=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), artifacts=str(ARTIFACTS), rows=rows)
    if destination.exists():
        previous = json.loads(destination.read_text())
        results["rows"] = [row for row in previous["rows"] if row["candidate"] not in names] + rows
    destination.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
