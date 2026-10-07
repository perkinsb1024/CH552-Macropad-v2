"""Exercise the actual C FAT/HEX loader and flash journal using a simulated disk."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DriveTests(unittest.TestCase):
    def test_native_drive_and_power_loss_recovery(self):
        compiler = shutil.which("cc")
        self.assertIsNotNone(compiler, "A native C compiler is required for drive tests")
        with tempfile.TemporaryDirectory(prefix="ch552-drive-") as tmp:
            binary = str(Path(tmp) / "drive-test")
            sources = [ROOT / "standalone" / name for name in
                       ("image_drive.c", "drive_store.c", "programmer.c")]
            sources += [ROOT / "firmware/probe_protocol.c", ROOT / "tests/test_drive.c"]
            subprocess.run([compiler, "-O2", "-std=c11", "-Wall", "-Wextra", "-Werror",
                            "-fsanitize=address,undefined", "-I", str(ROOT / "standalone"),
                            "-I", str(ROOT / "firmware"), *map(str, sources), "-o", binary],
                           check=True)
            releases = sorted((ROOT.parents[1] / "releases").glob("ch552-macropad-*-key-*.hex"))
            self.assertTrue(releases)
            subprocess.run([binary, *map(str, releases)], check=True)

    def test_firmware_changes_and_mount_metadata(self):
        compiler = shutil.which("cc")
        self.assertIsNotNone(compiler, "A native C compiler is required for drive tests")
        with tempfile.TemporaryDirectory(prefix="ch552-drive-session-") as tmp:
            binary = str(Path(tmp) / "session-test")
            sources = [ROOT / "standalone" / name for name in
                       ("image_drive.c", "drive_store.c", "programmer.c", "firmware_drive.c")]
            sources += [ROOT / "firmware/probe_protocol.c", ROOT / "tests/test_drive_session.c"]
            subprocess.run([compiler, "-O2", "-std=c11", "-Wall", "-Wextra", "-Werror",
                            "-fsanitize=address,undefined", "-I", str(ROOT / "tests/fakes"),
                            "-I", str(ROOT / "standalone"), "-I", str(ROOT / "firmware"),
                            *map(str, sources), "-o", binary], check=True)
            subprocess.run([binary], check=True)
