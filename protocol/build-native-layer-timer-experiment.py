"""Build the retained, opt-in experiment at the real application flash limit."""
from concurrent.futures import ThreadPoolExecutor
from configparser import ConfigParser
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("layer_probes", ROOT / "protocol/build-layer-timer-probes.py")
probes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probes)


def build(root, variant):
    directory = root / f"native-{variant}"
    source, output = directory / "source", directory / "build"
    source.mkdir(parents=True)
    shutil.copytree(ROOT / "src", source / "src")
    shutil.copytree(ROOT / "tests", source / "tests")
    shutil.copyfile(ROOT / "CH552_Universal_Macropad.ino", source / "CH552_Universal_Macropad.ino")
    settings = ConfigParser()
    settings.read(ROOT / "platformio.ini")
    existing = settings.get("env:ch552", "build_flags", fallback="")
    settings.set("env:ch552", "build_flags", existing + " -DCONFIG_TIMED_LAYER_EXPERIMENT=1")
    with (source / "platformio.ini").open("w") as target:
        settings.write(target)
    probes.run_probe(source, "six", True, True, variant, keep_resume=True, native_experiment=True)
    with (directory / "build.log").open("w") as log:
        subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                        "build", str(source), str(output), "24000000", "148", "14336", str(variant)],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(variant=variant, flash=size("ROM/EPROM/FLASH"),
               paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]))
    row["headroom"] = probes.LIMIT - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def main():
    root = Path(tempfile.mkdtemp(prefix="macropad-native-layer-timers-"))
    print(f"Artifacts: {root}", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda variant: build(root, variant), (0, 1)))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
