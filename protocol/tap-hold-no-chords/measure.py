"""Measure mutually exclusive chord/independent-hold builds in isolated sources."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ART = Path('/private/tmp/macropad-tap-hold-no-chords')
spec = importlib.util.spec_from_file_location('prior_measure', ROOT / 'protocol/tap-hold-investigation/measure.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
prior.HERE, prior.ART = HERE, ART
replace = prior.replace
FILES = (*prior.FIRMWARE, 'platformio.ini')


def drop(text, start, end):
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + text[b:]


def no_chords(source):
    p = source / 'src/actions.c'
    s = p.read_text()
    s = drop(s, '__pdata uint8_t chordPartner[6];', '__xdata uint16_t tapSince[') if '__xdata uint16_t tapSince[' in s else drop(s, '__pdata uint8_t chordPartner[6];', '__idata uint8_t lastMouse;')
    s = s.replace('  if (input < 6) source |= chordPartner[input] << 4;\n', '')
    s = s.replace('  liveReply[12] = pendingInput;', '  liveReply[12] = 0; // No chord candidate exists in this build.')
    s = drop(s, 'static void resolvePending(void) {', 'static void updateLayer(void) {')
    s = s.replace('    // Pending singles belong to the layer on which they were pressed.\n    resolvePending();\n', '')
    s = s.replace('  pendingInput = 0;\n', '')
    s = drop(s, '  for (i = 0; i < 6; i++) {\n    chordPartner[i] = 0;', '  eventHead = 0;')
    s = s.replace('  uint8_t other;\n', '')
    s = s.replace('  __idata uint8_t chordWindow = configChordWindowMs();\n', '')
    s = drop(s, '  if (input < keys && chordPartner[input]) {', '  configBinding(effectiveLayer, input, &first, &second);')
    s = drop(s, '  if (input < keys && chordWindow) {', '  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\nstatic void releaseAction')
    s = drop(s, '  if (pendingInput == input + 1) {', '  releaseAction(input);')
    s = drop(s, '  if (input < configKeyCount() && chordPartner[input]) {', '  updateLayer();\n}\n\nvoid actionsRotate')
    s = drop(s, '  if (pendingInput && oneShotReturnLayer != 0xFF) {', '  configBinding(effectiveLayer, input, &first, &second);')
    s = drop(s, '  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {', '  tapNow = now;' if '  tapNow = now;' in s[s.index('void actionsResolveInputs(') if 'void actionsResolveInputs(' in s else s.index('void actionsPoll('):] else '  i = USB_reportGeneration();')
    p.write_text(s)
    p = source / 'src/config.c'
    s = p.read_text()
    s = drop(s, 'static uint8_t pairIndex(', 'uint16_t configCrc(')
    s = s.replace('    uint8_t chords;\n', '')
    s = s.replace('    chords = validationImage[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT;',
                  '    if (validationImage[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT) return 0;')
    s = s.replace(' + (uint8_t)(3 * chords)', '')
    s = drop(s, '    for (i = 0; i < chords; i++) {', '    for (i = 0; i < timers;')
    s = s.replace('    __idata uint8_t previous = 0;\n', '').replace('    __idata uint8_t id;\n', '')
    s = drop(s, 'uint8_t configChordWindowMs(void) {', '// Share the active-image layer')
    s = drop(s, 'FW_BIT configChord(', 'uint8_t configTimedCount(void) {')
    s = s.replace(' + 3 * (activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT)', '')
    p.write_text(s)


def mode_guard(source):
    replace(source, 'src/config.c', '        validationImage[CONFIG_HEADER_VERSION] != CONFIG_VERSION ||',
            '        validationImage[CONFIG_HEADER_VERSION] != CONFIG_VERSION ||\n'
            '        (validationImage[CONFIG_HEADER_POOL] & 1) != CONFIG_ALTERNATE_HOLDS ||')


def shared_threshold(source):
    replace(source, 'src/actions.c', '  return (elapsed >> 5) > (buttonFirst[input] >> 4);',
            '  return (elapsed >> 6) >= (uint8_t)((activeConfig[CONFIG_HEADER_LED] & 7) + 2);')


def counted_pairs(source):
    p = source / 'src/config.c'
    s = p.read_text().replace('    if (validationImage[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT) return 0;', '')
    a = s.index('    // Optional counted pair block follows strings;')
    b = s.index('    offset = 9;', a)
    s = s[:a] + '''    // Chord-count bits become the pair count; strings still precede pairs.
    // end<=128 and 4*count<=124, so the unsigned byte sum cannot wrap.
    validationMacros = (uint8_t)end + (uint8_t)((validationImage[CONFIG_HEADER_COUNTS] >> 3) << 2);
    if (validationMacros > CONFIG_SIZE) return 0;
''' + s[b:]
    s = s.replace('param > (uint8_t)(validationPool + validationUsed)', 'param >= (uint8_t)(validationPool + validationUsed)')
    s = s.replace('    if (offset < validationMacros) offset++; // Skip the optional prefix.\n', '')
    p.write_text(s)


def conditional(chord, hold):
    """Merge whole-line edits; preprocessing yields either complete input exactly."""
    a, b = chord.splitlines(True), hold.splitlines(True)
    out = []
    for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == 'equal':
            out += a[i:j]
        else:
            out += ['#if CONFIG_ALTERNATE_HOLDS\n', *b[k:l]]
            if j > i:
                out += ['#else\n', *a[i:j]]
            out += ['#endif\n']
    return ''.join(out)


def blank(name):
    source = ART / name / 'source'
    if source.exists():
        raise RuntimeError(f'Snapshot already exists: {source}')
    source.mkdir(parents=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    return source


def prepare(name):
    source = blank(name)
    if name == 'baseline':
        return source
    if name == 'unified-chords':
        for filename in FILES:
            shutil.copyfile(ART / 'header-count/source' / filename, source / filename)
        replace(source, 'platformio.ini', '-DCONFIG_ALTERNATE_HOLDS=1', '-DCONFIG_ALTERNATE_HOLDS=0')
        return source
    if name == 'no-chords':
        no_chords(source)
        return source
    if name == 'selectable-chords':
        mode_guard(source)
        replace(source, 'src/config.h', '#define CONFIG_HEADER_SIZE 9',
                '#define CONFIG_ALTERNATE_HOLDS 0\n#define CONFIG_HEADER_SIZE 9')
        return source
    # Use the complete independent wrapper with external timestamps. No previous
    # internal debounce/timestamp relocation or single-pending behavior is inherited.
    subprocess.run(['git', 'apply', '--unsafe-paths', str(ROOT / 'protocol/tap-hold-investigation/complete-small.patch')], cwd=source, check=True)
    no_chords(source)
    mode_guard(source)
    if name in ('shared', 'header-count'):
        shared_threshold(source)
    if name == 'header-count':
        counted_pairs(source)
    # Same source tree builds either mutually exclusive feature. Default stays chords.
    for filename in prior.FIRMWARE:
        chord = (ROOT / filename).read_text()
        if filename == 'src/config.c':
            chord = chord.replace('        validationImage[CONFIG_HEADER_VERSION] != CONFIG_VERSION ||',
                '        validationImage[CONFIG_HEADER_VERSION] != CONFIG_VERSION ||\n'
                '        (validationImage[CONFIG_HEADER_POOL] & 1) != CONFIG_ALTERNATE_HOLDS ||')
        combined = conditional(chord, (source / filename).read_text())
        if filename == 'src/config.h':
            combined = combined.replace('#include <stdint.h>', '''// Experimental mutually exclusive build selector: 0=chords, 1=independent holds.
#ifndef CONFIG_ALTERNATE_HOLDS
#define CONFIG_ALTERNATE_HOLDS 0
#endif
#if CONFIG_ALTERNATE_HOLDS != 0 && CONFIG_ALTERNATE_HOLDS != 1
#error CONFIG_ALTERNATE_HOLDS must be 0 or 1
#endif
#include <stdint.h>''')
        if filename == 'src/actions.h':
            combined = combined.replace('#include <stdint.h>', '#include <stdint.h>\n#include "config.h"')
        (source / filename).write_text(combined)
    with (source / 'platformio.ini').open('a') as f:
        f.write('\n    -DCONFIG_ALTERNATE_HOLDS=1\n')
    return source


def save(name, source):
    patch = []
    for filename in FILES:
        patch += difflib.unified_diff((ROOT / filename).read_text().splitlines(True),
            (source / filename).read_text().splitlines(True), fromfile='a/' + filename, tofile='b/' + filename)
    (HERE / (name + '.patch')).write_text(''.join(patch))
    (HERE / ('source-' + name + '-sha256.json')).write_text(json.dumps({
        f: hashlib.sha256((source / f).read_bytes()).hexdigest() for f in FILES}, indent=2) + '\n')


def main():
    names = sys.argv[1:] or ['baseline', 'no-chords', 'selectable-chords', 'independent', 'shared', 'header-count']
    sources = {name: prepare(name) for name in names}
    for name, source in sources.items():
        save(name, source)
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(prior.build, [(n, s, v) for n, s in sources.items() for v in (0, 1)]))
    destination = HERE / 'results.json'
    if destination.exists():
        rows = [r for r in json.loads(destination.read_text())['rows'] if r['candidate'] not in names] + rows
    destination.write_text(json.dumps({'baseline_revision': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'rows': rows}, indent=2) + '\n')


if __name__ == '__main__':
    main()
