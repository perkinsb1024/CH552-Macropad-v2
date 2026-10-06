"""Execute the linked watermark machine code; validate real profile images in C.

Usage: python3 tests/stack_test_firmware.py BUILD_DIR [--baseline NORMAL_BUILD_DIR]
No hardware is accessed. This is an instruction-level check of the tiny added
routines, not an emulator of the firmware, USB peripherals, or real workload.
"""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def symbols(directory):
    return {name: int(value, 16) for value, name in re.findall(
        r"(?m)^\s*(?:[CD]:\s+)?([0-9A-F]{8})\s+([A-Za-z_]\w*)\b",
        (directory / "firmware.map").read_text())}


def load_hex(path):
    rom = bytearray(65536)
    for line in path.read_text().splitlines():
        record = bytes.fromhex(line[1:])
        assert sum(record) & 255 == 0, "Bad Intel HEX checksum"
        length, high, low, kind = record[:4]
        if kind == 0:
            address = high * 256 + low
            assert address + length <= 14336, "Flash exceeds application boundary"
            rom[address:address + length] = record[4:4 + length]
        else:
            assert kind == 1, "Unexpected Intel HEX record"
    return rom


class Machine:
    """8051 subset for the linked fill/scan, with separate IRAM and SFR spaces."""
    def __init__(self, rom, sp, enabled):
        self.rom = rom
        self.ram = bytearray((i * 7 + 3) & 255 for i in range(256))
        self.xram = bytearray([0x5a] * 1024)
        self.sfr = {0x81: sp, 0xaf: enabled}
        self.a = self.c = self.dptr = 0

    def execute(self, start, stop):
        pc, steps = start, 0
        def byte():
            nonlocal pc
            value = self.rom[pc]
            pc += 1
            return value
        def branch(relative):
            nonlocal pc
            pc += relative if relative < 128 else relative - 256
        while pc != stop:
            steps += 1
            assert steps < 2000, "Diagnostic did not terminate"
            opcode = byte()
            if opcode == 0xa8: self.ram[0] = self.sfr[byte()]  # MOV R0,direct
            elif opcode == 0x08: self.ram[0] = (self.ram[0] + 1) & 255
            elif opcode == 0x18: self.ram[0] = (self.ram[0] - 1) & 255
            elif opcode == 0x76: self.ram[self.ram[0]] = byte()  # MOV @R0,#imm
            elif opcode == 0x78: self.ram[0] = byte()
            elif opcode == 0xb8:
                value, relative = byte(), byte()
                self.c = int(self.ram[0] < value)
                if self.ram[0] != value: branch(relative)
            elif opcode == 0xa2: self.c = self.sfr[byte()]  # MOV C,bit
            elif opcode == 0xc2: self.sfr[byte()] = 0
            elif opcode == 0x92: self.sfr[byte()] = self.c
            elif opcode == 0xe6: self.a = self.ram[self.ram[0]]
            elif opcode == 0xe8: self.a = self.ram[0]
            elif opcode == 0x64: self.a ^= byte()
            elif opcode == 0x70:
                relative = byte()
                if self.a: branch(relative)
            elif opcode == 0x90: self.dptr = byte() * 256 + byte()
            elif opcode == 0x74: self.a = byte()
            elif opcode == 0xf0: self.xram[self.dptr] = self.a
            elif opcode == 0xa3: self.dptr = (self.dptr + 1) & 65535
            else: raise AssertionError(f"Unexpected instruction {opcode:02x} at {pc - 1:04x}")


def verify(directory, baseline):
    names = symbols(directory)
    start = names["__start__stack"]
    assert 128 <= start < 255
    assert names["s_SSEG"] == start and names["l_SSEG"] == 256 - start
    rom = load_hex(directory / "firmware.hex")
    listing = (directory / "protocol_firmware.rst").read_text()
    scan = int(re.search(r"(?m)^\s*([0-9A-F]{6}).*\bmov\s+c,_EA", listing)[1], 16)
    stop = int(re.search(r"(?m)^\s*([0-9A-F]{6}).*\bmov\s+_EA,c", listing)[1], 16) + 2
    fill = names["_main"]
    # The exact fill prefix must begin main; no compiler prologue can precede it.
    assert rom[fill:fill + 9] == bytes.fromhex("a8810876a508b800fa")
    assert rom[fill + 9] == 0x12, "Initialization must follow the fill"
    assert "ljmp\t_main" in (directory / "core_main.asm").read_text()
    for enabled in (0, 1):
        for highest in range(start - 1, 256):
            cpu = Machine(rom, start - 1, enabled)
            before = cpu.ram[:]
            cpu.execute(fill, fill + 9)
            assert cpu.ram[1:start] == before[1:start], "Fill clobbered allocated RAM"
            assert cpu.ram[start:] == bytes([0xa5]) * (256 - start)
            assert cpu.sfr[0x81] == start - 1
            assert cpu.sfr[0xaf] == enabled
            if highest >= start:
                # Holes below the peak ensure the scan searches from the top.
                cpu.ram[start] = 0
                cpu.ram[highest] = 0x42
            cpu.sfr[0x81] = min(start + 10, 255)  # Simulated live call frames.
            before = cpu.ram[:]
            external = cpu.xram[:]
            cpu.c = 1 - enabled
            cpu.execute(scan, stop)
            assert cpu.ram[1:] == before[1:], "Readout modified live/allocated stack RAM"
            assert cpu.sfr == {0x81: min(start + 10, 255), 0xaf: enabled}, "SP/EA not preserved"
            reply = names["_protocolReply"] + 15
            assert cpu.xram[reply:reply + 2] == bytes([start, highest])
            external[reply:reply + 2] = cpu.xram[reply:reply + 2]
            assert cpu.xram == external, "Unexpected external-RAM write"
    if baseline:
        normal = symbols(baseline)
        for name in ("s_SSEG", "l_SSEG", "s_PSEG", "l_PSEG", "s_XSEG", "l_XSEG", "s_DSEG", "l_DSEG", "s_ISEG", "l_ISEG", "s_OSEG", "l_OSEG"):
            assert names[name] == normal[name], f"Changed allocation: {name}"
        def normalized(path):
            return [line.split(';')[0].strip() for line in path.read_text().splitlines()
                    if line.split(';')[0].strip()]
        for module in ("sketch", "config", "actions", "storage", "hid_USBhandler", "hid_USBconstant", "hid_USBHIDKeyboardMouse", "core_wiring", "ws2812_p34"):
            assert normalized(directory / f"{module}.asm") == normalized(baseline / f"{module}.asm"), f"Changed workload module: {module}"
        def interrupt_body(path):
            return path.read_text().split("_DeviceUSBInterrupt:", 1)[1].split("\treti", 1)[0]
        assert normalized_body(interrupt_body(directory / "core_main.asm")) == normalized_body(interrupt_body(baseline / "core_main.asm"))
    print(f"Passed linked stack fill/readout for all {257 - start} peak positions with EA=0/1; base={start:#x}, capacity={256 - start}")


def normalized_body(text):
    return [line.split(';')[0].strip() for line in text.splitlines() if line.split(';')[0].strip()]


def verify_profiles():
    # Validate the browser-generated binaries through the actual firmware parser.
    source = r'''
#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include "config.h"
int main(int argc, char **argv) {
  uint8_t image[128];
  assert(argc == 3);
  for (int i = 1; i < argc; i++) {
    FILE *file = fopen(argv[i], "rb"); assert(file);
    assert(fread(image, 1, 128, file) == 128 && fgetc(file) == EOF); fclose(file);
    uint8_t variant = i == 1 ? 0 : 1;
    assert(configValid(image, variant)); assert(!configValid(image, !variant));
    image[0] = 0;
    uint16_t crc = configCrc(image); image[6] = crc; image[7] = crc >> 8;
    assert(!configValid(image, variant));
  }
  return 0;
}
'''
    with tempfile.TemporaryDirectory(prefix="ch552-stack-profiles-") as temp:
        path = Path(temp)
        (path / "validate.c").write_text(source)
        subprocess.run(["cc", "-std=c99", "-Wall", "-Wextra", "-Wno-unknown-pragmas", "-D__data=", "-D__idata=", "-D__pdata=", "-D__xdata=", "-D__code=", f"-I{ROOT / 'src'}", str(path / "validate.c"), str(ROOT / "src/config.c"), "-o", str(path / "validate")], check=True)
        subprocess.run([str(path / "validate"), *[str(ROOT / "Stack Test" / f"{keys}-key-sanity-profile.bin") for keys in (6, 3)]], check=True)
    print("Passed both variant images of the sanity profile through firmware configValid, variant checks, and invalid-magic rejection")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    verify(args.build, args.baseline)
    verify_profiles()
