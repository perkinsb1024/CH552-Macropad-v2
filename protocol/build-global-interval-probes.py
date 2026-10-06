"""Measure global six-byte timers with 8/10/12/14 interval bits, in temporary copies."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("layer_probes", ROOT / "protocol/build-layer-timer-probes.py")
probes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probes)


def widen(project, bits, extend_range=False):
    if bits == 8:
        return
    source = project / "src/actions.c"
    actions = source.read_text()
    actions = probes.replace(actions, "__pdata uint8_t timedAge[CONFIG_TIMED_MAX];",
                             "__idata uint16_t timedAge[CONFIG_TIMED_MAX];")
    actions = probes.replace(actions, "__idata uint8_t age = timedAge[i];",
                             "__idata uint16_t age = timedAge[i];")
    actions = probes.replace(actions, "      timedWork = activeConfig[offset];\n      if (age == timedWork) {",
                             f"      if (age == ((uint16_t)activeConfig[offset] |\n"
                             f"                  ((uint16_t)(activeConfig[offset + 5] & {(1 << (bits - 8)) - 1}) << 8))) {{")
    shift = 7 if extend_range else 15 - bits
    actions = actions.replace("tick is elapsed 128 ms units", f"tick is elapsed {1 << shift} ms units")
    source.write_text(actions)
    sketch = project / "CH552_Universal_Macropad.ino"
    sketch.write_text(sketch.read_text().replace("clock >> 7", f"clock >> {shift}"))


def build(root, bits, variant, extend_range=False):
    directory = root / f"global-{bits}-{variant}"
    source, output = directory / "source", directory / "build"
    source.mkdir(parents=True)
    probes.prepare(source, "none", True, False, placement=True)
    widen(source, bits, extend_range)
    probe = (ROOT / "protocol/layer-timer-probe.c").read_text()
    probe = probes.replace(probe, "activeConfig[configTimedOffset()] = PROBE_WIDE ? 255 : 63;",
                           "activeConfig[configTimedOffset()] = 255;\n"
                           f"    activeConfig[configTimedOffset() + 5] = {(1 << (bits - 8)) - 1};\n"
                           "    setFlags(0, 192);")
    probe = probes.replace(probe, "uint32_t period = (PROBE_WIDE ? 256UL : 64UL) * 256;",
                           f"uint32_t period = {1 << bits}UL * 256;")
    # Exercise each newly added high bit as well as the all-ones maximum.
    position = "static void layers(void) {"
    extra = "static void highIntervals(void) {\n"
    for bit in range(8, bits):
        extra += "    probeInit(1);\n"
        extra += f"    activeConfig[configTimedOffset() + 5] = {1 << (bit - 8)};\n"
        extra += "    setFlags(0, 192);\n"
        extra += f"    advanceFine({((1 << bit) + 1) * 256 - 1}UL); assert(ledCalls == 0);\n"
        extra += "    advanceFine(1); assert(ledCalls == 1);\n"
        extra += "    assert(actionsTimedInput()); assert(ledCalls == 2);\n"
    extra += "}\n\n"
    probe = probes.replace(probe, position, extra + position)
    probe = probes.replace(probe, "validation(); timing(); layers();", "validation(); timing(); highIntervals(); layers();")
    # Run the shared structural checks, then compile the extended counter probe.
    probes.run_probe(source, "none", True, False, variant)
    (source / "probe.c").write_text(probe)
    flags = ["cc", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
             "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
             "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
             "-DPROBE_SHARED=0", "-DPROBE_SCOPED=0", "-DPROBE_WIDE=1",
             "-DPROBE_RESET=0", "-DPROBE_KEEP_RESUME=0", f"-I{source}",
             f"-I{source / 'tests/stubs'}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/variants/ch552'}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/cores/ch55xduino'}"]
    with (directory / "extended-probe.log").open("w") as log:
        subprocess.run([*flags, str(source / "probe.c"), str(source / "src/config.c"),
                        str(source / "src/actions.c"), "-o", str(source / "probe")],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(source / "probe")], stdout=log, stderr=subprocess.STDOUT, check=True)
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                                 "build", str(source), str(output), "24000000", "148", "16384", str(variant)],
                                stdout=log, stderr=subprocess.STDOUT)
    import re
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(bits=bits, variant=variant, mode="range" if extend_range else "resolution", flash=size("ROM/EPROM/FLASH"),
               paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]), exit=result.returncode)
    row["headroom"] = probes.LIMIT - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def main():
    root = Path(tempfile.mkdtemp(prefix="macropad-global-intervals-"))
    print(f"Artifacts: {root}", flush=True)
    extend_range = "--range" in sys.argv
    jobs = [(bits, variant) for bits in ((10, 12, 14) if extend_range else (8, 10, 12, 14)) for variant in (0, 1)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: build(root, *job, extend_range), jobs))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    return int(any(row["exit"] for row in rows))


if __name__ == "__main__":
    sys.exit(main())
