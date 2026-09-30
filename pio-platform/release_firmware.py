"""Build both hardware variants and export revision-labelled HEX files."""

import shutil
import subprocess
import sys
from pathlib import Path

# Importing the shared builder should not update tracked Python cache files.
sys.dont_write_bytecode = True
from build_firmware import build_firmware


def git_output(project, *args):
    return subprocess.check_output(
        ["git", "-C", str(project), *args], text=True
    ).strip()


def release_firmware(project, build, clock, usb_ram, code_limit):
    # Git extends the abbreviation if eight characters are not unique locally.
    revision = git_output(project, "rev-parse", "--short=8", "HEAD")
    firmware_paths = ["CH552_Universal_Macropad.ino", "src", "platformio.ini", "pio-platform"]
    dirty = bool(git_output(
        project, "status", "--porcelain", "--untracked-files=all", "--", *firmware_paths
    ))
    suffix = f"dirty-{revision}" if dirty else revision
    if dirty:
        print("Firmware sources have uncommitted changes; filenames will include 'dirty'.", flush=True)

    artifacts = []
    for variant, keys in (("1", 3), ("0", 6)):
        variant_build = build / "releases" / f"{keys}-key"
        build_firmware(project, variant_build, clock, usb_ram, code_limit, variant)
        artifacts.append((variant_build / "firmware.hex", f"ch552-macropad-{keys}-key-{suffix}.hex"))

    # Export only after both variants have compiled successfully.
    releases = project / "releases"
    releases.mkdir(exist_ok=True)
    for source, name in artifacts:
        destination = releases / name
        temporary = releases / (name + ".tmp")
        shutil.copyfile(source, temporary)
        temporary.replace(destination)
        print(f"Release: {destination}", flush=True)

    # Keep the previous files until the new pair has been exported successfully.
    latest_names = {name for _, name in artifacts}
    for keys in (3, 6):
        for previous in releases.glob(f"ch552-macropad-{keys}-key-*.hex"):
            if previous.name not in latest_names and previous.is_file():
                previous.unlink()
                print(f"Removed previous release: {previous.name}", flush=True)


if __name__ == "__main__":
    project, build, clock, usb_ram, code_limit = sys.argv[1:]
    release_firmware(Path(project), Path(build), clock, usb_ram, code_limit)
