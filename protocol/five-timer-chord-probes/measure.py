"""Measure isolated firmware candidates without changing the active firmware/editor."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ARTIFACTS = Path(tempfile.mkdtemp(prefix="macropad-five-timer-chords-"))


def replace(source, name, old, new):
    path = source / name
    text = path.read_text()
    assert old in text, (name, old)
    path.write_text(text.replace(old, new))


def timers(source):
    replace(source, "src/config.h", "#define CONFIG_TIMED_MAX 4", "#define CONFIG_TIMED_MAX 5")
    replace(source, "src/actions.c", "uint8_t i = 5;\n  do {", "uint8_t i = 6;\n  do {")
    replace(source, "src/actions.c", "(5 + i)] = timedHigh", "(6 + i)] = timedHigh")
    replace(source, "src/actions.c", "(10 + i)] = timedFraction", "(12 + i)] = timedFraction")
    replace(source, "src/actions.c", "runAction(currentFirst, currentSecond, 0, 14);", "runAction(currentFirst, currentSecond, 0, 15);")
    replace(source, "src/protocol_firmware.c", "protocolReply[7] = 17;", "protocolReply[7] = 20;")
    replace(source, "src/protocol_firmware.c", "liveReply[15] = activeConfig[CONFIG_HEADER_CRC];", "liveReply[18] = activeConfig[CONFIG_HEADER_CRC];")
    replace(source, "src/protocol_firmware.c", "liveReply[16] = activeConfig[CONFIG_HEADER_CRC + 1];", "liveReply[19] = activeConfig[CONFIG_HEADER_CRC + 1];")
    replace(source, "tests/live_state_test.c", "i < 5", "i < 6")
    replace(source, "tests/live_state_test.c", "protocolReply[7] == 17", "protocolReply[7] == 20")
    replace(source, "tests/live_state_test.c", "protocolReply[14 + i] == 9 + i", "protocolReply[15 + i] == 9 + i")
    replace(source, "tests/live_state_test.c", "protocolReply[19 + i] == 123 + i", "protocolReply[21 + i] == 123 + i")
    replace(source, "tests/live_state_test.c", "protocolReply[24] == activeConfig[7] && protocolReply[25] == activeConfig[8]", "protocolReply[27] == activeConfig[7] && protocolReply[28] == activeConfig[8]")
    replace(source, "tests/header_repacking_test.c", "timers <= 4", "timers <= CONFIG_TIMED_MAX")


def chord_seven(source):
    replace(source, "src/config.c", "if (((id >> 4) & 7) >= validationLayers ||", "if (((id >> 4) != 7 && (id >> 4) >= validationLayers) ||")
    replace(source, "src/config.c", "(activeConfig[offset] & 0x8F) == (0x80 | (id & 15))", "activeConfig[offset] == (0x70 | (id & 15))")


def chord_zero(source):
    replace(source, "src/config.c", "if (((id >> 4) & 7) >= validationLayers ||", "if ((id >> 4) > validationLayers ||")
    replace(source, "src/config.c", "id = layer << 4 | pairIndex", "id = (layer + 1) << 4 | pairIndex")
    replace(source, "src/config.c", "(activeConfig[offset] & 0x8F) == (0x80 | (id & 15))", "activeConfig[offset] == (id & 15)")
    # Keep local chords before globals so a local binding still overrides its global.
    replace(source, "src/config.c", "(i && id <= previous)", "(i && (uint8_t)(id - 16) <= (uint8_t)(previous - 16))")


def narrow(source):
    path = source / "src/config.c"
    text = path.read_text()
    start = text.index("#if CONFIG_TIMED_MAX <= 4")
    end = text.index("#endif", start) + len("#endif")
    text = text[:start] + """#if CONFIG_TIMED_MAX <= 5
    // Fixed records <=242; pool plus palettes <=142. Widen only their sum.
    end = (uint8_t)(9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers)) + (uint16_t)(uint8_t)(validationUsed + paletteBytes);
#else
    end = 9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers) + (uint16_t)validationUsed + paletteBytes;
#endif""" + text[end:]
    path.write_text(text)


def prepare(name):
    source = ARTIFACTS / name / "source"
    source.mkdir(parents=True)
    for directory in ("src", "tests", "pio-platform"):
        shutil.copytree(ROOT / directory, source / directory)
    for filename in ("CH552_Universal_Macropad.ino", "platformio.ini"):
        shutil.copyfile(ROOT / filename, source / filename)
    (source / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)
    if "five" in name:
        timers(source)
    if "seven" in name:
        chord_seven(source)
    if "zero" in name:
        chord_zero(source)
    if "narrow" in name:
        narrow(source)
    patch = []
    hashes = {}
    for directory in ("src", "tests"):
        for path in sorted((source / directory).rglob("*")):
            if not path.is_file() or path.suffix not in (".c", ".h", ".inc", ".py"):
                continue
            relative = path.relative_to(source)
            hashes[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
            original = ROOT / relative
            if original.exists():
                patch.extend(difflib.unified_diff(original.read_text().splitlines(True), path.read_text().splitlines(True), fromfile="a/" + str(relative), tofile="b/" + str(relative)))
    if patch:
        (HERE / (name + ".patch")).write_text("\n".join(line.rstrip() for line in "".join(patch).splitlines()) + "\n")
    (ARTIFACTS / name / "source-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
    return source


def build(job):
    name, source, variant = job
    output = ARTIFACTS / name / ("three" if variant else "six")
    limit = 14336 if name == "baseline" else 16384
    command = [sys.executable, str(ROOT / "pio-platform/build_firmware.py"), "build", str(source), str(output), "24000000", "148", str(limit), str(variant)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        print(result.stdout[-2000:] + result.stderr[-2000:], flush=True)
        raise RuntimeError((name, variant, result.returncode))
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(candidate=name, variant=variant, flash=size("ROM/EPROM/FLASH"), paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"), stack=int(re.search(r"with (\d+) bytes available", mem)[1]), diagnostic_limit=limit, artifacts=str(output), firmware_sha256=hashlib.sha256((output / "firmware.hex").read_bytes()).hexdigest())
    row["free"] = 14336 - row["flash"]
    row["total_external"] = 148 + 134 + row["paged"] + row["external"]
    print(json.dumps(row), flush=True)
    return row


def main():
    names = sys.argv[1:] or ["baseline", "five", "chord-seven", "chord-zero", "five-chord-seven", "five-chord-zero", "five-narrow", "five-narrow-chord-seven"]
    print(f"Artifacts: {ARTIFACTS}", flush=True)
    sources = {name: prepare(name) for name in names}
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(build, [(name, source, variant) for name, source in sources.items() for variant in (0, 1)]))
    results = dict(baseline_revision=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), artifacts=str(ARTIFACTS), rows=rows)
    destination = HERE / "results.json"
    if destination.exists():
        previous = json.loads(destination.read_text())
        results["rows"] = [row for row in previous["rows"] if row["candidate"] not in names] + rows
        results["earlier_artifacts"] = previous.get("earlier_artifacts", []) + [previous["artifacts"]]
    destination.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
