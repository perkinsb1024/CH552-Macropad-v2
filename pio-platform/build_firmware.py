"""Build the existing plain-C CH55xDuino sketch with its Arduino toolchain."""

import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from configparser import ConfigParser
from pathlib import Path


def require(path):
    if not path.exists():
        raise RuntimeError(f"Missing CH55xDuino component: {path}")
    return path


def project_build_flags(project):
    settings = ConfigParser()
    settings.read(project / "platformio.ini")
    return shlex.split(settings.get("env:ch552", "build_flags", fallback=""))


def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([str(arg) for arg in args], check=True)


def locations():
    root = Path(os.environ.get("CH55XDUINO_PACKAGE_DIR", Path.home() / "Library/Arduino15/packages/CH55xDuino"))
    hardware = require(root / "hardware/mcs51/0.0.25")
    sdcc = require(root / "tools/sdcc/build.13407_4")
    tools = require(root / "tools/MCS51Tools/2023.10.10")
    return hardware, sdcc, tools


def build_firmware(project, build, clock, usb_ram, code_limit, physical_variant=None):
    if physical_variant is None:
        settings = ConfigParser()
        settings.read(project / "platformio.ini")
        physical_variant = settings.get("env:ch552", "board_build.physical_variant", fallback="0")
    if physical_variant not in ("0", "1"):
        raise ValueError("physical_variant must be 0 or 1")
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
    # Keep temporary values in internal RAM; persistent buffers are explicitly xdata.
    # Compile the core and sketch with the same model so parameter storage agrees.
    flags = [
        "-c", "-Ddouble=float", "-DUSE_STDINT", "-D__PROG_TYPES_COMPAT__",
        "--model-small", "--opt-code-size", "--int-long-reent", "-mmcs51", "-DCH552",
        f"-DF_CPU={clock}L", "-DF_EXT_OSC=0L", "-DARDUINO=10819",
        f"-DPHYSICAL_VARIANT={physical_variant}",
        "-DARDUINO_ch55x", "-DARDUINO_ARCH_mcs51", f"-DUSER_USB_RAM={usb_ram}",
        f"-I{core}", f"-I{variant}", f"-I{ws2812}",
        f"-I{project}", f"-I{libroot / 'include'}",
    ] + project_build_flags(project)

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
    config_rel = compile_source(project / "src/config.c", "config")
    actions_rel = compile_source(project / "src/actions.c", "actions")
    storage_rel = compile_source(project / "src/storage.c", "storage")
    protocol_rel = compile_source(project / "src/protocol_firmware.c", "protocol_firmware")
    hid_sources = sorted((project / "src/userUsbHidKeyboardMouse").glob("*.c"))
    hid_rels = [compile_source(source, "hid_" + source.stem) for source in hid_sources]
    main_rel = compile_source(project / "src/main.c", "core_main")
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
        f"-L{libroot / 'lib/small_int_calc_stack_auto'}",
        "--code-size", code_limit, "--xram-size", str(1024 - int(usb_ram)),
        "--xram-loc", usb_ram, "-mmcs51", "-DCH552",
        sketch_rel, config_rel, actions_rel, protocol_rel, storage_rel, main_rel, *hid_rels, ws_rel, core_lib,
        "-lmcs51", "-llibsdcc", "-lliblong", "-lliblonglong",
        "-llibint", "-llibfloat", "--out-fmt-ihx", "-o", firmware,
    )
    shutil.copyfile(firmware, build / "firmware.hex")
    print(f"Firmware: {build / 'firmware.hex'}")


def upload_image(build, bootcfg, image, message):
    _, _, tools = locations()
    uploader = Path(os.environ.get("CH55XDUINO_UPLOADER", tools / "macosx/vnproch55x"))
    print(message, flush=True)
    run(uploader, "-r", "10", "-t", "CH552", "-c", bootcfg, image)


def upload(build, bootcfg):
    upload_image(
        build,
        bootcfg,
        build / "firmware.hex",
        "Enter CH552 bootloader mode now: hold the encoder button for 3 seconds "
        "or hold the encoder button while powering on. Waiting up to 10 seconds.",
    )


def build_erase_firmware(project, build, clock, usb_ram, code_limit, physical_variant):
    if physical_variant not in ("0", "1"):
        raise ValueError("physical_variant must be 0 or 1")
    hardware, sdcc_root, _ = locations()
    core = hardware / "cores/ch55xduino"
    variant = hardware / "variants/ch552"
    sdcc = sdcc_root / "bin/sdcc"
    sdar = sdcc_root / "bin/sdar"
    libroot = sdcc_root / "share/sdcc"
    build.mkdir(parents=True, exist_ok=True)
    flags = [
        "-c", "-Ddouble=float", "-DUSE_STDINT", "-D__PROG_TYPES_COMPAT__",
        "--model-small", "--opt-code-size", "--int-long-reent", "-mmcs51", "-DCH552",
        f"-DF_CPU={clock}L", "-DF_EXT_OSC=0L", "-DARDUINO=10819",
        f"-DPHYSICAL_VARIANT={physical_variant}",
        "-DARDUINO_ch55x", "-DARDUINO_ARCH_mcs51", f"-DUSER_USB_RAM={usb_ram}",
        f"-I{core}", f"-I{variant}", f"-I{project}", f"-I{libroot / 'include'}",
    ]

    def compile_source(source, name):
        rel = build / (name + ".rel")
        print(f"Compiling {source.name}", flush=True)
        subprocess.run([str(sdcc), *flags, str(source), "-o", str(rel)], check=True)
        return rel

    sketch_rel = compile_source(project / "pio-platform/erase_config.c", "erase_config")
    main_rel = compile_source(core / "main.c", "erase_core_main")
    core_rels = [
        compile_source(source, "erase_core_" + source.stem)
        for source in sorted(core.glob("*.c")) + sorted((core / "directGpioLut").glob("*.c"))
        if source.name != "main.c"
    ]
    core_lib = build / "erase_core.lib"
    if core_lib.exists():
        core_lib.unlink()
    run(sdar, "rcs", core_lib, *core_rels)
    firmware = build / "erase_config.ihx"
    run(
        sdcc, "--nostdlib", f"-L{build}",
        f"-L{libroot / 'lib/small_int_calc_stack_auto'}",
        "--code-size", code_limit, "--xram-size", str(1024 - int(usb_ram)),
        "--xram-loc", usb_ram, "-mmcs51", "-DCH552",
        sketch_rel, main_rel, core_lib,
        "-lmcs51", "-llibsdcc", "-lliblong", "-lliblonglong",
        "-llibint", "-llibfloat", "--out-fmt-ihx", "-o", firmware,
    )
    shutil.copyfile(firmware, build / "erase_config.hex")


def erase_config(project, build, clock, usb_ram, code_limit, physical_variant, bootcfg):
    build_erase_firmware(project, build, clock, usb_ram, code_limit, physical_variant)
    upload_image(
        build,
        bootcfg,
        build / "erase_config.hex",
        "Enter CH552 bootloader mode now: hold the encoder button for 3 seconds "
        "or hold the encoder button while powering on. The temporary utility will "
        "erase the saved profile and return to bootloader mode.",
    )
    print("Waiting for the CH552 bootloader to reconnect...", flush=True)
    time.sleep(2)
    try:
        upload_image(
            build,
            bootcfg,
            build / "firmware.hex",
            "The profile is cleared. Restoring the normal firmware from bootloader mode.",
        )
    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            "The profile was cleared, but firmware restore could not connect. "
            "Enter bootloader mode by holding the encoder button while powering "
            "on, then run `pio run -t upload`."
        ) from error


if __name__ == "__main__":
    action, project_path, build_path, *options = sys.argv[1:]
    if action == "build":
        build_firmware(Path(project_path), Path(build_path), *options)
    elif action == "upload":
        upload(Path(build_path), *options)
    elif action == "erase-config":
        erase_config(Path(project_path), Path(build_path), *options)
    else:
        raise ValueError(action)
