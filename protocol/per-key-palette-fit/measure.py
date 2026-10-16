"""Snapshot and measure a v16 fitting candidate; never generate releases."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASE = "bc3341b"
ARTIFACTS = Path("/private/tmp/macropad-v16-fit")
FILES = ("CH552_Universal_Macropad.ino", "src/config.c", "src/config.h",
         "src/actions.c", "src/timed_actions.inc", "src/protocol_firmware.c")


def snapshot(label, origin):
    source = ARTIFACTS / label / "source"
    if source.exists():
        raise RuntimeError(f"Preserving existing snapshot: {source}")
    source.mkdir(parents=True)
    for name in ("src", "tests", "pio-platform"):
        shutil.copytree(origin / name, source / name, ignore=shutil.ignore_patterns("__pycache__"))
    for name in ("CH552_Universal_Macropad.ino", "platformio.ini"):
        shutil.copyfile(origin / name, source / name)
    (source / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)
    patch = ""
    for name in FILES:
        old = subprocess.check_output(["git", "show", f"{BASE}:{name}"], cwd=ROOT).decode()
        patch += "".join(difflib.unified_diff(old.splitlines(keepends=True),
            (source / name).read_text().splitlines(keepends=True), fromfile="a/"+name, tofile="b/"+name))
    (HERE / f"{label}.patch").write_text(patch)
    return source


def measure(label, source, variant):
    board = "six" if variant == 0 else "three"
    directory = ARTIFACTS / label / board
    directory.mkdir(parents=True)
    log = directory / "build.log"
    with log.open("w") as stream:
        result = subprocess.run([sys.executable, str(source / "pio-platform/build_firmware.py"),
            "build", str(source), str(directory / "build"), "24000000", "148", "16384", str(variant)],
            stdout=stream, stderr=subprocess.STDOUT)
    row = dict(label=label, variant=variant, diagnostic_exit=result.returncode)
    mempath = directory / "build/firmware.mem"
    if not mempath.exists() or result.returncode:
        raise RuntimeError(f"Failed diagnostic build: {log}")
    mem = mempath.read_text()
    for key, title in (("flash", "ROM/EPROM/FLASH"), ("paged", "PAGED EXT. RAM"), ("external", "EXTERNAL RAM")):
        row[key] = int(re.search(rf"{re.escape(title)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row["stack"] = int(re.search(r"with (\d+) bytes available", mem)[1])
    row["free"] = 14336-row["flash"]
    row["source_sha256"] = {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in FILES}
    print(json.dumps({k:v for k,v in row.items() if k != "source_sha256"}), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("label")
    parser.add_argument("--source", type=Path, default=ROOT)
    args = parser.parse_args()
    source = snapshot(args.label, args.source.resolve())
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda variant: measure(args.label, source, variant), (0, 1)))
    file = HERE / "results.json"
    ledger = json.loads(file.read_text()) if file.exists() else []
    ledger.extend(rows)
    file.write_text(json.dumps(ledger, indent=2)+"\n")


if __name__ == "__main__":
    main()
