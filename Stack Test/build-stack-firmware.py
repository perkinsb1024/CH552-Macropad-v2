"""Build temporary diagnostic images for both boards; leave releases/ untouched."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from configparser import ConfigParser
from datetime import datetime, timezone
from pathlib import Path
import shutil

sys.dont_write_bytecode = True
DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parent
spec = importlib.util.spec_from_file_location("builder", ROOT / "pio-platform/build_firmware.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
settings = ConfigParser()
settings.read(ROOT / "platformio.ini")
if "-DENABLE_STACK_TEST=1" not in builder.project_build_flags(ROOT):
    raise SystemExit("Enable -DENABLE_STACK_TEST=1 in platformio.ini before building diagnostic images")
options = settings["env:ch552"]
board = json.loads((ROOT / "pio-platform/boards/ch552.json").read_text())
clock = options.get("board_build.f_cpu", str(board["build"]["f_cpu"]))
usb_ram = options.get("board_build.usb_ram", str(board["build"]["usb_ram"]))
limit = str(board["upload"]["maximum_size"])
manifest = {
    "builtUtc": datetime.now(timezone.utc).isoformat(),
    "baseRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "uncommittedValidationChanges": True,
    "toolchain": "CH55xDuino 0.0.25 / SDCC build.13407_4",
    "clockHz": int(clock), "usbRamBytes": int(usb_ram),
    "buildFlags": builder.project_build_flags(ROOT), "files": {},
}
with tempfile.TemporaryDirectory(prefix="ch552-stack-diagnostics-") as temporary:
    builds = []
    for variant, keys in (("0", 6), ("1", 3)):
        output = Path(temporary) / f"{keys}-key"
        builder.build_firmware(ROOT, output, clock, usb_ram, limit, variant)
        subprocess.run([sys.executable, str(ROOT / "tests/stack_test_firmware.py"), str(output)], check=True)
        builds.append((keys, output))
    for keys, output in builds:
        for suffix in ("hex", "map", "mem"):
            target = DIRECTORY / f"{keys}-key-stack-test-firmware.{suffix}"
            shutil.copyfile(output / f"firmware.{suffix}", target)
            manifest["files"][target.name] = hashlib.sha256(target.read_bytes()).hexdigest()
(DIRECTORY / "firmware-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Diagnostic artifacts verified and copied to Stack Test/")
