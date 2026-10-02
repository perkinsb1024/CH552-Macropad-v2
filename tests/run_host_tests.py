"""Compile and run firmware regressions against host register/USB stubs."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
flags = ["cc", "-std=c99", "-Wall", "-Wextra", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses", "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__xdata=", "-D__code=", "-Itests/stubs", "-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552", "-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino"]
with tempfile.TemporaryDirectory(prefix="macropad-tests-") as directory:
    suites = [("config", ["src/config.c"]), ("actions", ["src/config.c", "src/actions.c"]), ("protocol", ["src/config.c", "src/storage.c", "src/protocol_firmware.c"]), ("usb", [])]
    suites += [("input", ["src/config.c", "src/actions.c"], variant) for variant in (0, 1)]
    for suite in suites:
        name, sources, *variant = suite
        options = [f"-DPHYSICAL_VARIANT={variant[0]}"] if variant else []
        binary = str(Path(directory) / (name + str(variant)))
        subprocess.run([*flags, *options, f"tests/{name}_test.c", *sources, "-o", binary], cwd=ROOT, check=True)
        subprocess.run([binary], check=True)
        print(f"Passed {name} {variant}", flush=True)
