"""Build isolated layer-timer experiments; never alter production or releases.

The 16 KiB linker ceiling is for size measurement only. CH552 application images
must still fit 14,336 bytes. Oversized outputs are not suitable for flashing.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE_REVISION = os.environ.get("MACROPAD_PROBE_REVISION", "60661c8")
LIMIT = 14336
CASES = [
    ("baseline", "none", False, False),
    ("ram-placement", "none", False, False),
    ("shared-pause", "shared", False, False),
    ("shared-reset", "shared", False, True),
    ("six-pause", "six", False, False),
    ("six-reset", "six", False, True),
    ("interval-eight", "none", True, False),
    ("six-eight-pause", "six", True, False),
    ("six-eight-reset", "six", True, True),
    ("six-eight-reset-keep-resume", "six", True, True),
]


def replace(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError(f"Expected one occurrence: {before[:90]!r}")
    return text.replace(before, after)


def prepare(project, scope, wide, reset, placement=False, keep_resume=False):
    # Anchor historical measurements even after optimizations are retained in
    # the working tree. "worktree" is available for explicitly cumulative probes.
    if BASE_REVISION == "worktree":
        shutil.copytree(ROOT / "src", project / "src")
        shutil.copytree(ROOT / "tests", project / "tests")
        shutil.copyfile(ROOT / "CH552_Universal_Macropad.ino", project / "CH552_Universal_Macropad.ino")
        shutil.copyfile(ROOT / "platformio.ini", project / "platformio.ini")
    else:
        archive = subprocess.run(["git", "archive", BASE_REVISION, "src", "tests",
                                  "CH552_Universal_Macropad.ino", "platformio.ini"],
                                 cwd=ROOT, stdout=subprocess.PIPE, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            for entry in source:
                if not entry.isfile():
                    continue
                path = Path(entry.name)
                if path.is_absolute() or ".." in path.parts:
                    raise RuntimeError("Unexpected archive path")
                target = project / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.extractfile(entry).read())
    header = (project / "src/config.h").read_text()
    config = (project / "src/config.c").read_text()
    actions = (project / "src/actions.c").read_text()
    sketch = (project / "CH552_Universal_Macropad.ino").read_text()
    if placement:
        # Validation is infrequent. Free four direct-address slots while keeping
        # the hot action globals in their original, cheaper address space.
        declarations = ["uint8_t layer;", "uint8_t i;", "uint8_t previous = 0;", "uint8_t id;"]
        for declaration in declarations:
            start = config.index("FW_BIT configValid(")
            config = config[:start] + config[start:].replace(declaration, "__idata " + declaration, 1)
        if scope == "shared":
            for declaration in ("__data uint8_t previousLayer;", "__data uint8_t oneShotReturnLayer;"):
                actions = replace(actions, declaration, declaration.replace("__data", "__idata"))
            actions = replace(actions, "  uint8_t other;\n  uint8_t keys = configKeyCount();",
                              "  __idata uint8_t other;\n  __idata uint8_t keys = configKeyCount();")
    extra = 2 if scope == "shared" else 0
    six = scope == "six" or wide
    if six:
        header = replace(header, "#define CONFIG_TIMED_SIZE (CONFIG_TIMED_RESUME ? 5 : 3)",
                         "#define CONFIG_TIMED_SIZE 6")
    if extra:
        # Reserve two scope bytes only when at least one timer exists.
        config = replace(config, "(uint8_t)(CONFIG_TIMED_SIZE * timers) + (uint16_t)used;",
                         "(uint8_t)(CONFIG_TIMED_SIZE * timers) + (timers ? 2 : 0) + (uint16_t)used;")
        config = replace(config, "return layerOffset(configLayerCount()) + 3 * ((activeConfig[5] >> 1) & 63);",
                         "return layerOffset(configLayerCount()) + 3 * ((activeConfig[5] >> 1) & 63) + (configTimedCount() ? 2 : 0);")
        config = replace(config, "    for (i = 0; i < timers; i++, offset += CONFIG_TIMED_SIZE) {",
                         "    if (timers) {\n"
                         "        for (i = 0; i < timers; i++) {\n"
                         "            __idata uint8_t scope = image[offset + (i >> 1)];\n"
                         "            if (i & 1) scope >>= 4;\n"
                         "            scope &= 7;\n"
                         "            if (scope && scope > layers) return 0;\n"
                         "        }\n"
                         "        offset += 2;\n"
                         "    }\n"
                         "    for (i = 0; i < timers; i++, offset += CONFIG_TIMED_SIZE) {")
        # Decode inline to avoid nested accessors exhausting direct internal RAM.
        actions = replace(actions, "  __pdata uint8_t offset = configTimedOffset();",
                          "  __pdata uint8_t offset = configTimedOffset();\n"
                          "  __idata uint8_t scopes = offset - 2;")
        scope_read = "activeConfig[scopes + (i >> 1)]"
    else:
        scope_read = "activeConfig[offset + 5] & 7"
        if scope != "none":
            config = replace(config, "    for (i = 0; i < timers; i++, offset += CONFIG_TIMED_SIZE) {",
                             "    for (i = 0; i < timers; i++, offset += CONFIG_TIMED_SIZE) {\n"
                             "        __idata uint8_t scope = image[offset + 5] & 7;\n"
                             "        if (scope && scope > layers) return 0;")
    if placement:
        actions = replace(actions, "#if CONFIG_SCROLL_ACCELERATION\n    __idata uint8_t age = timedAge[i];\n#else\n    uint8_t age = timedAge[i];\n#endif",
                          "    __idata uint8_t age = timedAge[i];")
        actions = replace(actions, "  for (uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {",
                          "  for (__idata uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {")
    if scope != "none":
        decode = f"    __idata uint8_t scope = {scope_read};\n"
        if extra:
            decode += "    if (i & 1) scope >>= 4;\n    scope &= 7;\n"
        actions = replace(actions, "    uint8_t action = 0;\n    if (tick) {",
                          "    uint8_t action = 0;\n"
                          + decode +
                          ("    if (tick && scope && scope != (uint8_t)(effectiveLayer + 1)) continue;\n" if keep_resume else
                           "    if (scope && scope != (uint8_t)(effectiveLayer + 1)) continue;\n") +
                          "    if (tick) {")
        if reset:
            # Reset at the actual transition, including out-and-back between polls.
            actions = replace(actions, "static void updateLayer(void);",
                              "static void updateLayer(void);\nstatic void resetLayerTimers(void);")
            actions = replace(actions, "    effectiveLayer = next;",
                              "    effectiveLayer = next;\n    resetLayerTimers();")
            helper = "\nstatic void resetLayerTimers(void) {\n"
            helper += "  __idata uint8_t offset = configTimedOffset();\n"
            if extra:
                helper += "  __idata uint8_t scopes = offset - 2;\n"
            helper += "  for (__idata uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {\n"
            helper += decode
            helper += "    if (scope) {\n"
            helper += "      timedAge[i] = 0;\n      timedFraction[i] = 0;\n"
            if wide and not keep_resume:
                helper += "      timedPending[i] = 0;\n"
            helper += "    }\n  }\n}\n"
            actions += helper
    if wide:
        # A per-timer byte costs four idata bytes, but avoids variable bit shifts.
        # A bit-mask variant can be investigated separately if warranted.
        actions = replace(actions, "__idata uint8_t timedFraction[CONFIG_TIMED_MAX];",
                          "__idata uint8_t timedFraction[CONFIG_TIMED_MAX];\n__idata uint8_t timedPending[CONFIG_TIMED_MAX];")
        actions = replace(actions, "    timedAge[i] = 0;\n    timedFraction[i] = 0;",
                          "    timedAge[i] = 0;\n    timedFraction[i] = 0;\n    timedPending[i] = 0;")
        actions = replace(actions, "timedWork = activeConfig[offset] & CONFIG_TIMED_INTERVAL_MASK;",
                          "timedWork = activeConfig[offset];")
        actions = replace(actions, "if ((age & 127) == timedWork) {", "if (age == timedWork) {")
        actions = replace(actions, "age = CONFIG_TIMED_RESUME ? 128 : 0;",
                          "age = 0;\n        timedPending[i] = 1;")
        actions = replace(actions, "if (age & 128) {", "if (timedPending[i]) {")
        actions = replace(actions, "      age &= 127;", "      timedPending[i] = 0;")
        actions = replace(actions, "activeConfig[offset] & CONFIG_TIMED_CONSUME",
                          "activeConfig[offset + 5] & CONFIG_TIMED_CONSUME")
        actions = replace(actions, "activeConfig[offset] & 128", "activeConfig[offset + 5] & 128")
        sketch = sketch.replace("clock >> 9", "clock >> 7")
        actions = actions.replace("tick is elapsed 512 ms units", "tick is elapsed 128 ms units")
    (project / "src/config.h").write_text(header)
    (project / "src/config.c").write_text(config)
    (project / "src/actions.c").write_text(actions)
    (project / "CH552_Universal_Macropad.ino").write_text(sketch)


def build_case(root, case, variant):
    name, scope, wide, reset = case
    directory = root / f"{name}-{variant}"
    project, build = directory / "source", directory / "build"
    project.mkdir(parents=True)
    build.mkdir()
    keep_resume = name.endswith("keep-resume")
    prepare(project, scope, wide, reset, placement=name != "baseline", keep_resume=keep_resume)
    run_probe(project, scope, wide, reset, variant, keep_resume)
    with (directory / "build.log").open("w") as log:
        result = subprocess.run([
            sys.executable, str(ROOT / "pio-platform/build_firmware.py"),
            "build", str(project), str(build), "24000000", "148", "16384", str(variant),
        ], stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        print(f"{name}-{variant}: build failed; see {directory / 'build.log'}", flush=True)
        return dict(case=name, variant=variant, error="build failed")
    mem = (build / "firmware.mem").read_text()
    def size(label):
        return int(re.search(rf"{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)", mem)[1])
    row = dict(case=name, variant=variant, flash=size("ROM/EPROM/FLASH"),
               paged=size("PAGED EXT. RAM"), external=size("EXTERNAL RAM"),
               stack=int(re.search(r"with (\d+) bytes available", mem)[1]))
    row["headroom"] = LIMIT - row["flash"]
    print(json.dumps(row), flush=True)
    return row


def run_probe(project, scope, wide, reset, variant, keep_resume=False, cached_scope=False, native_experiment=False):
    shutil.copyfile(ROOT / "protocol/layer-timer-probe.c", project / "probe.c")
    flags = ["cc", "-std=c99", "-Wno-unknown-pragmas", "-Wno-bitwise-op-parentheses",
             "-Wno-pointer-to-int-cast", "-D__data=", "-D__idata=", "-D__pdata=",
             "-D__xdata=", "-D__code=", f"-DPHYSICAL_VARIANT={variant}",
             f"-DPROBE_SHARED={int(scope == 'shared')}",
             f"-DPROBE_SCOPED={int(scope != 'none')}", f"-DPROBE_WIDE={int(wide)}",
             f"-DPROBE_RESET={int(reset)}", f"-I{project}", f"-I{project / 'tests/stubs'}",
             f"-DPROBE_KEEP_RESUME={int(keep_resume)}",
             f"-DPROBE_CACHED_SCOPE={int(cached_scope)}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/variants/ch552'}",
             f"-I{ROOT / 'webUploader/upstream/ch55xduino/ch55x/cores/ch55xduino'}"]
    binary = project / "probe"
    if native_experiment:
        flags.append("-DCONFIG_TIMED_LAYER_EXPERIMENT=1")
    with (project.parent / "probe.log").open("w") as log:
        subprocess.run([*flags, str(project / "probe.c"), str(project / "src/config.c"),
                        str(project / "src/actions.c"), "-o", str(binary)],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(binary)], stdout=log, stderr=subprocess.STDOUT, check=True)


def main():
    root = Path(tempfile.mkdtemp(prefix="macropad-layer-timers-"))
    print(f"Artifacts: {root}", flush=True)
    jobs = [(case, variant) for case in CASES for variant in (0, 1)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: build_case(root, *job), jobs))
    (root / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    return int(any("error" in row for row in rows))


if __name__ == "__main__":
    sys.exit(main())
