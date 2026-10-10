"""Exercise the preserved startup debounce trial against both host variants."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = "8de77d2"
PATCH = Path(__file__).with_name("encoder-startup-debounce-trial.patch")
FLAGS = [
    "cc", "-std=c99", "-Wall", "-Wextra", "-Wno-unknown-pragmas",
    "-Wno-bitwise-op-parentheses", "-Wno-pointer-to-int-cast",
    "-D__data=", "-D__idata=", "-D__pdata=", "-D__xdata=", "-D__code=",
    "-Itests", "-Itests/stubs", "-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552",
    "-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino",
]
CASES = r'''
static void probeStartup(uint8_t invalid, uint32_t start,
                         uint8_t releaseAt, uint8_t releaseFor) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    saveStartupProfile();
    if (invalid) memset(flash, 0xFF, sizeof(flash));
    currentMs = probeStart = start;
    probeReleaseAt = releaseAt;
    probeReleaseFor = releaseFor;
    probeActive = expectBootloader = 1;
    probeEntryAt = UINT32_MAX;
    USB_CTRL = EA = TMOD = 1;
    if (setjmp(bootloaderJump) == 0) {
        setup();
        assert(releaseAt <= 10);
        assert(probeEntryAt == UINT32_MAX);
        assert(currentMs - start == releaseAt);
        // Even a new debounced press after rejected startup cannot enter.
        probeActive = 0;
        UsbConfig = 1;
        tick((uint16_t)(start + 20));
        P3 &= ~8;
        tick((uint16_t)(start + 21));
        tick((uint16_t)(start + 31));
        tick((uint16_t)(start + 3031));
    } else {
        assert(releaseAt > 10);
        assert(probeEntryAt - start == 10);
    }
    expectBootloader = probeActive = 0;
    encoderHeldAtStartup = 0;
    P1 = P3 = 0xFF;
}

int main(void) {
    existingInputMain();
    const uint32_t starts[] = {0, 250, 65530, UINT32_MAX - 5};
    for (uint8_t invalid = 0; invalid < 2; invalid++) {
        for (uint8_t start = 0; start < 4; start++) {
            for (uint8_t release = 0; release <= 10; release++) {
                probeStartup(invalid, starts[start], release, 255);
                probeStartup(invalid, starts[start], release, 1);
            }
            probeStartup(invalid, starts[start], 255, 1);
        }
    }
    return 0;
}
'''

with tempfile.TemporaryDirectory(prefix="macropad-startup-debounce-") as directory:
    trial = Path(directory)
    (trial / "CH552_Universal_Macropad.ino").write_text(
        subprocess.check_output(["git", "show", f"{BASE}:CH552_Universal_Macropad.ino"], cwd=ROOT, text=True)
    )
    (trial / "src").symlink_to(ROOT / "src", target_is_directory=True)
    subprocess.run(["git", "apply", "--unsafe-paths", str(PATCH)], cwd=trial, check=True)
    source = subprocess.check_output(["git", "show", f"{BASE}:tests/input_test.c"], cwd=ROOT, text=True)
    source = source.replace('#include "stubs/Arduino.h"', '#include "Arduino.h"')
    source = source.replace('#include "../src/', '#include "' + str(ROOT / "src") + '/')
    source = source.replace('#include "config_fixture.h"', '#include "' + str(ROOT / "tests/config_fixture.h") + '"')
    source = source.replace('#include "../CH552_Universal_Macropad.ino"', '#include "CH552_Universal_Macropad.ino"')
    source = source.replace('static uint8_t encoderHeldAtStartup;', '''
static uint8_t encoderHeldAtStartup;
static uint8_t probeActive, probeReleaseAt, probeReleaseFor;
static uint32_t probeStart, probeEntryAt;
static uint8_t probeEncoderPin(void) {
    if (!probeActive) return encoderHeldAtStartup ? 0 : ((P3 >> 3) & 1);
    uint32_t elapsed = currentMs - probeStart;
    return elapsed >= probeReleaseAt && elapsed - probeReleaseAt < probeReleaseFor;
}''')
    source = source.replace('(encoderHeldAtStartup ? 0 : ((P3 >> 3) & 1))', 'probeEncoderPin()')
    source = source.replace('void delayMicroseconds(uint16_t us) {', '''
void delayMicroseconds(uint16_t us) {
    if (us == 1000) { currentMs++; return; }
    if (probeActive && us == 50000 && !bootloaderWaits) probeEntryAt = currentMs;''')
    source = source.replace('int main(void) {', 'static int existingInputMain(void) {')
    probe = trial / "probe.c"
    probe.write_text(source + CASES)
    for preview in (1, 0):
        for variant in (0, 1):
            binary = trial / f"probe-{variant}-{preview}"
            subprocess.run([
                *FLAGS, f"-DPHYSICAL_VARIANT={variant}", f"-DENABLE_COLOR_PREVIEW={preview}",
                str(probe), "src/config.c", "src/actions.c", "-o", str(binary),
            ], cwd=ROOT, check=True)
            subprocess.run([str(binary)], check=True)
            print(f"Passed variant={variant}, preview={preview}: existing input suite and 184 startup cases", flush=True)
