"""Reproduce macro experiments in temporary copies, without touching releases."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "4647e6d"
PROTOTYPE = "38e5816"
CASES = {
    "baseline": (0, 0, 0),
    "pair": (1, 0, 0),
    "pair-repeat": (1, 1, 0),
    "dynamic": (2, 0, 0),
    "dynamic-repeat": (2, 1, 0),
    "dynamic-pause": (2, 1, 1),
    "counted": (3, 0, 0),
    "counted-repeat": (3, 1, 0),
    "dynamic-unaligned": (2, 1, 1),
}


def counted(source, repeat):
    """Alternative: length in aux, word address + 1-4 repeats in parameter."""
    p = source / "src/config.h"
    s = p.read_text().replace("#define CONFIG_VERSION (CONFIG_MACRO_STYLE == 1 ? 12 : 11)",
                              "#define CONFIG_VERSION 13")
    p.write_text(s)
    p = source / "src/config.c"
    s = p.read_text()
    a = s.index("            // Absolute image offset:")
    b = s.index("        case CONFIG_ACTION_LED_CONTROL:", a)
    s = s[:a] + "            if (rotation == 2) return 0;\n" + (
        "" if repeat else "            if (param & 0xC0) return 0;\n"
    ) + """            param = (param & 63) << 1;
            return param >= macros && (uint8_t)(param + 2 * aux) < CONFIG_SIZE - 1;
""" + s[b:]
    s = s.replace("for (offset = validationPool + validationUsed;",
                  "for (offset = (validationPool + validationUsed + 1) & 0xFE;")
    p.write_text(s)
    p = source / "src/actions.c"
    s = p.read_text().replace("__data uint8_t macroStart;", "__idata uint8_t macroRemaining;" + (
        "\n__data uint8_t macroStart;\n__idata uint8_t macroLength;" if repeat else ""
    ))
    a = s.index("#if CONFIG_MACRO_STYLE == 1", s.index("void actionsPoll"))
    b = s.index("    } else if (eventUsed)", a)
    s = s[:a] + """      currentFirst = activeConfig[macroNext];
      currentSecond = activeConfig[macroNext + 1];
      macroNext += 2;
      if (!macroRemaining--) {
""" + ("""        if (macroRepeat) {
          macroRepeat--;
          macroNext = macroStart;
          macroRemaining = macroLength;
        } else
""" if repeat else "") + "        macroNext = 0;\n      }\n" + s[b:]
    a = s.index("      macroNext = macroStart = currentSecond;")
    b = s.index("      currentFirst = 0;", a)
    s = s[:a] + """      macroNext = (currentSecond & 63) << 1;
      macroRemaining = currentFirst >> 4;
""" + ("""      macroStart = macroNext;
      macroLength = macroRemaining;
      macroRepeat = currentSecond >> 6;
""" if repeat else "") + s[b:]
    p.write_text(s)
    # Keep ordinary config/action/USB/input/timer regressions; the counted wire
    # format uses the dedicated probe below instead of terminated-macro fixtures.
    p = source / "tests/run_host_tests.py"
    s = p.read_text()
    s = re.sub(r'^    suites \+= \[\("macros".*\n', '', s, flags=re.M)
    p.write_text(s)
    test = (source / "tests/macros_test.c").read_text()
    test = test[:test.index("static void testValidation(void)")]
    test += r'''
int main(void) {
    reset(); start = (start + 1) & 0xFE;
    for (uint8_t i = 0; i < 16; i++) {
        activeConfig[start + 2 * i] = 1;
        activeConfig[start + 2 * i + 1] = 4 + i;
    }
    for (unsigned param = 0; param < 256; param++) {
        for (uint8_t length = 1; length <= 16; length++) {
            activeConfig[9] = CONFIG_ACTION_MACRO | ((length - 1) << 4);
            activeConfig[10] = param; seal();
            uint8_t position = (param & 63) << 1;
            uint8_t expected = position >= configTimedOffset() &&
                position + 2 * (length - 1) < 127 &&
                (CONFIG_MACRO_REPEAT || !(param & 192));
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == expected);
        }
    }
    for (uint8_t repeat = 1; repeat <= (CONFIG_MACRO_REPEAT ? 4 : 1); repeat++) {
        actionsInit(); count = 0;
        activeConfig[9] = 0xF4;
        activeConfig[10] = (start >> 1) | ((repeat - 1) << 6);
        seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
        press(0, 0); pump(0, 2000);
        assert(count == 32u * repeat && !actionsDropped(0));
    }
    activeConfig[start] = CONFIG_ACTION_MACRO;
    activeConfig[start + 1] = start >> 1;
    seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    return 0;
}
'''
    (source / "tests/counted_probe.c").write_text(test)


def prepare(source, case):
    source.mkdir(parents=True)
    if case == "baseline":
        data = subprocess.check_output(["git", "archive", BASELINE, "src", "tests",
                                        "CH552_Universal_Macropad.ino", "platformio.ini"], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            archive.extractall(source)
    else:
        data = subprocess.check_output(["git", "archive", PROTOTYPE, "src", "tests",
                                        "CH552_Universal_Macropad.ino", "platformio.ini"], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            archive.extractall(source)
        style, repeat, pause = CASES[case]
        with (source / "platformio.ini").open("a") as f:
            f.write(f"\nbuild_flags = -DCONFIG_MACRO_STYLE={style} -DCONFIG_MACRO_REPEAT={repeat} -DCONFIG_MACRO_PAUSE={pause}\n")
        if style == 3:
            counted(source, repeat)
        if case == "dynamic-unaligned":
            for name in ("src/config.h", "src/config.c"):
                p = source / name
                p.write_text(p.read_text().replace("__at (0x300) ", ""))
    (source / "pio-platform").mkdir()
    shutil.copyfile(ROOT / "pio-platform/build_firmware.py", source / "pio-platform/build_firmware.py")
    (source / "webUploader").symlink_to(ROOT / "webUploader", target_is_directory=True)


def host_test(source, case, log):
    with log.open("w") as f:
        subprocess.run([sys.executable, str(source / "tests/run_host_tests.py")],
                       cwd=source, stdout=f, stderr=subprocess.STDOUT, check=True)
        if CASES[case][0] == 3:
            for variant in (0, 1):
                binary = source / f"counted-probe-{variant}"
                flags = ["cc", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
                         "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
                         "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
                         "-DCONFIG_MACRO_STYLE=3", f"-DCONFIG_MACRO_REPEAT={CASES[case][1]}",
                         "-DCONFIG_MACRO_PAUSE=0", "-Itests/stubs",
                         "-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552",
                         "-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino"]
                subprocess.run([*flags, "tests/counted_probe.c", "src/config.c", "src/actions.c",
                                "-o", str(binary)], cwd=source, stdout=f, stderr=subprocess.STDOUT, check=True)
                subprocess.run([str(binary)], stdout=f, stderr=subprocess.STDOUT, check=True)


def measure(root, case, variant):
    source = root / case / "source"
    output = root / case / f"build-{variant}"
    log = root / case / f"build-{variant}.log"
    with log.open("w") as f:
        result = subprocess.run([sys.executable, str(ROOT / "pio-platform/build_firmware.py"), "build",
                                 str(source), str(output), "24000000", "148", "14336", str(variant)],
                                stdout=f, stderr=subprocess.STDOUT)
    if not (output / "firmware.mem").exists():
        raise RuntimeError(f"Compilation failed; inspect {log}")
    mem = (output / "firmware.mem").read_text()
    def size(label):
        return int(re.search(re.escape(label) + r"\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    rows = re.findall(r"(?m)^0x[0-9a-f]+:\|(.+)\|$", mem)
    internal = sum(x not in (" ", "S") for row in rows for x in row.split("|"))
    stack = int(re.search(r"with (\d+) bytes available", mem)[1])
    absolute = 0 if case in ("baseline", "dynamic-unaligned") else 128
    record = dict(case=case, variant=variant, success=result.returncode == 0 and stack >= 64,
                  flash=size("ROM/EPROM/FLASH"), spare=14336 - size("ROM/EPROM/FLASH"),
                  internal=internal, stack=stack, paged=size("PAGED EXT. RAM"),
                  external=size("EXTERNAL RAM"), absolute=absolute,
                  errors=re.findall(r"ERROR:.*", mem))
    record["external_total"] = record["paged"] + record["external"] + absolute
    print(json.dumps(record), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="*", metavar="CASE")
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()
    cases = args.cases or list(CASES)
    if any(case not in CASES for case in cases):
        parser.error("Unknown case; choose from " + ", ".join(CASES))
    root = Path(tempfile.mkdtemp(prefix="macropad-macro-comparison-", dir="/private/tmp"))
    print(f"Artifacts: {root}", flush=True)
    for case in cases:
        source = root / case / "source"
        prepare(source, case)
        if not args.skip_tests:
            # Host compiler needs the same feature switches as SDCC.
            runner = source / "tests/run_host_tests.py"
            s = runner.read_text()
            if case != "baseline":
                style, repeat, pause = CASES[case]
                s = s.replace('if "--no-preview" in sys.argv:',
                              f'flags += ["-DCONFIG_MACRO_STYLE={style}", "-DCONFIG_MACRO_REPEAT={repeat}", "-DCONFIG_MACRO_PAUSE={pause}"]\nif "--no-preview" in sys.argv:')
                runner.write_text(s)
            host_test(source, case, root / case / "tests.log")
            print(f"Host tests passed: {case}", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(lambda job: measure(root, *job),
                                [(case, v) for case in cases for v in (0, 1)]))
    (root / "results.json").write_text(json.dumps(records, indent=2) + "\n")
    unexpected = [r for r in records if not r["success"] and r["case"] != "dynamic-unaligned"]
    if unexpected:
        raise SystemExit("Unexpected build failure; see results.json")


if __name__ == "__main__":
    main()
