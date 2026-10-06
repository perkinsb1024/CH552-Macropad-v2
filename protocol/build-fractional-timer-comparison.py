"""Compare the implemented eleven-bit timers with/without fractional phase."""
from concurrent.futures import ThreadPoolExecutor
from configparser import ConfigParser
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("eleven_bit", ROOT / "protocol/build-eleven-bit-timer-probes.py")
eleven = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eleven)


def prepare(source, case):
    shutil.copytree(ROOT / "src", source / "src")
    shutil.copytree(ROOT / "tests", source / "tests")
    shutil.copyfile(ROOT / "CH552_Universal_Macropad.ino", source / "CH552_Universal_Macropad.ino")
    settings = ConfigParser()
    settings.read(ROOT / "platformio.ini")
    flags = settings.get("env:ch552", "build_flags", fallback="")
    settings.set("env:ch552", "build_flags", flags)
    with (source / "platformio.ini").open("w") as target:
        settings.write(target)
    if case == "fractional":
        return
    actions = source / "src/actions.c"
    actions.write_text(eleven.replace(actions.read_text(), "__idata uint8_t timedFraction[CONFIG_TIMED_MAX];", ""))
    timer = source / "src/timed_actions.inc"
    text = re.sub(r"(?m)^ *timedFraction\[i\] = 0;\n", "", timer.read_text())
    text = eleven.replace(text, "      // Each carry of the 16 ms fine clock advances age by 4.096 seconds.\n"
                          "      timedFraction[i] += tick;\n"
                          "      if (timedFraction[i] >= tick) continue;\n",
                          "      // Each shared coarse tick advances age by 4.096 seconds.\n")
    text = eleven.replace(text, "  if (elapsed) timedEvent(elapsed);", "  while (elapsed--) timedEvent(1);")
    timer.write_text(text)
    sketch = source / "CH552_Universal_Macropad.ino"
    text = sketch.read_text()
    expressions = {
        "coarse-full-shift": "clock >> 12",
        "coarse-narrow-shift": "(uint16_t)(clock >> 8) >> 4",
        "coarse-byte-combine": "(now >> 12) | ((uint8_t)(clock >> 16) << 4)",
    }
    expression = expressions[case]
    text = eleven.replace(text, "now >> 4", expression)
    text = text.replace("Bits 4-11 form the 16 ms fine clock; the low word is sufficient.",
                        "Bits 12-19 form the 4.096 s coarse clock; the low word alone is insufficient.")
    sketch.write_text(text)


def build(root, case, variant):
    directory = root / f"{case}-{variant}"
    source, output = directory / "source", directory / "build"
    source.mkdir(parents=True)
    prepare(source, case)
    eleven.probe(source, variant, "split-flags-gating" if case == "fractional" else "no-fraction")
    if case != "fractional":
        # Reuse the probe's helpers and compile the additional catch-up checks.
        test = source / "catchup.c"
        test.write_text((source / "probe.c").read_text().replace("int main(void)", "int intervalProbeMain(void)") + '''
int main(void) {
    probeInit(1);
    activeConfig[configTimedOffset()] = 1;
    actionsTimedPoll(5); assert(ledCalls == 2);
    assert(!actionsTimedInput()); assert(ledCalls == 3);
    actionsTimedPoll(6); assert(ledCalls == 4);
    probeInit(1); actionsTimedReset(254);
    actionsTimedPoll(1); assert(ledCalls == 3);
    probeInit(2); setScope(0, 1); setFlags(0, 64);
    activeConfig[configTimedOffset() + 1] = CONFIG_ACTION_SET_LAYER;
    activeConfig[configTimedOffset() + 2] = 1;
    actionsTimedPoll(3); assert(actionsLayer() == 1 && ledCalls == 3);
    assert(actionsTimedInput()); assert(ledCalls == 5);
    // This clock extracts the same bits as millis >> 12, including word wraps.
    uint32_t state = 0xB6A4D103;
    for (uint32_t i = 0; i < 1000000; i++) {
        state ^= state << 13; state ^= state >> 17; state ^= state << 5;
        uint8_t expected = state >> 12;
        assert((uint8_t)((uint16_t)(state >> 8) >> 4) == expected);
        assert((uint8_t)(((uint16_t)state >> 12) | ((uint8_t)(state >> 16) << 4)) == expected);
    }
    return 0;
}
''')
        flags = ["cc", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
                 "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
                 "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
                 "-DPROBE_SHARED=0", "-DPROBE_SCOPED=1", "-DPROBE_WIDE=1",
                 "-DPROBE_RESET=1", "-DPROBE_KEEP_RESUME=1", "-DPROBE_CACHED_SCOPE=0",
                 "-DCONFIG_TIMED_LAYER_EXPERIMENT=1", f"-I{source}", f"-I{source / 'tests/stubs'}",
                 f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/variants/ch552'}",
                 f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/cores/ch55xduino'}"]
        with (directory / "catchup.log").open("w") as log:
            subprocess.run([*flags, str(test), str(source / "src/config.c"), str(source / "src/actions.c"),
                            "-o", str(source / "catchup")], stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run([str(source / "catchup")], stdout=log, stderr=subprocess.STDOUT, check=True)
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
                                 "build", str(source), str(output), "24000000", "148", "14336", str(variant)],
                                stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"Build failed; inspect {directory / 'build.log'}")
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    rows = re.findall(r"(?m)^0x[0-9a-f]+:\|(.+)\|$", mem)
    # Count occupied bytes, including banks/bit storage/overlays, excluding holes/stack.
    internal = sum(slot not in (" ", "S") for row in rows for slot in row.split("|"))
    row = dict(case=case, variant=variant, flash=size("ROM/EPROM/FLASH"),
               internal=internal, paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]))
    row["headroom"] = 14336 - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def main():
    root = Path(tempfile.mkdtemp(prefix="macropad-fractional-comparison-", dir="/private/tmp"))
    print(f"Artifacts: {root}", flush=True)
    cases = sys.argv[1:] or ["fractional", "coarse-narrow-shift"]
    if any(case not in ("fractional", "coarse-full-shift", "coarse-narrow-shift", "coarse-byte-combine") for case in cases):
        raise ValueError("Unknown comparison case")
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: build(root, *job), [(case, v) for case in cases for v in (0, 1)]))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
