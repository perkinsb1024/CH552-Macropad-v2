"""Build the existing plain-C CH55xDuino sketch with its Arduino toolchain."""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def require(path):
    if not path.exists():
        raise RuntimeError(f"Missing CH55xDuino component: {path}")
    return path


def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([str(arg) for arg in args], check=True)


def locations():
    root = Path(os.environ.get("CH55XDUINO_PACKAGE_DIR", Path.home() / "Library/Arduino15/packages/CH55xDuino"))
    hardware = require(root / "hardware/mcs51/0.0.25")
    sdcc = require(root / "tools/sdcc/build.13407_4")
    tools = require(root / "tools/MCS51Tools/2023.10.10")
    return hardware, sdcc, tools


def build_firmware(project, build, clock, usb_ram, code_limit):
    hardware, sdcc_root, _ = locations()
    core = hardware / "cores/ch55xduino"
    variant = hardware / "variants/ch552"
    ws2812 = hardware / "libraries/WS2812/src"
    sdcc = sdcc_root / "bin/sdcc"
    sdar = sdcc_root / "bin/sdar"
    libroot = sdcc_root / "share/sdcc"
    build.mkdir(parents=True, exist_ok=True)

    sketch_source = build / "sketch.c"
    sketch_source.write_text(
        '#include <Arduino.h>\n#include "' + str(project / "CH552_Universal_Macropad.ino") + '"\n'
    )
    flags = [
        "-c", "-Ddouble=float", "-DUSE_STDINT", "-D__PROG_TYPES_COMPAT__",
        "--model-large", "--int-long-reent", "-mmcs51", "-DCH552",
        f"-DF_CPU={clock}L", "-DF_EXT_OSC=0L", "-DARDUINO=10819",
        "-DARDUINO_ch55x", "-DARDUINO_ARCH_mcs51", f"-DUSER_USB_RAM={usb_ram}",
        f"-I{core}", f"-I{variant}", f"-I{ws2812}",
        f"-I{project}", f"-I{libroot / 'include'}",
    ]

    def pad_segment(match):
        size = int(match.group(2), 16)
        return match.group(1) + format(size + (size & 1), "X") + match.group(3)

    def compile_source(source, name):
        rel = build / (name + ".rel")
        print(f"Compiling {source.name}", flush=True)
        subprocess.run([str(sdcc), *flags, str(source), "-o", str(rel)], check=True)
        # CH55xDuino's wrapper pads these SDCC segments to keep the following
        # code at even addresses, which matters for the WS2812 cycle timing.
        content = rel.read_text()
        for segment in ("CSEG", "GSINIT"):
            pattern = rf"(?m)^(A {segment} size )([0-9A-F]+)( flags .*)$"
            content = re.sub(pattern, pad_segment, content)
        if name == "core_main":
            content = content.replace("A GSFINAL size 3 ", "A GSFINAL size 4 ")
        rel.write_text(content)
        return rel

    sketch_rel = compile_source(sketch_source, "sketch")
    hid_sources = sorted((project / "src/userUsbHidKeyboardMouse").glob("*.c"))
    hid_rels = [compile_source(source, "hid_" + source.stem) for source in hid_sources]
    main_rel = compile_source(core / "main.c", "core_main")
    core_sources = sorted(core.glob("*.c")) + sorted((core / "directGpioLut").glob("*.c"))
    core_rels = [
        compile_source(source, "core_" + source.stem)
        for source in core_sources if source.name != "main.c"
    ]
    core_lib = build / "core.lib"
    if core_lib.exists():
        core_lib.unlink()
    run(sdar, "rcs", core_lib, *core_rels)

    ws_rel = compile_source(ws2812 / "template/optionalLink_WS2812_P3_4.c", "ws2812_p34")
    firmware = build / "firmware.ihx"
    run(
        sdcc, "--nostdlib", f"-L{build}",
        f"-L{libroot / 'lib/large_int_calc_stack_auto'}",
        "--code-size", code_limit, "--xram-size", str(1024 - int(usb_ram)),
        "--xram-loc", usb_ram, "-mmcs51", "-DCH552",
        sketch_rel, main_rel, *hid_rels, ws_rel, core_lib,
        "-lmcs51", "-llibsdcc", "-lliblong", "-lliblonglong",
        "-llibint", "-llibfloat", "--out-fmt-ihx", "-o", firmware,
    )
    shutil.copyfile(firmware, build / "firmware.hex")
    print(f"Firmware: {build / 'firmware.hex'}")


def upload(build, bootcfg):
    _, _, tools = locations()
    uploader = Path(os.environ.get("CH55XDUINO_UPLOADER", tools / "macosx/vnproch55x"))
    print(
        "Enter CH552 bootloader mode now: hold the encoder button for 3 seconds "
        "or hold the first three keys while powering on. Waiting up to 10 seconds.",
        flush=True,
    )
    run(uploader, "-r", "10", "-t", "CH552", "-c", bootcfg, build / "firmware.hex")


if __name__ == "__main__":
    action, project_path, build_path, *options = sys.argv[1:]
    if action == "build":
        build_firmware(Path(project_path), Path(build_path), *options)
    elif action == "upload":
        upload(Path(build_path), *options)
    else:
        raise ValueError(action)
