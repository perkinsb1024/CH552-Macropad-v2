"""Validate saved sources without editing active firmware or baseline tests."""
from pathlib import Path
import difflib
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ART = Path('/private/tmp/macropad-tap-hold-no-chords')
OLD = ROOT / 'protocol/tap-hold-alternatives'
spec = importlib.util.spec_from_file_location('old_validation', ROOT / 'protocol/tap-hold-investigation/validate.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
FLAGS = old.FLAGS


def adapt(source, name):
    holds = name != 'chords'
    # Fixture writers retain the mode bit through pool-length updates.
    for p in (source / 'tests').glob('*.[ch]'):
        p.write_text((ROOT / 'tests' / p.name).read_text())
    p = source / 'tests/config_fixture.h'
    s = p.read_text().replace('    activeConfig[CONFIG_HEADER_LAYERS] = (activeConfig[CONFIG_HEADER_LAYERS] & ~1) | variant;',
        '    activeConfig[CONFIG_HEADER_LAYERS] = (activeConfig[CONFIG_HEADER_LAYERS] & ~1) | variant;\n'
        '    activeConfig[CONFIG_HEADER_POOL] = (activeConfig[CONFIG_HEADER_POOL] & ~1) | CONFIG_ALTERNATE_HOLDS;')
    s = s.replace('activeConfig[CONFIG_HEADER_POOL] = length << 1;',
                  'activeConfig[CONFIG_HEADER_POOL] = (length << 1) | CONFIG_ALTERNATE_HOLDS;')
    p.write_text(s)
    p = source / 'tests/header_repacking_test.c'
    s = p.read_text().replace('    activeConfig[3] |= 1; seal(activeConfig);\n    assert(configValid(activeConfig, PHYSICAL_VARIANT));',
        '    activeConfig[3] ^= 1; seal(activeConfig);\n    assert(!configValid(activeConfig, PHYSICAL_VARIANT));')
    p.write_text(s)
    p = source / 'tests/per_key_palette_test.c'
    s = p.read_text().replace('        activeConfig[3] |= (bits >> 1) & 1;',
                             '        activeConfig[3] ^= (bits >> 1) & 1;')
    s = s.replace('        sealImage();\n        assert(configValid(activeConfig, PHYSICAL_VARIANT));\n        firmwareApplyConfig(1);',
        '        sealImage();\n        assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == !(bits & 2));\n'
        '        activeConfig[3] = (activeConfig[3] & ~1) | CONFIG_ALTERNATE_HOLDS;\n'
        '        sealImage();\n        firmwareApplyConfig(1);')
    p.write_text(s)
    if not holds:
        return []
    skipped = []
    # Existing mixed test functions assume chord behavior. Omit their calls in
    # holds mode and record every omitted function, rather than changing assertions.
    # Focused tests below independently cover the changed scanner/runtime/encoding.
    for filename in ('actions_test.c', 'macros_test.c', 'layer_encoding_test.c',
                     'input_test.c', 'live_state_test.c', 'per_key_palette_test.c'):
        p = source / 'tests' / filename
        s = p.read_text()
        matches = list(re.finditer(r'^static (?:void|uint\w+_t) (\w+)\([^\n]*\)\s*\{', s, re.M))
        omit = []
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else s.index('int main(', m.start())
            body = s[m.end():end]
            if re.search(r'chord', body, re.I) or 'Chord' in m[1]:
                omit.append(m[1])
        for function in omit:
            # Replace only invocation statements, never the declaration.
            s = re.sub(r'(?<![\w])' + function + r'\(([^;{}]*)\);',
                       '/* Chord-dependent regression omitted in holds mode. */', s)
            skipped.append(filename + ':' + function)
        p.write_text(s)
    # The modified hold suite has one chord-only section inside an otherwise
    # useful lifecycle test; retain the surrounding output/backpressure checks.
    p = source / 'tests/modified_hold_test.c'
    s = p.read_text()
    a = s.index('    // Either chord member releases the composite output.')
    b = s.index('    // A report-generation change', a)
    p.write_text(s[:a] + s[b:])
    skipped.append('modified_hold_test.c:testHoldLifecycle chord-only section')
    for p in (source / 'tests').glob('*.[ch]'):
        s = p.read_text()
        s = re.sub(r'actionsRelease\(([^();,]+)\)', r'actionsRelease(\1, 0)', s)
        s = s.replace('sent[22] == 0x7F', 'sent[22] == 0xFF')
        # Uncalled original harness helpers must not refer to removed native APIs.
        s = re.sub(r'^.*assert\(configChordWindowMs\(\).*\n', '', s, flags=re.M)
        if p.name == 'per_key_palette_test.c':
            s = re.sub(r'^.*assert\(configChord\(.*\n', '', s, flags=re.M)
        p.write_text(s)
    return skipped


def focused(source, name):
    fixture = (OLD / 'fixture.h').read_text()
    if name == 'header-count':
        fixture = fixture.replace('recordStart=poolStart+strings+(assignmentCount?1:0);',
                                  'recordStart=poolStart+strings;')
        fixture = fixture.replace('if(assignmentCount)activeConfig[poolStart+strings]=((assignmentCount-1)<<4)|15;',
                                  'activeConfig[CONFIG_HEADER_COUNTS]=(activeConfig[CONFIG_HEADER_COUNTS]&7)|(assignmentCount<<3);')
    if name in ('shared', 'header-count'):
        fixture = fixture.replace('    assignmentCount=0;', '    assignmentCount=0;')
        fixture = fixture.replace('    testSetStringLength(strings);',
            '    if(assignmentCount) activeConfig[CONFIG_HEADER_LED]=(activeConfig[CONFIG_HEADER_LED]&~7)|(assignments[0].selector&7);\n'
            '    testSetStringLength(strings);')
        fixture = fixture.replace('    return 32*(assignments[assignment].selector+1);',
            '    (void)assignment; return 64*((activeConfig[CONFIG_HEADER_LED]&7)+2);')
    (source / 'tests/alternative_fixture.h').write_text(fixture)
    s = (OLD / 'alternatives_test.c').read_text().replace(', pendingInput;', ';')
    s = s.replace('testChords();testRotationAndPendingOverlap();', '')
    a = s.index('static void testChords(void)')
    b = s.index('static void testLayersAndOutputs(void)', a)
    s = s[:a] + s[b:]
    a = s.index(' thInit(2,0,1);ledAssignment(0,2);thFinish(0);uint8_t c=configLayerPaletteOffset(2);')
    b = s.index(' for(uint8_t aux=0;', a)
    s = s[:a] + ' thInit(2,0,0);ledAssignment(0,2);thFinish(0);\n' + s[b:]
    s = s.replace('  activeConfig[c+1]=0;activeConfig[c+2]=0;\n', '')
    s = s.replace('int main(void){testThresholds();', 'int main(void){testExclusiveMode();testThresholds();')
    extra = (HERE / 'exclusive_test.inc').read_text()
    s = s.replace('int main(void)', extra + '\nint main(void)')
    (source / 'tests/alternatives_test.c').write_text(s)
    s = (OLD / 'integration_test.c').read_text()
    a = s.index(" // Both orders of the user's button-1 hold")
    b = s.index('\n}\nstatic void testWakeTimersReset', a)
    s = s[:a] + s[b:]
    (source / 'tests/alternative_integration_test.c').write_text(s)


def run(source, label, command):
    result = subprocess.run(command, cwd=source, capture_output=True, text=True)
    print(label, result.returncode, result.stdout[-2000:], result.stderr[-1800:] if result.returncode else '', flush=True)
    return dict(suite=label, returncode=result.returncode, output=result.stdout, error=result.stderr[-8000:])


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'header-count'
    source = ART / ('header-count' if name == 'chords' else name) / 'source'
    # Chord and hold validation use separate test copies of identical firmware.
    test_source = ART / ('validation-' + name) / 'source'
    if test_source.exists():
        test_source.rename(test_source.with_name('source-before-' + str(time.time_ns())))
    shutil.copytree(source, test_source, symlinks=True)
    source = test_source
    skipped = adapt(source, name)
    rows = []
    if name == 'chords':
        rows.append(run(source, 'complete-chord-regressions', [sys.executable, 'tests/run_host_tests.py']))
    else:
        focused(source, name)
        for suite in ('alternatives', 'alternative_integration', 'actions', 'protocol', 'modified_hold',
                      'layer_encoding', 'macros', 'timed_actions', 'timed_capacity',
                      'input', 'sleep_integration', 'live_state', 'per_key_palette', 'usb'):
            # The original actions suite intentionally mixes both header geometries
            # in one process and normally runs with the default seven-entry build.
            # A four-entry compile cannot accept its injected six-key profiles.
            for variant in ((0,) if suite == 'actions' else (0, 1)):
                sources = [] if suite == 'usb' else ['src/config.c']
                if suite not in ('usb', 'protocol'):
                    sources += ['src/actions.c']
                if suite in ('alternative_integration', 'protocol', 'sleep_integration', 'live_state'):
                    sources += ['src/storage.c', 'src/protocol_firmware.c']
                binary = ART / ('validation-' + name) / (suite + '-' + str(variant))
                sanitized = suite not in ('input', 'sleep_integration', 'live_state', 'per_key_palette')
                sanitizer_flags = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-fno-sanitize-recover=all'] if sanitized else []
                command = [*FLAGS, '-DCONFIG_ALTERNATE_HOLDS=1', '-DPHYSICAL_VARIANT=' + str(variant),
                    *sanitizer_flags, 'tests/' + suite + '_test.c', *sources, '-o', str(binary)]
                if name == 'header-count':
                    command.insert(1, '-DTEST_HEADER_COUNT=1')
                result = run(source, suite + '-compile-' + str(variant), command)
                if result['returncode']:
                    rows.append(result)
                    break
                rows.append(run(source, suite + ('-asan-ubsan-' if sanitized else '-normal-') + str(variant), [str(binary)]))
                if rows[-1]['returncode']:
                    break
            if rows[-1]['returncode']:
                break
    (HERE / ('validation-' + name + '.json')).write_text(json.dumps({'rows': rows, 'omitted_chord_dependent_cases': skipped}, indent=2) + '\n')
    patch = []
    for p in sorted((source / 'tests').glob('*')):
        if not p.is_file() or p.suffix not in ('.c', '.h', '.py'):
            continue
        original = ROOT / 'tests' / p.name
        patch += difflib.unified_diff(original.read_text().splitlines(True) if original.exists() else [],
            p.read_text().splitlines(True), fromfile='a/tests/' + p.name if original.exists() else '/dev/null',
            tofile='b/tests/' + p.name)
    (HERE / (name + '-tests.patch')).write_text(''.join(patch))
    (HERE / ('validation-source-' + name + '-sha256.json')).write_text(json.dumps({
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source.rglob('*')) if p.is_file() and 'webUploader' not in p.parts and '__pycache__' not in p.parts}, indent=2) + '\n')
    if any(r['returncode'] for r in rows):
        sys.exit(1)


if __name__ == '__main__':
    main()
