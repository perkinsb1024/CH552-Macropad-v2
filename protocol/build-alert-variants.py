"""Build preserved source copies for alert size probes, never release artifacts."""
from configparser import ConfigParser
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
name = sys.argv[1]
limit = sys.argv[2] if len(sys.argv) > 2 else "65535"
base = Path("/private/tmp") / ("macropad-" + name)
source = base / "source"
source.mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT / "src", source / "src", dirs_exist_ok=True)
shutil.copyfile(ROOT / "CH552_Universal_Macropad.ino", source / "CH552_Universal_Macropad.ino")
for inline in (1, 0):
    settings = ConfigParser()
    settings.read(ROOT / "platformio.ini")
    flags = settings.get("env:ch552", "build_flags", fallback="")
    settings.set("env:ch552", "build_flags", flags + f" -DCONFIG_TIMED_CONSUME_INLINE={inline}")
    project = base / f"range{'64' if inline else '128'}"
    shutil.copytree(source, project, dirs_exist_ok=True)
    with (project / "platformio.ini").open("w") as output:
        settings.write(output)
    for variant in (0, 1):
        build = project / f"build-{variant}"
        build.mkdir(exist_ok=True)
        with (build / "build.log").open("w") as log:
            result = subprocess.run([
                sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                "build", str(project), str(build), "24000000", "148", limit, str(variant),
            ], stdout=log, stderr=subprocess.STDOUT)
        print(f"{build}: exit {result.returncode}", flush=True)
        report = build / "firmware.mem"
        if report.exists():
            print("\n".join(line for line in report.read_text().splitlines()
                            if any(word in line for word in ("Stack starts", "RAM   ", "FLASH", "ERROR"))), flush=True)
        if result.returncode:
            print("\n".join(line for line in (build / "build.log").read_text().splitlines()
                            if "Error" in line), flush=True)
