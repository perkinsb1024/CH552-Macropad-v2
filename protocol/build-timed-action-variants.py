"""Reproduce timed-action size probes in temporary copies; never build releases."""
from configparser import ConfigParser
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("retained-six", "0", ""),
    ("retained-three", "1", ""),
    ("all-reset-six", "0", "-DCONFIG_TIMED_ALL_RESET=1"),
    ("compact-six", "0", "-DCONFIG_TIMED_ALL_RESET=1 -DCONFIG_TIMED_INTERVAL_MASK=63"),
    ("no-resume-six", "0", "-DCONFIG_TIMED_ALL_RESET=1 -DCONFIG_TIMED_INTERVAL_MASK=63 -DCONFIG_TIMED_RESUME=0"),
    ("seven-timers-six", "0", "-DCONFIG_TIMED_MAX=7"),
]


def main():
    temporary = Path(tempfile.mkdtemp(prefix="macropad-timed-variants-"))
    print(f"Temporary sources, logs and size reports: {temporary}", flush=True)
    failures = 0
    for name, variant, flags in CASES:
        project = temporary / name / "source"
        build = temporary / name / "build"
        project.mkdir(parents=True)
        build.mkdir()
        shutil.copytree(ROOT / "src", project / "src")
        shutil.copyfile(ROOT / "CH552_Universal_Macropad.ino", project / "CH552_Universal_Macropad.ino")
        settings = ConfigParser()
        settings.read(ROOT / "platformio.ini")
        existing = settings.get("env:ch552", "build_flags", fallback="")
        settings.set("env:ch552", "build_flags", f"{existing} {flags}".strip())
        with (project / "platformio.ini").open("w") as output:
            settings.write(output)
        with (build / "build.log").open("w") as log:
            result = subprocess.run([
                sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                "build", str(project), str(build), "24000000", "148", "14336", variant,
            ], stdout=log, stderr=subprocess.STDOUT)
        failures += result.returncode != 0
        print(f"{name}: exit {result.returncode}", flush=True)
        report = build / "firmware.mem"
        print(report.read_text() if report.exists() else (build / "build.log").read_text()[-2000:], flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
