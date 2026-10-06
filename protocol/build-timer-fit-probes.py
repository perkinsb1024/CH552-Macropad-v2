"""Measure functionality-preserving memory-placement optimizations in temp copies."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("layer_probes", ROOT / "protocol/build-layer-timer-probes.py")
probes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probes)


def optimize(project, case):
    if case == "reference":
        return
    if case == "retained":
        optimize(project, "buttons-clock-usb-length")
        optimize(project, "protocol-state-paged")
        return
    if case in ("protocol-state-paged", "upload-bytes-idata", "final-candidate"):
        if case == "final-candidate":
            optimize(project, "buttons-clock-usb-length")
        source = project / "src/protocol_firmware.c"
        protocol = source.read_text()
        if case != "upload-bytes-idata":
            protocol = probes.replace(protocol, "volatile __xdata uint8_t protocolState;",
                                      "volatile __pdata uint8_t protocolState;")
        if case != "protocol-state-paged":
            for name in ("uploadState", "uploadNext"):
                protocol = probes.replace(protocol, f"__xdata uint8_t {name};", f"__idata uint8_t {name};")
        source.write_text(protocol)
        return
    if case in ("usb-length-byte", "buttons-clock-usb-length", "usb-length-and-clock"):
        source = project / "src/userUsbHidKeyboardMouse/USBhandler.c"
        usb = source.read_text()
        usb = probes.replace(usb, "__data uint16_t SetupLen;", "__data uint8_t SetupLen;")
        usb = probes.replace(usb, "  __data uint16_t descriptorLen = 0;", "  __data uint8_t descriptorLen = 0;")
        usb = probes.replace(usb, "SetupLen = ((uint16_t)UsbSetupBuf->wLengthH << 8) | (UsbSetupBuf->wLengthL);",
                             "SetupLen = UsbSetupBuf->wLengthH ? 255 : UsbSetupBuf->wLengthL;")
        source.write_text(usb)
        header = project / "src/userUsbHidKeyboardMouse/USBhandler.h"
        header.write_text(probes.replace(header.read_text(), "extern __data uint16_t SetupLen;", "extern __data uint8_t SetupLen;"))
        if case == "buttons-clock-usb-length":
            optimize(project, "buttons-and-clock")
        if case == "usb-length-and-clock":
            optimize(project, "clock-narrow")
        return
    if case in ("buttons-idata", "bootloader-bit", "buttons-and-clock", "buttons-clock-inbox"):
        source = project / "CH552_Universal_Macropad.ino"
        sketch = source.read_text()
        if case != "bootloader-bit":
            for declaration in ("__xdata uint8_t rawState[7];", "__xdata uint8_t stableState[7];",
                                "__xdata uint16_t rawChanged[7];"):
                sketch = probes.replace(sketch, declaration, declaration.replace("__xdata", "__idata"))
        if case != "buttons-idata":
            sketch = probes.replace(sketch, "__xdata uint8_t allowRunBootloader;", "ACTION_BIT allowRunBootloader;")
        if case.startswith("buttons-") and case != "buttons-idata":
            sketch = sketch.replace("actionsTimedReset(clock >> 7)", "actionsTimedReset(now >> 7)")
            sketch = sketch.replace("actionsTimedPoll(clock >> 7)", "actionsTimedPoll(now >> 7)")
        source.write_text(sketch)
        if case == "buttons-clock-inbox":
            optimize(project, "paged-inbox")
        return
    if case in ("clock-narrow", "crc-byte", "validation-byte", "code-combined", "code-and-inbox"):
        if case in ("clock-narrow", "code-combined", "code-and-inbox"):
            source = project / "CH552_Universal_Macropad.ino"
            source.write_text(source.read_text().replace("actionsTimedReset(clock >> 7)", "actionsTimedReset(now >> 7)")
                              .replace("actionsTimedPoll(clock >> 7)", "actionsTimedPoll(now >> 7)"))
        if case in ("crc-byte", "code-combined", "code-and-inbox"):
            source = project / "src/config.c"
            config = source.read_text()
            begin = config.index("uint16_t configCrc(")
            end = config.index("static FW_BIT keyboardUsageValid(", begin)
            config = config[:begin] + """uint16_t configCrc(const __xdata uint8_t *image) {
    uint16_t crc = 0xFFFF;
    for (uint8_t i = 0; i < CONFIG_SIZE; i++) {
        if (i == 6 || i == 7) continue;
        uint8_t x = (crc >> 8) ^ image[i];
        x ^= x >> 4;
        crc = (crc << 8) ^ ((uint16_t)x << 12) ^ ((uint16_t)x << 5) ^ x;
    }
    return crc;
}

""" + config[end:]
            source.write_text(config)
        if case in ("validation-byte", "code-combined", "code-and-inbox"):
            source = project / "src/config.c"
            config = source.read_text()
            config = probes.replace(config, "aux <= 1 && (param <= 6 || param >= 0xFA)",
                                    "aux <= 1 && (uint8_t)(param + 6) <= 12")
            config = probes.replace(config, "(aux != 0 || param != 0)", "(aux | param)")
            config = probes.replace(config, "    uint16_t end;", "    uint8_t remaining;\n    uint8_t length;")
            start = config.index("    end = 9 + (uint8_t)(size * layers)")
            end = config.index("    for (layer = 0; layer < layers; layer++)", start)
            config = config[:start] + """    remaining = CONFIG_SIZE - 9 - size * layers;
    length = 3 * chords;
    if (length > remaining) return 0;
    remaining -= length;
    length = CONFIG_TIMED_SIZE * timers;
    if (length > remaining) return 0;
    remaining -= length;
    if (used > remaining) return 0;
    pool = CONFIG_SIZE - remaining;
""" + config[end:]
            source.write_text(config)
        if case == "code-and-inbox":
            optimize(project, "paged-inbox")
        return
    if case in ("paged-inbox", "selector-cache", "inbox-and-cache"):
        if case != "selector-cache":
            source = project / "src/actions.c"
            actions = source.read_text()
            for declaration in ("__pdata uint8_t latchedMouse[TOGGLE_INPUTS];",
                                "__pdata uint8_t eventData[EVENT_COUNT][2];",
                                "__pdata uint8_t buttonOrder[MAX_INPUTS];"):
                actions = probes.replace(actions, declaration, declaration.replace("__pdata", "__idata"))
            source.write_text(actions)
            source = project / "src/protocol_firmware.c"
            source.write_text(probes.replace(source.read_text(), "__xdata uint8_t protocolInbox[32];",
                                             "__pdata uint8_t protocolInbox[32];"))
        if case != "paged-inbox":
            cache_scopes(project)
        return
    if case.startswith("paged-") or case == "mouse-toggles-idata":
        source = project / "src/actions.c"
        source.write_text(probes.replace(source.read_text(),
                          "__pdata uint8_t latchedMouse[TOGGLE_INPUTS];",
                          "__idata uint8_t latchedMouse[TOGGLE_INPUTS];"))
        if case == "mouse-toggles-idata":
            return
    source = project / "src/protocol_firmware.c"
    protocol = source.read_text()
    for declaration in ("__xdata uint8_t uploadState;", "__xdata uint8_t uploadNext;",
                        "__xdata uint16_t uploadCrc;", "__xdata uint16_t uploadTime;"):
        protocol = probes.replace(protocol, declaration, declaration.replace("__xdata", "__pdata" if case.startswith("paged-") else "__idata"))
    if case == "paged-all-small":
        protocol = probes.replace(protocol, "volatile __xdata uint8_t protocolState;",
                                  "volatile __pdata uint8_t protocolState;")
    source.write_text(protocol)
    if case in ("upload-state", "paged-upload"):
        return
    source = project / "src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c"
    usb = source.read_text()
    for name in ("reportHead", "reportTail", "reportCount", "reportGeneration"):
        usb = probes.replace(usb, f"__xdata uint8_t {name};", f"{'__pdata' if case.startswith('paged-') else '__idata'} uint8_t {name};")
    if case == "paged-all-small":
        for name in ("USB_globalIdleRate", "mouseState", "idleReport"):
            usb = probes.replace(usb, f"__xdata uint8_t {name};", f"__pdata uint8_t {name};")
    source.write_text(usb)


def cache_scopes(project):
    source = project / "src/actions.c"
    actions = source.read_text()
    actions = probes.replace(actions, "__idata uint8_t timedPending[CONFIG_TIMED_MAX];",
                             "__idata uint8_t timedPending[CONFIG_TIMED_MAX];\n__idata uint8_t timedScope[CONFIG_TIMED_MAX];")
    actions = probes.replace(actions, "void actionsTimedReset(uint8_t tick) {\n  timedClock = tick;",
                             "void actionsTimedReset(uint8_t tick) {\n  timedClock = tick;\n"
                             "  __idata uint8_t offset = configTimedOffset();\n"
                             "  __idata uint8_t count = configTimedCount();")
    actions = probes.replace(actions, "    timedPending[i] = 0;\n  }\n}",
                             "    timedPending[i] = 0;\n"
                             "    timedScope[i] = 255;\n"
                             "    if (i < count) timedScope[i] = (activeConfig[offset + 5] & 7) - 1;\n"
                             "    offset += CONFIG_TIMED_SIZE;\n  }\n}")
    actions = probes.replace(actions,
        "    __idata uint8_t scope = activeConfig[offset + 5] & 7;\n"
        "    if (tick && scope && scope != (uint8_t)(effectiveLayer + 1)) continue;",
        "    if (tick && timedScope[i] != 255 && timedScope[i] != effectiveLayer) continue;")
    start = actions.index("static void resetLayerTimers(void) {", actions.index("void actionsPoll("))
    actions = actions[:start] + """static void resetLayerTimers(void) {
  for (uint8_t i = 0; i < CONFIG_TIMED_MAX; i++) {
    if (timedScope[i] != 255) {
      timedAge[i] = 0;
      timedFraction[i] = 0;
    }
  }
}
"""
    source.write_text(actions)


def build(root, case, variant):
    directory = root / f"{case}-{variant}"
    source, output = directory / "source", directory / "build"
    source.mkdir(parents=True)
    probes.prepare(source, "six", True, True, placement=True, keep_resume=True)
    optimize(source, case)
    probes.run_probe(source, "six", True, True, variant, keep_resume=True,
                     cached_scope=case in ("selector-cache", "inbox-and-cache"))
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                                 "build", str(source), str(output), "24000000", "148", "16384", str(variant)],
                                stdout=log, stderr=subprocess.STDOUT)
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(case=case, variant=variant, flash=size("ROM/EPROM/FLASH"),
               paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]), exit=result.returncode)
    row["headroom"] = probes.LIMIT - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def main():
    root = Path(tempfile.mkdtemp(prefix="macropad-timer-fit-"))
    print(f"Artifacts: {root}", flush=True)
    cases = sys.argv[1:] or ["reference", "clock-narrow", "usb-length-byte", "buttons-clock-usb-length", "retained"]
    jobs = [(case, variant) for case in cases for variant in (0, 1)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: build(root, *job), jobs))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    return int(any(row["exit"] for row in rows))


if __name__ == "__main__":
    sys.exit(main())
