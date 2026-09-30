"""PlatformIO IDE custom targets for CH552-specific maintenance actions."""

import subprocess
import sys
from pathlib import Path

Import("env")

project = Path(env.subst("$PROJECT_DIR"))
build = Path(env.subst("$BUILD_DIR"))
board = env.BoardConfig()
script = project / "pio-platform" / "build_firmware.py"
erase_source = project / "pio-platform" / "erase_config.c"


def run_erase_config(target, source, env):
    command = [
        sys.executable,
        str(script),
        "erase-config",
        str(project),
        str(build),
        str(board.get("build.f_cpu")),
        str(board.get("build.usb_ram")),
        str(board.get("upload.maximum_size")),
        str(board.get("build.physical_variant", 0)),
        str(board.get("upload.bootcfg")),
    ]
    return subprocess.call(command)


env.AddCustomTarget(
    name="erase-config",
    dependencies=[str(build / "firmware.hex"), str(erase_source)],
    actions=run_erase_config,
    title="Erase Config",
    description="Clear the saved macropad profile and restore the normal firmware",
    always_build=True,
)


def run_releases(target, source, env):
    return subprocess.call([
        sys.executable,
        str(project / "pio-platform" / "release_firmware.py"),
        str(project),
        str(build),
        str(board.get("build.f_cpu")),
        str(board.get("build.usb_ram")),
        str(board.get("upload.maximum_size")),
    ])


env.AddCustomTarget(
    name="releases",
    dependencies=[],
    actions=run_releases,
    title="Build Release HEX Files",
    description="Build three-key and six-key firmware into releases with Git revision filenames",
    always_build=True,
)
