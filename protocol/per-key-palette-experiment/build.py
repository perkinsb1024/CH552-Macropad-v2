"""Reproduce unoptimized palette probes without changing active firmware.

Both candidates use zero as the layer-palette sentinel and Off color. Candidate
format/palette identifiers are provisional and intentionally differ. No uploader,
configurator, migration, release generation or hardware flashing is performed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
REVISION = "0c7bbbe3312045e14a0d9d8ed91bc0ff0342e580"
SKETCH = "CH552_Universal_Macropad.ino"
CHANGED = (SKETCH, "src/config.c", "src/config.h")
CASES = ("baseline", "ideal", "fallback")


def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one occurrence: {old!r}")
    return text.replace(old, new)


def transform(source, case):
    if case == "baseline":
        return
    ideal = case == "ideal"
    header = source / "src/config.h"
    text = header.read_text()
    text = once(text, "#define CONFIG_VERSION 15", f"#define CONFIG_VERSION {16 if ideal else 17}")
    text = once(text, "#define CONFIG_PALETTE_VERSION 3", f"#define CONFIG_PALETTE_VERSION {4 if ideal else 5}\n#define CONFIG_PER_KEY_RAINBOW {int(ideal)}")
    text = once(text, "// Format 15 uses the B header and per-layer built-in LED auto-sleep.",
                "// Experimental sentinel palette layout; not a published format.")
    text = once(text, "uint8_t configLedColorOffset(uint8_t layer);",
                "uint8_t configLedColorOffset(uint8_t layer);\n// Offset of this layer's optional palette, or the section end for layerCount.\nuint8_t configLayerPaletteOffset(uint8_t layer);")
    header.write_text(text)

    config = source / "src/config.c"
    text = config.read_text()
    start = text.index("__code uint8_t configPalette[16][3] = {")
    end = text.index("\n};", start) + 3
    palette = """__code uint8_t configPalette[16][3] = {
  { 0, 0, 0 }, // Off; zero is a source sentinel only in the layer options.
  { 255, 0, 0 }, // Red
  { 255, 22, 7 }, // Coral
  { 255, 16, 0 }, // Orange
  { 255, 66, 0 }, // Amber
  { 255, 124, 0 }, // Yellow
  { 60, 255, 0 }, // Green
  { 100, 200, 20 }, // Leaf
  { 0, 255, 200 }, // Cyan
  { 0, 91, 255 }, // Azure
  { 0, 0, 255 }, // Blue
  { 115, 0, 180 }, // Violet
  { 255, 0, 194 }, // Magenta
  { 255, 0, 72 }, // Rose
  { 255, 255, 255 }, // White
""" + ("  { 0, 0, 0 }, // Rainbow is rendered procedurally.\n" if ideal else
          "  { 29, 123, 67 }, // Teal in per-key palettes; uniform layer/effect 15 is Rainbow.\n") + "};"
    text = text[:start] + palette + text[end:]
    text = once(text, "    uint8_t chords;", "    uint8_t chords;\n    __idata uint8_t paletteBytes;")
    text = once(text, "    validationUsed = validationImage[CONFIG_HEADER_POOL] >> CONFIG_HEADER_POOL_SHIFT;",
                """    // Layer records keep their original stride; palettes follow all layers.
    paletteBytes = 0;
    for (layer = 0; layer < validationLayers; layer++) {
        if (!(validationImage[9 + (uint8_t)(size * (layer + 1)) - 1] & CONFIG_LAYER_OPT_COLOR_MASK))
            paletteBytes += (keys + 1) >> 1;
    }
    validationUsed = validationImage[CONFIG_HEADER_POOL] >> CONFIG_HEADER_POOL_SHIFT;""")
    text = once(text, "          (uint8_t)(CONFIG_TIMED_SIZE * timers) + (uint16_t)validationUsed;",
                "          (uint8_t)(CONFIG_TIMED_SIZE * timers) + (uint16_t)validationUsed + paletteBytes;")
    text = once(text, "    for (i = 0; i < chords; i++) {", """    if (keys == 3) {
        for (i = 0; i < paletteBytes; i += 2)
            if (validationImage[(uint8_t)(offset + i + 1)] & 0xF0) return 0;
    }
    offset += paletteBytes;
    for (i = 0; i < chords; i++) {""")
    text = once(text, "uint8_t configLedColorAt(uint8_t offset, uint8_t key) {", """uint8_t configLayerPaletteOffset(uint8_t layer) {
    uint8_t offset = layerOffset(configLayerCount());
    uint8_t i;
    for (i = 0; i < layer; i++) {
        if (!(configLayerOptions(i) & CONFIG_LAYER_OPT_COLOR_MASK))
            offset += (configKeyCount() + 1) >> 1;
    }
    return offset;
}

uint8_t configLedColorAt(uint8_t offset, uint8_t key) {""")
    text = once(text, "    uint8_t offset = layerOffset(layers);",
                "    uint8_t offset = configLayerPaletteOffset(layers);")
    text = once(text, "    return layerOffset(configLayerCount()) + 3 * (activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT);",
                "    return configLayerPaletteOffset(configLayerCount()) + 3 * (activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT);")
    config.write_text(text)

    sketch = source / SKETCH
    text = sketch.read_text()
    text = once(text, "  uint8_t palette = options >> CONFIG_LAYER_OPT_COLOR_SHIFT;", """  uint8_t palette = options >> CONFIG_LAYER_OPT_COLOR_SHIFT;
  __idata uint8_t layerColors = 0;
  if (!previewOptions && !palette) layerColors = configLayerPaletteOffset(layer);""")
    text = once(text, "    uint8_t color = palette;", """    uint8_t background = layerColors ? configLedColorAt(layerColors, i) : palette;
    uint8_t color = background;""")
    text = once(text, "((color = configLedColorAt(colors, i)) != 15 ||",
                "((color = configLedColorAt(colors, i)) != 0 ||")
    text = once(text, "      color = palette;\n      if (behavior", "      color = background;\n      if (behavior")
    if ideal:
        text = once(text, "static ACTION_BIT colorPreviewActive;",
                    "static ACTION_BIT colorPreviewActive;\n// Cached during rendering; custom rainbow sources must also drive the clock.\nstatic ACTION_BIT perKeyRainbowActive;")
        text = once(text, "void updateLeds() {", "void updateLeds() {\n  perKeyRainbowActive = 0;")
        text = once(text, "    ACTION_BIT rainbow = baseRainbow;", """    ACTION_BIT rainbow = baseRainbow;
    if (layerColors && color == 15) {
      rainbow = 1;
      perKeyRainbowActive = 1;
    }""")
        text = once(text, "      rainbow = 0; // Key palette 15 is Off, never Rainbow.",
                    "      rainbow = color == 15;\n      if (rainbow) perKeyRainbowActive = 1;")
        text = once(text, "    if (animationOptions >= 0xF4) {",
                    "    if (animationOptions >= 0xF4 || perKeyRainbowActive) {")
    else:
        text = once(text, "      rainbow = 0; // Key palette 15 is Off, never Rainbow.",
                    "      rainbow = 0; // Key and custom-layer palette 15 is Teal.")
    sketch.write_text(text)


def prepare(output):
    archive = subprocess.check_output(["git", "archive", "--format=zip", REVISION,
        "src", "tests", "pio-platform", SKETCH, "platformio.ini"], cwd=ROOT)
    for case in CASES:
        source = output / case / "source"
        if source.exists():
            raise RuntimeError(f"Refusing to overwrite preserved source: {source}")
        source.mkdir(parents=True)
        with ZipFile(BytesIO(archive)) as zipped:
            zipped.extractall(source)
        (source / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)
        before = {name: (source / name).read_text() for name in CHANGED}
        transform(source, case)
        patch = "".join("".join(difflib.unified_diff(before[name].splitlines(keepends=True),
            (source / name).read_text().splitlines(keepends=True), fromfile="a/"+name,
            tofile="b/"+name)) for name in CHANGED)
        (HERE / f"{case}.patch").write_text(patch)
        (source / "tests/per_key_palette_probe.c").write_text((HERE / "probe.c").read_text())
        hashes = {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in CHANGED}
        (output / case / "source-sha256.json").write_text(json.dumps(hashes, indent=2)+"\n")


def build_one(output, case, variant):
    source = output / case / "source"
    label = "six" if variant == 0 else "three"
    directory = output / case / label
    directory.mkdir(parents=True, exist_ok=True)
    row = dict(case=case, variant=variant, source_revision=REVISION)
    # Diagnostic linking measures oversized code but never claims CH552 fit.
    for limit in (16384, 14336):
        build = directory / str(limit)
        log = directory / f"build-{limit}.log"
        with log.open("w") as stream:
            result = subprocess.run([sys.executable, str(source / "pio-platform/build_firmware.py"),
                "build", str(source), str(build), "24000000", "148", str(limit), str(variant)],
                stdout=stream, stderr=subprocess.STDOUT)
        row[f"exit_{limit}"] = result.returncode
        if limit == 16384 and (build / "firmware.mem").exists():
            mem = (build / "firmware.mem").read_text()
            for key, title in (("flash", "ROM/EPROM/FLASH"), ("paged", "PAGED EXT. RAM"), ("external", "EXTERNAL RAM")):
                row[key] = int(re.search(rf"{re.escape(title)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
            row["stack"] = int(re.search(r"with (\d+) bytes available", mem)[1])
            row["headroom"] = 14336-row["flash"]
            row["total_external"] = 148+134+row["paged"]+row["external"]
        if limit == 16384 and result.returncode:
            raise RuntimeError(f"Diagnostic build failed: {log}")
    print(json.dumps(row), flush=True)
    return row


def validate(output, case, variant, preview):
    source = output / case / "source"
    label = f"{'six' if variant == 0 else 'three'}-{'preview' if preview else 'no-preview'}"
    log = output / case / f"host-{label}.log"
    flags = ["cc", "-std=c99", "-Wall", "-Wextra", "-Wno-unknown-pragmas", "-Wno-unused-function",
        "-Wno-bitwise-op-parentheses", "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=",
        "-D__pdata=", "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
        f"-DENABLE_COLOR_PREVIEW={int(preview)}", "-Itests/stubs",
        "-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552",
        "-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino"]
    binary = output / case / f"probe-{label}"
    with log.open("w") as stream:
        subprocess.run([*flags, "tests/per_key_palette_probe.c", "src/config.c", "src/actions.c",
                        "-o", str(binary)], cwd=source, stdout=stream, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(binary)], stdout=stream, stderr=subprocess.STDOUT, check=True)
    return dict(case=case, variant=variant, preview=preview, passed=True, log=str(log))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if args.prepare:
        prepare(output)
    if args.build:
        jobs = [(case, variant) for case in CASES for variant in (0, 1)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(lambda job: build_one(output, *job), jobs))
        for row in rows:
            base = next(r for r in rows if r["case"] == "baseline" and r["variant"] == row["variant"])
            row["flash_delta"] = row["flash"]-base["flash"]
            row["stack_delta"] = row["stack"]-base["stack"]
        (HERE / "results.json").write_text(json.dumps(dict(revision=REVISION, artifact_root=str(output),
            builds=rows), indent=2)+"\n")
    if args.validate:
        rows = [validate(output, case, variant, preview) for case in ("ideal", "fallback")
                for variant in (0, 1) for preview in (True, False)]
        (HERE / "validation.json").write_text(json.dumps(rows, indent=2)+"\n")


if __name__ == "__main__":
    main()
