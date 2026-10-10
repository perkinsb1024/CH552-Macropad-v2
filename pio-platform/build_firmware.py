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


def check_memory_layout(map_text, usb_ram):
    """Paged pointers wrap at 256; SDCC's size check alone misses this hazard."""
    symbols = {
        name: int(value, 16)
        for value, name in re.findall(
            r"(?m)^\s*(?:[CD]:\s+)?([0-9A-F]{8})\s+([A-Za-z_]\w*)\b", map_text
        )
    }
    def area(name):
        return symbols["s_" + name], symbols["l_" + name]

    paged_start, paged_size = area("PSEG")
    if paged_size and not (usb_ram <= paged_start < paged_start + paged_size <= 256):
        raise RuntimeError("Paged RAM must fit in page zero above the USB DMA buffers")
    external_start, external_size = area("XSEG")
    if external_size and not (
        max(usb_ram, paged_start + paged_size) <= external_start
        and external_start + external_size <= 1024
    ):
        raise RuntimeError("External RAM overlaps paged/USB RAM or exceeds CH552 RAM")
    # USB interrupt parameter stores must never alias foreground overlays.
    # The GET_REPORT pointer needs two bytes of storage, separate from its target.
    usb_parameters = {"_USB_setIdle_PARM_2": 1, "_USB_getReport_PARM_2": 1,
                      "_USB_getReport_PARM_3": 2}
    if any(name in symbols for name in usb_parameters):
        allocated = set()
        for name, size in usb_parameters.items():
            start = symbols.get(name)
            if start is None or not (
                external_start <= start and start + size <= external_start + external_size
            ):
                raise RuntimeError(f"USB interrupt parameter {name} must use external RAM")
            storage = set(range(start, start + size))
            if allocated & storage:
                raise RuntimeError("USB interrupt parameter storage overlaps")
            allocated.update(storage)
    # Experimental macros align the active image on page three. Absolute xdata
    # is omitted from l_XSEG, so it needs an explicit overlap/capacity check.
    active_start = symbols.get("_activeConfig")
    if active_start is not None and (active_start == 0x300 or not (
        external_start <= active_start and active_start + 128 <= external_start + external_size
    )):
        if active_start != 0x300:
            raise RuntimeError("Unexpected absolute active configuration address")
        if paged_start + paged_size > active_start or external_start + external_size > active_start:
            raise RuntimeError("External RAM overlaps the absolute active configuration")
    # Our startup omits the XINIT copier, but must retain clearing/P2 setup.
    if symbols["l_XINIT"] or symbols["l_XISEG"]:
        raise RuntimeError("XINIT storage requires the omitted startup copy routine")
    if "__mcs51_genXRAMCLEAR" not in symbols:
        raise RuntimeError("Startup must clear external RAM and select the pdata page")


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
    # src/main.c explicitly retains external-RAM zeroing with --no-xinit-opt.
    flags = [
        "-c", "-Ddouble=float", "-DUSE_STDINT", "-D__PROG_TYPES_COMPAT__",
        "--model-small", "--opt-code-size", "--no-xinit-opt", "--int-long-reent", "-mmcs51", "-DCH552",
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
    # SDCC links the whole timing object, including unused micros()/delay().
    # This firmware only uses millis() and delayMicroseconds(); generate a local
    # copy without the unused routines to leave room for held pointer movement.
    timing_source = (core / "wiring.c").read_text()
    for start, end in ((r"uint32_t micros\(\)", r"uint32_t millis\(\)"),
                       (r"void delay\(__data uint32_t ms\)", r"void delayMicroseconds\(")):
        timing_source, removed = re.subn(rf"(?ms)^{start}.*?(?=^{end})", "", timing_source)
        if removed != 1:
            raise RuntimeError("CH55xDuino timing source layout changed; cannot trim unused routines")
    compact_timing = build / "wiring.c"
    compact_timing.write_text(timing_source)
    core_rels = [
        compile_source(compact_timing if source.name == "wiring.c" else source, "core_" + source.stem)
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
    check_memory_layout((build / "firmware.map").read_text(), int(usb_ram))
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
        "Enter CH552 bootloader mode now: use the installer's Enter bootloader button "
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
        "Enter CH552 bootloader mode now: use the installer's Enter bootloader button "
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
