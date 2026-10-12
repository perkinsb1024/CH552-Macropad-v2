#!/usr/bin/env python3
"""Build native tests with sanitizers and independently inspect exported FAT files."""
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
FW = ROOT / "firmware"


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def files_from_disk(image):
    assert len(image) == 65536 and image[510:512] == b"\x55\xaa"
    u16 = lambda p: struct.unpack_from("<H", image, p)[0]
    u32 = lambda p: struct.unpack_from("<I", image, p)[0]
    sector, cluster_sectors, reserved, fats, entries = u16(11), image[13], u16(14), image[16], u16(17)
    fat_sectors = u16(22)
    assert sector == 512 and cluster_sectors == 1 and u16(19) == len(image) // sector
    fat = image[reserved * sector:(reserved + fat_sectors) * sector]
    assert fat == image[(reserved + fat_sectors) * sector:(reserved + 2 * fat_sectors) * sector]
    root = (reserved + fats * fat_sectors) * sector
    data = root + ((entries * 32 + sector - 1) // sector) * sector
    files = {}
    allocated = set()
    for pos in range(root, root + entries * 32, 32):
        if not image[pos]:
            break
        if image[pos + 11] == 8:
            continue
        assert image[pos + 11] & 1  # Every file has the read-only attribute.
        name = image[pos:pos + 8].decode().rstrip() + "." + image[pos + 8:pos + 11].decode().rstrip()
        cluster, length, result = u16(pos + 26), u32(pos + 28), bytearray()
        while cluster >= 2 and cluster < 0xff8:
            assert cluster not in allocated
            allocated.add(cluster)
            start = data + (cluster - 2) * sector * cluster_sectors
            assert start + sector * cluster_sectors <= len(image)
            result.extend(image[start:start + sector * cluster_sectors])
            value = int.from_bytes(fat[cluster * 3 // 2:cluster * 3 // 2 + 2], "little")
            cluster = value >> 4 if cluster & 1 else value & 0xfff
        assert len(result) >= length and (not length or cluster >= 0xff8)
        assert name not in files
        files[name] = bytes(result[:length])
    return files


def main():
    with tempfile.TemporaryDirectory(prefix="ch552-reader-tests-") as tmp:
        tmp = Path(tmp)
        flags = [os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra", "-Werror",
                 "-g", "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
                 "-DREADER_VERSION=\"test\"", "-I" + str(FW), "-I" + str(ROOT / "tests/fakes")]
        common = [FW / "probe_protocol.c"]
        for name, sources, artifact in [
            ("protocol", common, None),
            ("reader", common + [FW / "reader.c"], tmp / "report.json"),
            ("transport", common + [FW / "reader.c", FW / "result_disk.c", FW / "result_drive.c"], tmp / "capture.img"),
            ("disk", [FW / "result_disk.c", FW / "result_drive.c"], None),
        ]:
            binary = tmp / name
            run(*flags, ROOT / "tests" / f"test_{name}.c", *sources, "-o", binary)
            run(binary, *([artifact] if artifact else []))
        report = json.loads((tmp / "report.json").read_text())
        assert report["capture_complete"] and report["code_protect_bit"] == 0
        assert not report["external_code_read_allowed"] and not report["code_flash_captured"]
        assert report["chip_uid"] == "0f283ebd" and report["bootloader_enabled"]
        files = files_from_disk((tmp / "capture.img").read_bytes())
        assert set(files) == {"REPORT.TXT", "TRACE.TXT", "USBDEV.BIN", "USBCFG.BIN", "A1.BIN", "A7.BIN",
                              "AB0.BIN", "AB1.BIN", "AB2.BIN", "DATA.BIN"}
        captured_report = json.loads(files["REPORT.TXT"])
        assert captured_report["capture_complete"]
        assert files["DATA.BIN"] == bytes(i ^ 0xa5 for i in range(128))
        assert int(captured_report["dataflash_crc32"], 16) == zlib.crc32(files["DATA.BIN"])
        assert [len(files[f"AB{i}.BIN"]) for i in range(3)] == [64, 64, 18]
        trace = [json.loads(line) for line in files["TRACE.TXT"].splitlines()]
        commands = [bytes.fromhex(e["hex"]) for e in trace if e["event"] == "bulk_out"]
        assert [c[0] for c in commands] == [0xa1, 0xa7, 0xab, 0xab, 0xab]
        print("Independent FAT12/export checks passed: readable files, intact raw data, JSON report and command trace")


if __name__ == "__main__":
    main()
