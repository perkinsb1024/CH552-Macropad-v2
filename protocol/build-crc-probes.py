"""Measure CRC candidates against immutable sources, without changing active firmware.

Each generated source tree retains the v15 identifier solely to isolate CRC costs.
These are measurement artifacts, never production-compatible v15 firmware.
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

ROOT = Path(__file__).resolve().parents[1]
REVISION = "a14798a4450c85d88d96f9e5cad598da552de0b6"
FILES = ["src", "tests", "pio-platform", "CH552_Universal_Macropad.ino", "platformio.ini"]
CASES = ("baseline", "crc10-core", "crc10-packed", "crc10-right-core", "crc10-right-packed",
         "crc10-aligned-core", "crc10-aligned-packed", "crc8-core", "crc8-byte", "crc8-packed")


def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected exactly one occurrence of {old!r}")
    return text.replace(old, new)


def parameters(case):
    width = 16 if case == "baseline" else 10 if case.startswith("crc10") else 8
    return width, "packed" in case, case in ("crc8-byte", "crc8-packed")


def transform(source, case):
    width, packed, byte = parameters(case)
    if case == "baseline":
        return
    config = source / "src/config.c"
    text = config.read_text()
    start = text.index("uint16_t configCrc(")
    end = text.index("\nstatic FW_BIT keyboardUsageValid", start)
    scalar = "uint8_t" if byte else "uint16_t"
    skip = "if (i == 6) continue;" if packed else "if (i == 6 || i == 7) continue;"
    value = "(i == 7 ? image[i] & 0xFC : image[i])" if packed and width == 10 else "image[i]"
    if width == 10:
        # Left alignment keeps overflow implicit in the uint16_t assignment.
        update = f"crc ^= (uint16_t){value} << 8;"
        high = "(uint8_t)(crc >> 8) & 0x80"
        poly = "0x8CC0"  # 0x233 << 6
        result = "crc >> 6"
        accumulator = "uint16_t"
        if "right" in case:
            update = f"crc ^= (uint16_t){value} << 2;"
            high = "(uint8_t)(crc >> 8) & 2"
            poly = "0x233"
            result = "crc & 0x3FF"
        elif "aligned" in case:
            result = "crc"
            if packed:
                value = "(i == 6 ? image[i] & 0x3F : image[i])"
                skip = "if (i == 7) continue;"
                update = f"crc ^= (uint16_t){value} << 8;"
    else:
        update = f"crc ^= {value};"
        high = "crc & 0x80"
        poly = "0x07"
        result = "crc"
        accumulator = "uint8_t"
    text = text[:start] + f"""{scalar} configCrc(const __xdata uint8_t *image) {{
    {accumulator} crc = 0;
    uint8_t i;
    uint8_t bit;
    for (i = 0; i < CONFIG_SIZE; i++) {{
        {skip}
        {update}
        for (bit = 0; bit < 8; bit++) {{
            uint8_t high = {high};
            crc <<= 1;
            if (high) crc ^= {poly};
        }}
    }}
    return {result};
}}
""" + text[end:]
    if byte:
        text = once(text, "    uint16_t crc;", "    uint8_t crc;")
        text = once(text, "validationImage[6] == (uint8_t)crc && validationImage[7] == (uint8_t)(crc >> 8)",
                    "validationImage[6] == crc" if packed else "validationImage[6] == crc && validationImage[7] == 0")
        header = source / "src/config.h"
        header.write_text(once(header.read_text(), "uint16_t configCrc(", "uint8_t configCrc("))
    elif packed:
        if "aligned" in case:
            text = once(text, "validationImage[6] == (uint8_t)crc", "(validationImage[6] & 0xC0) == (uint8_t)crc")
        else:
            text = once(text, "validationImage[7] == (uint8_t)(crc >> 8)",
                        "(validationImage[7] & 3) == (uint8_t)(crc >> 8)")
    config.write_text(text)
    protocol = source / "src/protocol_firmware.c"
    text = protocol.read_text()
    if byte:
        text = once(text, "__xdata uint16_t uploadCrc;", "__xdata uint8_t uploadCrc;")
        text = once(text, "  uint16_t crc;", "  uint8_t crc;")
        text = once(text, "      uploadCrc = protocolInbox[10] | ((uint16_t)protocolInbox[11] << 8);",
                    "      if (protocolInbox[11]) return PROTOCOL_BAD_CRC;\n      uploadCrc = protocolInbox[10];")
        text = once(text, "if (crc != uploadCrc || stagedConfig[6] != (uint8_t)crc ||\n          stagedConfig[7] != (uint8_t)(crc >> 8))",
                    "if (crc != uploadCrc || stagedConfig[6] != crc" +
                    ("" if packed else " || stagedConfig[7] != 0") + ")")
    elif packed:
        if "aligned" in case:
            text = once(text, "stagedConfig[6] != (uint8_t)crc", "(stagedConfig[6] & 0xC0) != (uint8_t)crc")
        else:
            text = once(text, "stagedConfig[7] != (uint8_t)(crc >> 8)",
                        "(stagedConfig[7] & 3) != (uint8_t)(crc >> 8)")
    protocol.write_text(text)


def reference_header(case):
    width, packed, _ = parameters(case)
    mask = (1 << width) - 1
    poly = {16: 0x1021, 10: 0x233, 8: 7}[width]
    init = 0xFFFF if width == 16 else 0
    settings_mask = 0xFC if packed and width == 10 else 0xFF if packed else 0
    settings_byte = 6 if "aligned" in case and packed else 7
    if settings_byte == 6:
        settings_mask = 0x3F
    return f"""#ifndef CRC_PROBE_REFERENCE_H
#define CRC_PROBE_REFERENCE_H
#include <stdint.h>
#define PROBE_WIDTH {width}
#define PROBE_PACKED {int(packed)}
#define PROBE_SETTINGS_MASK {settings_mask}
#define PROBE_SETTINGS_BYTE {settings_byte}
#define PROBE_ALIGNED {int('aligned' in case)}
/* Independent input-bit division; production injects complete bytes. */
static uint16_t probeReference(const uint8_t *bytes, unsigned length, uint8_t image) {{
    uint16_t crc = {init};
    for (unsigned i = 0; i < length; i++) {{
        if (image && ((!PROBE_PACKED && (i == 6 || i == 7)) ||
                      (PROBE_PACKED && i == (PROBE_SETTINGS_BYTE == 6 ? 7 : 6)))) continue;
        uint8_t value = bytes[i];
        if (image && PROBE_PACKED && PROBE_WIDTH == 10 && i == PROBE_SETTINGS_BYTE) value &= PROBE_SETTINGS_MASK;
        for (unsigned bit = 0; bit < 8; bit++) {{
            uint8_t feedback = ((crc >> ({width} - 1)) ^ (value >> (7 - bit))) & 1;
            crc = (crc << 1) & {mask};
            if (feedback) crc ^= {poly};
        }}
    }}
    return image && PROBE_ALIGNED ? crc << 6 : crc;
}}
#endif
"""


def adapt_tests(source, case):
    (source / "tests/crc_probe_reference.h").write_text(reference_header(case))
    width, packed, _ = parameters(case)
    if case != "baseline":
        test = source / "tests/timed_actions_test.c"
        text = test.read_text()
        start = text.index("        uint16_t expected = 0xFFFF;")
        end = text.index("        assert(configCrc(activeConfig) == expected);", start)
        text = text[:start] + "        uint16_t expected = probeReference(activeConfig, CONFIG_SIZE, 1);\n" + text[end:]
        masks = (0xC0, 0xFF) if packed and "aligned" in case else (0xFF, 3 if packed and width == 10 else 0 if packed else 255)
        text = once(text, "activeConfig[6] ^= 0xFF; activeConfig[7] ^= 0xFF;",
                    f"activeConfig[6] ^= {masks[0]}; activeConfig[7] ^= {masks[1]};")
        test.write_text('#include "crc_probe_reference.h"\n' + text)
    if packed:
        # Preserve newly reclaimed settings when existing fixtures reseal an image.
        mask = 0xFC if width == 10 else 0xFF
        aligned = "aligned" in case
        for test in (source / "tests").glob("*.*"):
            if test.suffix not in (".c", ".h"):
                continue
            text = test.read_text()
            if aligned:
                text = re.sub(r"(activeConfig|image)\[6\] = (?:\(uint8_t\))?crc;",
                              lambda m: f"{m[1]}[6] = ({m[1]}[6] & 0x3F) | (uint8_t)crc;", text)
            else:
                text = re.sub(r"(activeConfig|image)\[7\] = (?:\(uint8_t\))?\(?crc >> 8\)?;",
                              lambda m: f"{m[1]}[7] = ({m[1]}[7] & {mask}) | (crc >> 8);", text)
            test.write_text(text)
        test = source / "tests/protocol_test.c"
        text = once(test.read_text(), "uint8_t data[3] = {128, upload[6], upload[7]};",
                    "uint8_t data[3] = {128, upload[6] & 0xC0, upload[7]};" if aligned else
                    f"uint8_t data[3] = {{128, upload[6], upload[7] & {3 if width == 10 else 0}}};")
        test.write_text(text)


def measure(source, output, case, variant):
    build = output / f"{case}-{variant}"
    log = output / f"{case}-{variant}.log"
    with log.open("w") as stream:
        result = subprocess.run([sys.executable, str(source / "pio-platform/build_firmware.py"), "build",
                                 str(source), str(build), "24000000", "148", "14336", str(variant)],
                                stdout=stream, stderr=subprocess.STDOUT)
    row = {"case": case, "variant": variant, "exit": result.returncode, "log": str(log)}
    if (build / "firmware.mem").exists():
        mem = (build / "firmware.mem").read_text()
        row["flash"] = int(re.search(r"ROM/EPROM/FLASH\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
        row["stack"] = int(re.search(r"with (\d+) bytes available", mem)[1])
        mapping = (build / "firmware.map").read_text()
        for area in ("PSEG", "XSEG", "SSEG"):
            row[area.lower()] = int(re.search(rf"(?m)^\s*([0-9A-F]{{8}})\s+l_{area}\b", mapping)[1], 16)
        row["external_allocated"] = 148 + row["pseg"] + row["xseg"] + 134
    print(json.dumps(row), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/private/tmp/macropad-crc-investigation"))
    parser.add_argument("--cases", nargs="+", choices=CASES, default=list(CASES))
    parser.add_argument("--host", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = subprocess.check_output(["git", "archive", "--format=zip", REVISION, *FILES], cwd=ROOT)
    sources = {}
    for case in args.cases:
        source = output / case / "source"
        if args.validate_only:
            # Recreate only test adaptations from their immutable originals.
            with ZipFile(BytesIO(archive)) as files:
                for name in files.namelist():
                    if name.startswith("tests/") and not name.endswith("/"):
                        files.extract(name, source)
            adapt_tests(source, case)
            sources[case] = source
            continue
        source.mkdir(parents=True, exist_ok=True)
        with ZipFile(BytesIO(archive)) as files:
            files.extractall(source)
        # Read-only host-test include dependency; production native builder uses installed core.
        (source / "webUploader").mkdir(exist_ok=True)
        upstream = source / "webUploader/upstream"
        if not upstream.is_symlink():
            upstream.symlink_to(ROOT / "webUploader/upstream", target_is_directory=True)
        transform(source, case)
        patch = ""
        hashes = {}
        for name in ("src/config.c", "src/config.h", "src/protocol_firmware.c"):
            original = subprocess.check_output(["git", "show", f"{REVISION}:{name}"], cwd=ROOT, text=True)
            updated = (source / name).read_text()
            patch += "".join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True),
                                                fromfile="a/" + name, tofile="b/" + name))
            hashes[name] = hashlib.sha256(updated.encode()).hexdigest()
        (output / f"{case}.patch").write_text(patch)
        (output / f"{case}-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
        adapt_tests(source, case)
        sources[case] = source
    failed = False
    if not args.validate_only:
        jobs = [(case, variant) for case in args.cases for variant in (0, 1)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(lambda job: measure(sources[job[0]], output, *job), jobs))
        result_file = output / "results.json"
        old = json.loads(result_file.read_text())["builds"] if result_file.exists() else []
        combined = {(row["case"], row["variant"]): row for row in old + rows}
        result_file.write_text(json.dumps({"revision": REVISION, "builds": sorted(combined.values(),
                                               key=lambda row: (row["case"], row["variant"]))}, indent=2) + "\n")
        failed = any(row["exit"] for row in rows)
    if args.host:
        for case in args.cases:
            for preview in (True, False):
                log = output / f"{case}-host{'-no-preview' if not preview else ''}.log"
                with log.open("w") as stream:
                    result = subprocess.run([sys.executable, "tests/run_host_tests.py"] + ([] if preview else ["--no-preview"]),
                                            cwd=sources[case], stdout=stream, stderr=subprocess.STDOUT)
                print(f"Host {case}, preview={preview}: {result.returncode}; {log}", flush=True)
                failed |= bool(result.returncode)
            source = sources[case]
            (source / "protocol").mkdir(exist_ok=True)
            (source / "protocol/crc-integrity-probe.c").write_bytes((ROOT / "protocol/crc-integrity-probe.c").read_bytes())
            for variant in (0, 1):
                log = output / f"{case}-integrity-{variant}.log"
                binary = output / f"{case}-integrity-{variant}"
                with log.open("w") as stream:
                    command = ["cc", "-std=c99", "-O2", "-Wall", "-Wextra", "-Wno-unknown-pragmas",
                               *["-D" + space + "=" for space in ("__data", "__idata", "__pdata", "__xdata", "__code")],
                               f"-DPHYSICAL_VARIANT={variant}", "protocol/crc-integrity-probe.c", "src/config.c",
                               "src/storage.c", "src/protocol_firmware.c", "-o", str(binary)]
                    result = subprocess.run(command, cwd=source, stdout=stream, stderr=subprocess.STDOUT)
                    if result.returncode == 0:
                        result = subprocess.run([str(binary)], cwd=source, stdout=stream, stderr=subprocess.STDOUT)
                print(f"Integrity {case}, variant={variant}: {result.returncode}; {log}", flush=True)
                failed |= bool(result.returncode)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
