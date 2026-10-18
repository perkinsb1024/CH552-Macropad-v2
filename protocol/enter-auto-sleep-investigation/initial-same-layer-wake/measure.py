"""Measure isolated Enter Auto-Sleep candidates; never edits active firmware."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ARTIFACTS = Path('/private/tmp/macropad-enter-auto-sleep')
FILES = ['src/config.h', 'src/config.c', 'src/actions.c', 'src/timed_actions.inc']


def replace(source, filename, old, new):
    path = source / filename
    text = path.read_text()
    assert text.count(old) == 1, (filename, old)
    path.write_text(text.replace(old, new))


def prepare(name):
    source = ARTIFACTS / name / 'source'
    source.mkdir(parents=True, exist_ok=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory, dirs_exist_ok=True)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    if not (source / 'webUploader').exists():
        (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    if name != 'baseline':
        replace(source, 'src/config.h', '#define CONFIG_LED_EFFECT_RESTORE  0x80',
                '// Provisional investigation encoding; not a published format allocation.\n'
                '#define CONFIG_LED_ENTER_SLEEP     0x10\n'
                '#define CONFIG_LED_EFFECT_RESTORE  0x80')
        replace(source, 'src/config.c', '            if (param > CONFIG_LED_PRESET_TOGGLE) return 0;',
                '            if (param == CONFIG_LED_ENTER_SLEEP) return 1; // Value ignored.\n'
                '            if (param > CONFIG_LED_PRESET_TOGGLE) return 0;')
        replace(source, 'src/actions.c', 'static void resetLayerTimers(void);',
                'static void resetLayerTimers(void);\nstatic void enterAutoSleep(void);')
        replace(source, 'src/actions.c', '    firmwareLedAction(second, first >> 4);',
                '    if (second == CONFIG_LED_ENTER_SLEEP) enterAutoSleep();\n'
                '    else firmwareLedAction(second, first >> 4);')
        guard = ('  if (!(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) return;\n'
                 if name == 'enabled-only' else '')
        replace(source, 'src/timed_actions.inc', 'static ACTION_BIT timedEvent(uint8_t tick) {',
                'static void enterAutoSleep(void) {\n' + guard +
                '  uint8_t slot = configTimedCount();\n'
                '  timedAge[slot] = 0;\n'
                '  timedHigh[slot] = 1;\n'
                '  timedFraction[slot] = 0;\n'
                '  firmwareLedAction(LED_SLEEP_CAPTURE, activeConfig[CONFIG_SIZE + 1] >> 4);\n'
                '}\n\nstatic ACTION_BIT timedEvent(uint8_t tick) {')
        if name == 'any-layer':
            # Entering a disabled layer already wakes through resetLayerTimers.
            # Explicit same-layer selection must wake forced sleep there too.
            replace(source, 'src/actions.c', '    if (first & CONFIG_LAYER_HOLD) {',
                    '    if (second == CONFIG_LAYER_PREVIOUS) second = previousLayer;\n'
                    '    if (second == effectiveLayer &&\n'
                    '        !(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) {\n'
                    '      uint8_t slot = configTimedCount();\n'
                    '      if (timedHigh[slot] & 1) {\n'
                    '        timedHigh[slot] = 0;\n'
                    '        firmwareLedAction(LED_SLEEP_RESTORE, 0);\n'
                    '      }\n'
                    '    }\n'
                    '    if (first & CONFIG_LAYER_HOLD) {')
            replace(source, 'src/actions.c',
                    '    if (second == CONFIG_LAYER_PREVIOUS) second = previousLayer;\n    if (first & 0x10)',
                    '    if (first & 0x10)')
    patch = []
    for filename in FILES:
        patch.extend(difflib.unified_diff((ROOT / filename).read_text().splitlines(True),
                     (source / filename).read_text().splitlines(True),
                     fromfile='a/' + filename, tofile='b/' + filename))
    (HERE / (name + '.patch')).write_text(''.join(patch))
    hashes = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(source.rglob('*')) if p.is_file()
              and '__pycache__' not in p.parts and 'webUploader' not in p.parts}
    (HERE / ('source-' + name + '-sha256.json')).write_text(json.dumps(hashes, indent=2) + '\n')
    return source


def build(job):
    name, source, variant = job
    output = ARTIFACTS / name / ('three' if variant else 'six')
    command = [sys.executable, str(ROOT / 'pio-platform/build_firmware.py'), 'build',
               str(source), str(output), '24000000', '148', '14336', str(variant)]
    result = subprocess.run(command, capture_output=True, text=True)
    # Save build output as investigation evidence, including failed real links.
    output.mkdir(parents=True, exist_ok=True)
    (output / 'build.log').write_text(result.stdout + result.stderr)
    if not (output / 'firmware.mem').exists():
        raise RuntimeError(result.stdout[-2000:] + result.stderr[-2000:])
    mem = (output / 'firmware.mem').read_text()
    def size(label):
        return int(re.search(rf'{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)', mem)[1])
    row = dict(candidate=name, variant=variant, flash=size('ROM/EPROM/FLASH'),
               paged=size('PAGED EXT. RAM'), external=size('EXTERNAL RAM'),
               stack=int(re.search(r'with (\d+) bytes available', mem)[1]),
               code_limit=14336, returncode=result.returncode, artifacts=str(output))
    row['free'] = 14336 - row['flash']
    if not result.returncode:
        row['firmware_sha256'] = hashlib.sha256((output / 'firmware.hex').read_bytes()).hexdigest()
    shutil.copyfile(output / 'firmware.mem', HERE / (name + '-' + str(variant) + '.mem'))
    print(json.dumps(row), flush=True)
    return row


def main():
    names = sys.argv[1:] or ['baseline', 'any-layer', 'enabled-only']
    assert set(names) <= {'baseline', 'any-layer', 'enabled-only'}
    sources = {name: prepare(name) for name in names}
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(build, [(name, source, variant)
                    for name, source in sources.items() for variant in (0, 1)]))
    destination = HERE / 'results.json'
    if destination.exists():
        rows = [r for r in json.loads(destination.read_text())['rows']
                if r['candidate'] not in names] + rows
    destination.write_text(json.dumps(dict(
        baseline_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        baseline_status=subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True),
        rows=rows), indent=2) + '\n')


if __name__ == '__main__':
    main()
