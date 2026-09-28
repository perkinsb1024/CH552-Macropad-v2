"""PlatformIO entry point for the installed CH55xDuino Arduino package."""

import subprocess
import sys
from pathlib import Path

from SCons.Script import Action, AlwaysBuild, Default, DefaultEnvironment


env = DefaultEnvironment()
project = Path(env.subst("$PROJECT_DIR"))
build = Path(env.subst("$BUILD_DIR"))
board = env.BoardConfig()
script = project / "pio-platform" / "build_firmware.py"
sketch = project / "CH552_Universal_Macropad.ino"
sources = [sketch, script, project / "platformio.ini"]
sources += list((project / "src" / "userUsbHidKeyboardMouse").glob("*.[ch]"))


def run_build(target, source, env):
    command = [
        sys.executable,
        str(script),
        "build",
        str(project),
        str(build),
        str(board.get("build.f_cpu")),
        str(board.get("build.usb_ram")),
        str(board.get("upload.maximum_size")),
    ]
    return subprocess.call(command)


firmware = env.Command(
    str(build / "firmware.hex"), sources, Action(run_build, "Building CH552 firmware")
)
Default(firmware)


def run_upload(target, source, env):
    command = [
        sys.executable,
        str(script),
        "upload",
        str(project),
        str(build),
        str(board.get("upload.bootcfg")),
    ]
    return subprocess.call(command)


upload = env.Alias("upload", firmware, Action(run_upload, "Uploading CH552 firmware"))
AlwaysBuild(upload)
