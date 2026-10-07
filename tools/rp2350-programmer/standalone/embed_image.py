#!/usr/bin/env python3
"""Validate the checked-in three-key HEX and generate a build-only C header."""
import argparse
import binascii
import hashlib
import json
from pathlib import Path

LIMIT = 0x3800


def parse_hex(text):
    image = bytearray(b"\xff" * LIMIT)
    occupied = bytearray(LIMIT)
    high = end = 0
    eof = False
    for index, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            if eof or not line.startswith(":") or len(line) % 2 != 1:
                raise ValueError("invalid record or data after EOF")
            record = bytes.fromhex(line[1:])
            if len(record) < 5 or len(record) != record[0] + 5 or sum(record) & 255:
                raise ValueError("length/checksum mismatch")
            count, address, kind = record[0], int.from_bytes(record[1:3], "big"), record[3]
            data = record[4:-1]
            if kind == 0:
                start = high + address
                if start + count > LIMIT:
                    raise ValueError("outside application flash")
                if any(occupied[start:start + count]):
                    raise ValueError("overlapping records")
                image[start:start + count] = data
                occupied[start:start + count] = b"\x01" * count
                if count:
                    end = max(end, start + count)
            elif kind == 1:
                if count or address:
                    raise ValueError("invalid EOF")
                eof = True
            elif kind in (2, 4):
                if count != 2 or address:
                    raise ValueError("invalid address extension")
                high = int.from_bytes(data, "big") * (16 if kind == 2 else 65536)
            elif kind in (3, 5):
                if count != 4 or address:
                    raise ValueError("invalid entry record")
            else:
                raise ValueError("unsupported record type")
        except ValueError as exc:
            raise ValueError(f"HEX line {index}: {exc}") from exc
    if not eof or not end or not occupied[0]:
        raise ValueError("missing EOF or reset-vector data")
    # Same constant GET_INFO record used by webUploader/src/firmware-format.mjs.
    signatures = [i for i in range(LIMIT - 6)
                  if image[i:i + 5] == b"UMAC\x01" and image[i + 6] in (0, 1)]
    if len(signatures) != 1 or image[signatures[0] + 6] != 1:
        raise ValueError("expected exactly one three-key firmware identity record")
    return bytes(image), end, image[signatures[0] + 5]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    image, end, version = parse_hex(raw.decode("ascii"))
    crc = binascii.crc32(image)
    metadata = {"file": args.input.name, "hex_sha256": hashlib.sha256(raw).hexdigest(),
                "image_sha256": hashlib.sha256(image).hexdigest(), "crc32": f"{crc:08x}",
                "source_bytes": end, "program_bytes": len(image), "keys": 3,
                "config_format": version}
    header = "#pragma once\n#include <stdint.h>\n"
    header += f'#define IMAGE_NAME {json.dumps(args.input.name)}\n'
    header += f'#define IMAGE_SHA256 "{metadata["image_sha256"]}"\n'
    header += f"#define IMAGE_CRC32 UINT32_C(0x{crc:08x})\n"
    header += f"#define IMAGE_CONFIG_FORMAT {version}\n"
    header += "static const uint8_t firmware_image[] = {\n"
    for offset in range(0, len(image), 16):
        header += "  " + ",".join(f"0x{b:02x}" for b in image[offset:offset + 16]) + ",\n"
    header += "};\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(header)
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, sort_keys=True))


if __name__ == "__main__":
    main()
