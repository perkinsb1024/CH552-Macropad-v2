#!/usr/bin/env python3
"""Exercise the scanner's actual callbacks and independently decode saved disks."""
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FW = ROOT / "firmware"
reader_tests = ROOT.parent / "rp2350-passthrough/tests/run.py"
spec = importlib.util.spec_from_file_location("reader_disk_decoder", reader_tests)
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)


def main():
    with tempfile.TemporaryDirectory(prefix="ch552-hid-scan-tests-") as tmp:
        tmp = Path(tmp)
        flags = [os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra", "-Werror",
                 "-g", "-fsanitize=address,undefined", "-fno-sanitize-recover=all", "-fno-omit-frame-pointer",
                 '-DSCAN_VERSION="test"', "-I" + str(FW), "-I" + str(ROOT / "tests/fakes")]
        for name, sources in [
            ("scan", ["scan.c"]),
            ("store", ["scan.c", "store.c"]),
            ("session", ["scan.c", "store.c", "probe_protocol.c", "result_disk.c", "result_drive.c"]),
        ]:
            binary = tmp / name
            subprocess.run([*flags, str(ROOT / f"tests/test_{name}.c"),
                            *[str(FW / s) for s in sources], "-o", str(binary)], check=True)
            args = [str(tmp / "full.img"), str(tmp / "hit.img")] if name == "session" else []
            subprocess.run([str(binary), *args], check=True)
        for name in ["full", "hit"]:
            files = decoder.files_from_disk((tmp / f"{name}.img").read_bytes())
            report = json.loads(files["REPORT.TXT"])
            rows = list(csv.DictReader(io.StringIO(files["RESULTS.CSV"].decode())))
            assert len(rows) == report["attempts"]
            assert {"SAVE.TXT", "HIDRPT.BIN", "LASTOUT.BIN", "USBDEV.BIN", "USBCFG.BIN"} <= files.keys()
            assert "SAVEERR.TXT" not in files
            assert not report["dropped_trace_events"]
            commands = [int(row["command_hex"], 16) for row in rows]
            assert all(c not in range(1, 19) and c not in [0xA1, 0xAA, 0xB0] for c in commands)
            if name == "full":
                assert report["outcome"] == "sweep_complete" and len(rows) == 470
                assert report["last_report_id"] == 2 and report["last_command"] == 255
                assert files["LASTOUT.BIN"] == bytes([2, 255, 0, 0, 0, 0, 0])
                assert set(commands) == set(range(256)) - set(range(1, 19)) - {0xA1, 0xAA, 0xB0}
                assert all(row["observation"] == "factory" for row in rows)
            else:
                assert report["transition_after_probe"] and report["bootloader_identity_confirmed"]
                assert rows[-1]["observation"] == "bootloader_transition"
                assert files["A1.BIN"] == bytes.fromhex("a1b702005211")
                assert report["last_report_id"] == 3 and report["last_command"] == 0
                assert files["LASTOUT.BIN"] == bytes([3]) + bytes(63)
            trace = [json.loads(line) for line in files["TRACE.TXT"].splitlines()]
            assert trace[-1]["event"] == "finished"
        print("Independent FAT/JSON/CSV checks passed: complete findings, candidate framing and confirmed-hit evidence")


if __name__ == "__main__":
    main()
