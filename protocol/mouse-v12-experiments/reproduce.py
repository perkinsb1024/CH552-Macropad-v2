"""Rebuild preserved mouse experiments in temporary sources; never emit releases."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECORD = json.loads((HERE / "measurements.json").read_text())
SOURCE_PATHS = ["src", "tests", "pio-platform", "platformio.ini",
                "CH552_Universal_Macropad.ino"]


def prepare(work, case):
    record = RECORD["cases"][case]
    archive = subprocess.check_output(
        ["git", "archive", record["baseline_revision"], *SOURCE_PATHS], cwd=ROOT
    )
    for implementation in ("baseline", "prototype"):
        source = work / case / implementation
        source.mkdir(parents=True)
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            files.extractall(source, filter="data")
        if implementation == "prototype":
            subprocess.run(["git", "apply", str(HERE / record["patch"])],
                           cwd=source, check=True)
        for name, hashes in record["changed_source_hashes"].items():
            digest = hashlib.sha256((source / name).read_bytes()).hexdigest()
            if digest != hashes[implementation + "_sha256"]:
                raise RuntimeError(f"Preserved source hash mismatch: {source / name}")


def measure(work, task):
    case, implementation, variant = task
    source = work / case / implementation
    output = work / case / f"{implementation}-build-{variant}"
    log = output.with_suffix(".log")
    with log.open("w") as stream:
        subprocess.run([sys.executable, str(source / "pio-platform/build_firmware.py"),
                        "build", str(source), str(output), "24000000", "148", "14336",
                        str(variant)], stdout=stream, stderr=subprocess.STDOUT, check=True)
    mem = (output / "firmware.mem").read_text()

    def size(label):
        return int(re.search(re.escape(label) + r"\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])

    flash = size("ROM/EPROM/FLASH")
    result = dict(case=case, implementation=implementation,
                  variant="six-key" if variant == 0 else "three-key",
                  flash_bytes=flash, spare_flash_bytes=14336 - flash,
                  paged_ram_bytes=size("PAGED EXT. RAM"),
                  ordinary_xseg_bytes=size("EXTERNAL RAM"),
                  absolute_active_image_bytes=128,
                  stack_capacity_bytes=int(re.search(r"with (\d+) bytes available", mem)[1]))
    expected = next(row for row in RECORD["cases"][case]["measurements"]
                    if row["implementation"] == implementation and row["variant"] == result["variant"])
    result["matches_recorded_measurements"] = all(result[k] == v for k, v in expected.items())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=[*RECORD["cases"], "all"], default="five-buttons")
    parser.add_argument("--prepare-only", action="store_true")
    options = parser.parse_args()
    cases = list(RECORD["cases"]) if options.case == "all" else [options.case]
    work = Path(tempfile.mkdtemp(prefix="macropad-mouse-experiments-"))
    print(f"Temporary sources and outputs: {work}", flush=True)
    for case in cases:
        prepare(work, case)
    if options.prepare_only:
        print("Patches applied and preserved source hashes verified.")
        return
    tasks = [(case, implementation, variant) for case in cases
             for implementation in ("baseline", "prototype") for variant in (0, 1)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda task: measure(work, task), tasks))
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    for result in results:
        print(json.dumps(result), flush=True)
    if not all(result["matches_recorded_measurements"] for result in results):
        raise SystemExit("Measurements differ; inspect the toolchain and temporary build logs.")


if __name__ == "__main__":
    main()
