"""Measure layer-scoped eleven-bit timers in temporary source/build directories."""
from concurrent.futures import ThreadPoolExecutor
from configparser import ConfigParser
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 14336
# Pin the eight-bit source so historical comparisons survive implementation.
BASE_REVISION = "0b3629e296924f6fea1a1d557f5fb20e7904dead"
CASES = ("reference", "byte-compare", "split-age", "split-age-pending",
         "pending-paged", "byte-locals", "split-byte-locals", "local-only",
         "split-local-only", "split-local-age", "split-flags", "split-gating",
         "split-flags-gating", "no-fraction", "no-fraction-byte-locals",
         "no-fraction-extract")


def replace(text, old, new):
    assert old in text, old
    return text.replace(old, new)


def prepare(source, case):
    archive = subprocess.check_output(["git", "archive", BASE_REVISION, "src", "tests",
                                       "CH552_Universal_Macropad.ino", "platformio.ini"], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as files:
        for member in files.getmembers():
            destination = source / member.name
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(files.extractfile(member).read())
    settings = ConfigParser()
    settings.read(source / "platformio.ini")
    existing = settings.get("env:ch552", "build_flags", fallback="")
    settings.set("env:ch552", "build_flags", existing + " -DCONFIG_TIMED_LAYER_EXPERIMENT=1")
    with (source / "platformio.ini").open("w") as target:
        settings.write(target)
    actions = source / "src/actions.c"
    actions.write_text(replace(actions.read_text(), "__pdata uint8_t timedAge[CONFIG_TIMED_MAX];",
                              "__idata uint16_t timedAge[CONFIG_TIMED_MAX];"))
    timer = source / "src/timed_actions_experiment.inc"
    text = replace(timer.read_text(), "__idata uint8_t age = timedAge[i];", "__idata uint16_t age = timedAge[i];")
    text = replace(text, "// Byte 0 is interval-1. Byte 5 has scope 0/global or 1-7/layer+1 in bits 0-2,",
                   "// Byte 0 has the low eight interval-1 bits. Byte 5 has the high three\n"
                   "// interval bits in bits 3-5 and scope 0/global or 1-7/layer+1 in bits 0-2,")
    text = replace(text, "      timedWork = activeConfig[offset];\n      if (age == timedWork) {",
                   "      if (age == ((uint16_t)activeConfig[offset] |\n"
                   "                  ((uint16_t)(activeConfig[offset + 5] & 56) << 5))) {")
    text = text.replace("128 ms", "16 ms").replace("32.768 seconds", "4.096 seconds")
    if case == "byte-compare":
        text = replace(text, "age == ((uint16_t)activeConfig[offset] |\n                  ((uint16_t)(activeConfig[offset + 5] & 56) << 5))",
                       "(uint8_t)age == activeConfig[offset] &&\n          (uint8_t)(age >> 8) == ((activeConfig[offset + 5] >> 3) & 7)")
    if case in ("split-age", "split-age-pending", "split-byte-locals", "split-local-only", "split-local-age", "split-flags", "split-gating", "split-flags-gating"):
        actions.write_text(replace(actions.read_text(), "__idata uint16_t timedAge[CONFIG_TIMED_MAX];",
                                  "__pdata uint8_t timedAge[CONFIG_TIMED_MAX];\n__idata uint8_t timedHigh[CONFIG_TIMED_MAX];"))
        text = replace(text, "__idata uint16_t age = timedAge[i];", "__idata uint8_t age = timedAge[i];")
        text = re.sub(r"(?m)^(\s*)timedAge\[i\] = 0;", r"\1timedAge[i] = 0;\n\1timedHigh[i] = 0;", text)
        text = replace(text, "age == ((uint16_t)activeConfig[offset] |\n                  ((uint16_t)(activeConfig[offset + 5] & 56) << 5))",
                       "age == activeConfig[offset] && timedHigh[i] == (activeConfig[offset + 5] & 56)")
        text = replace(text, "        age = 0;", "        age = 0;\n        timedHigh[i] = 0;")
        text = replace(text, "      } else age++;", "      } else if (!++age) timedHigh[i] += 8;")
    if case == "split-age-pending":
        text = replace(text, "__idata uint8_t timedPending[CONFIG_TIMED_MAX];", "")
        text = text.replace("timedHigh[i] = 0;", "timedHigh[i] &= 128;")
        text = text.replace("timedPending[i] = 0;", "timedHigh[i] &= 127;")
        text = text.replace("timedPending[i] = 1;", "timedHigh[i] |= 128;")
        text = text.replace("if (timedPending[i])", "if (timedHigh[i] & 128)")
        text = replace(text, "timedHigh[i] == (activeConfig[offset + 5] & 56)",
                       "(timedHigh[i] & 56) == (activeConfig[offset + 5] & 56)")
    if case == "pending-paged":
        text = replace(text, "__idata uint8_t timedPending[CONFIG_TIMED_MAX];", "__pdata uint8_t timedPending[CONFIG_TIMED_MAX];")
    if case in ("byte-locals", "split-byte-locals"):
        text = text.replace("__idata uint8_t", "uint8_t").replace("__pdata uint8_t offset", "uint8_t offset")
    if case in ("local-only", "split-local-only", "split-flags", "split-gating", "split-flags-gating"):
        text = text.replace("__idata uint8_t", "uint8_t").replace("__pdata uint8_t offset", "uint8_t offset")
        text = replace(text, "uint8_t timedPending[CONFIG_TIMED_MAX];", "__idata uint8_t timedPending[CONFIG_TIMED_MAX];")
    if case == "split-local-age":
        text = replace(text, "__idata uint8_t age", "uint8_t age")
    if case in ("split-flags", "split-flags-gating"):
        text = replace(text, "uint8_t scope = activeConfig[offset + 5] & 7;\n    if (tick && scope && scope != (uint8_t)(effectiveLayer + 1)) continue;",
                       "uint8_t flags = activeConfig[offset + 5];\n    if (tick && (flags & 7) && (flags & 7) != (uint8_t)(effectiveLayer + 1)) continue;")
        begin = text.index("static ACTION_BIT timedEvent(")
        end = text.index("void actionsTimedPoll(", begin)
        body = text[begin:end]
        body = body.replace("(activeConfig[offset + 5] & 56)", "(flags & 56)")
        body = body.replace("activeConfig[offset + 5] & CONFIG_TIMED_CONSUME", "flags & CONFIG_TIMED_CONSUME")
        body = body.replace("activeConfig[offset + 5] & 128", "flags & 128")
        text = text[:begin] + body + text[end:]
    if case in ("split-gating", "split-flags-gating"):
        if case == "split-gating":
            text = replace(text, "    if (tick && scope && scope != (uint8_t)(effectiveLayer + 1)) continue;\n    if (tick) {",
                           "    if (tick) {\n      if (scope && scope != (uint8_t)(effectiveLayer + 1)) continue;")
        else:
            text = replace(text, "    if (tick && (flags & 7) && (flags & 7) != (uint8_t)(effectiveLayer + 1)) continue;\n    if (tick) {",
                           "    if (tick) {\n      if ((flags & 7) && (flags & 7) != (uint8_t)(effectiveLayer + 1)) continue;")
    if case.startswith("no-fraction"):
        actions.write_text(replace(actions.read_text(), "__idata uint8_t timedFraction[CONFIG_TIMED_MAX];", ""))
        text = text.replace("    timedFraction[i] = 0;\n", "")
        text = replace(text, "      timedFraction[i] += tick;\n      if (timedFraction[i] >= tick) continue;\n", "")
        # Process all elapsed coarse ticks, so polling delays retain their elapsed time.
        text = replace(text, "  if (elapsed) timedEvent(elapsed);", "  while (elapsed--) timedEvent(1);")
        if case == "no-fraction-byte-locals":
            text = text.replace("__idata uint8_t", "uint8_t").replace("__pdata uint8_t offset", "uint8_t offset")
    timer.write_text(text)
    sketch = source / "CH552_Universal_Macropad.ino"
    if case.startswith("no-fraction"):
        # bits 12-19 are needed, so this clock must use the full millis word.
        sketch.write_text(sketch.read_text().replace("now >> 7", "clock >> 12"))
        if case == "no-fraction-extract":
            sketch.write_text(sketch.read_text().replace("clock >> 12", "(((uint8_t *)&clock)[1] >> 4) | (((uint8_t *)&clock)[2] << 4)"))
    else:
        sketch.write_text(sketch.read_text().replace("now >> 7", "now >> 4"))
        sketch.write_text(sketch.read_text().replace("Only bits 7-14 reach the byte clock", "Only bits 4-11 reach the byte clock"))


def probe(source, variant, case):
    text = (ROOT / "protocol/layer-timer-probe.c").read_text()
    text = replace(text, "activeConfig[configTimedOffset()] = PROBE_WIDE ? 255 : 63;",
                   "activeConfig[configTimedOffset()] = 255;\n    activeConfig[configTimedOffset() + 5] = 56;")
    text = replace(text, "uint32_t period = (PROBE_WIDE ? 256UL : 64UL) * 256;", "uint32_t period = 2048UL * 256;")
    extra = """static void highIntervals(void) {
    for (uint8_t high = 0; high < 8; high++) {
        for (uint8_t flags = 0; flags < 4; flags++) {
            probeInit(1);
            uint8_t offset = configTimedOffset();
            activeConfig[offset] = 173;
            activeConfig[offset + 5] = (high << 3) | (flags << 6) | 1;
            probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
            uint32_t period = (((uint16_t)high << 8) + 174UL) * 256;
            advanceFine(period - 1); assert(ledCalls == 0);
            advanceFine(1); assert(ledCalls == 1);
            assert(!!actionsTimedInput() == !!(flags & 1));
            assert(ledCalls == 2);
            advanceFine(256); assert(ledCalls == 2);
            actionsTimedInput(); // Restart only when flag bit 7 is set.
            advanceFine(period - 256 - 1);
            assert(ledCalls == 2);
            advanceFine(1); assert(ledCalls == ((flags & 2) ? 2 : 3));
            if (flags & 2) { advanceFine(256); assert(ledCalls == 3); }
        }
    }
}

static void boundariesAndPhase(void) {
    const uint16_t counts[] = {1, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025, 2047, 2048};
    for (uint8_t i = 0; i < sizeof(counts) / sizeof(counts[0]); i++) {
        probeInit(1);
        uint16_t encoded = counts[i] - 1;
        uint8_t offset = configTimedOffset();
        activeConfig[offset] = encoded;
        activeConfig[offset + 5] = (encoded >> 8) << 3;
        uint32_t period = counts[i] * 256UL;
        advanceFine(period - 1); assert(ledCalls == 0);
        advanceFine(1); assert(ledCalls == 1);
        advanceFine(period); assert(ledCalls == 2);
    }
    // High interval bits never contaminate selector validation or the two flags.
    probeInit(1);
    for (uint16_t metadata = 0; metadata < 256; metadata++) {
        activeConfig[configTimedOffset() + 5] = metadata;
        probeSeal();
        assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == ((metadata & 7) <= 3));
    }
    // A reset immediately before a fractional carry keeps its independent phase.
    probeInit(1); setFlags(0, 128);
    activeConfig[configTimedOffset()] = 1;
    advanceFine(511); assert(ledCalls == 0);
    assert(!actionsTimedInput());
    advanceFine(511); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    // Layer changes clear high ages but retain an already armed next-input action.
    probeInit(1); setScope(0, 1); setFlags(0, 192);
    uint8_t offset = configTimedOffset();
    activeConfig[offset] = 255; activeConfig[offset + 5] |= 56;
    advanceFine(2048UL * 256); assert(ledCalls == 1);
    probeLayer(1); assert(actionsTimedInput()); assert(ledCalls == 2);
    probeLayer(0);
    advanceFine(2048UL * 256 - 1); assert(ledCalls == 2);
    advanceFine(1); assert(ledCalls == 3);
}

"""
    text = replace(text, "static void layers(void) {", extra + "static void layers(void) {")
    text = replace(text, "validation(); timing(); layers();", "validation(); timing(); highIntervals(); boundariesAndPhase(); layers();")
    if case.startswith("no-fraction"):
        text = replace(text, "static uint8_t fine;", "static uint32_t fine;")
        text = text.replace("actionsTimedPoll(fine);", "actionsTimedPoll(fine >> 8);")
        text = text.replace("actionsTimedReset(fine);", "actionsTimedReset(fine >> 8);")
        text = replace(text, "assert(ledCalls == (PROBE_RESET ? 0 : 1));", "assert(ledCalls == 1); // Coarse boundary arrives half a unit after reset.")
        text = replace(text, "advanceFine(511); assert(ledCalls == 0);\n    advanceFine(1); assert(ledCalls == 1);",
                       "advanceFine(257); assert(ledCalls == 1); // Coarse reset rounds to the next boundary.")
    (source / "probe.c").write_text(text)
    flags = ["cc", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
             "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
             "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
             "-DPROBE_SHARED=0", "-DPROBE_SCOPED=1", "-DPROBE_WIDE=1",
             "-DPROBE_RESET=1", "-DPROBE_KEEP_RESUME=1", "-DPROBE_CACHED_SCOPE=0",
             "-DCONFIG_TIMED_LAYER_EXPERIMENT=1", f"-I{source}", f"-I{source / 'tests/stubs'}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/variants/ch552'}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/cores/ch55xduino'}"]
    with (source.parent / "probe.log").open("w") as log:
        subprocess.run([*flags, str(source / "probe.c"), str(source / "src/config.c"),
                        str(source / "src/actions.c"), "-o", str(source / "probe")],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(source / "probe")], stdout=log, stderr=subprocess.STDOUT, check=True)


def build(root, case, variant, limit):
    directory = root / f"{case}-{variant}"
    source, output = directory / "source", directory / "build"
    source.mkdir(parents=True)
    prepare(source, case)
    probe(source, variant, case)
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                                 "build", str(source), str(output), "24000000", "148", str(limit), str(variant)],
                                stdout=log, stderr=subprocess.STDOUT)
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(case=case, variant=variant, flash=size("ROM/EPROM/FLASH"),
               paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]), exit=result.returncode)
    row["headroom"] = LIMIT - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="*", default=["split-flags-gating"])
    parser.add_argument("--measure", action="store_true", help="Use a larger linker ceiling to measure overflowing probes")
    args = parser.parse_args()
    if any(case not in CASES for case in args.cases):
        parser.error("Unknown case; choose from " + ", ".join(CASES))
    root = Path(tempfile.mkdtemp(prefix="macropad-eleven-bit-timers-"))
    print(f"Artifacts: {root}", flush=True)
    cases = args.cases
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: build(root, *job, 16384 if args.measure else LIMIT), [(case, v) for case in cases for v in (0, 1)]))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    return int(any(row["exit"] for row in rows))


if __name__ == "__main__":
    sys.exit(main())
