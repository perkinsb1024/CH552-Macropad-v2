"""Host and strict sanitizer checks on an isolated saved snapshot."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ART = Path('/private/tmp/macropad-tap-hold')
FLAGS = ['cc', '-std=c99', '-O1', '-g', '-Wall', '-Wextra', '-Wno-unknown-pragmas',
         '-Wno-bitwise-op-parentheses', '-Wno-pointer-to-int-cast',
         '-D__data=', '-D__idata=', '-D__pdata=', '-D__xdata=', '-D__code=',
         '-Itests/stubs', '-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552',
         '-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino']

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'ram'
    source = ART / name / 'source'
    shutil.copyfile(HERE / 'tap_hold_test.c', source / 'tests/tap_hold_test.c')
    shutil.copyfile(HERE / 'tap_hold_integration_test.c', source / 'tests/tap_hold_integration_test.c')
    runner = source / 'tests/run_host_tests.py'
    content = runner.read_text()
    addition = '    suites += [("tap_hold", ["src/config.c", "src/actions.c"], variant) for variant in (0, 1)]\n'
    addition += '    suites += [("tap_hold_integration", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n'
    if addition not in content:
        runner.write_text(content.replace('    for suite in suites:', addition + '    for suite in suites:'))
    rows = []
    suites = ['tap_hold', 'tap_hold_integration']
    if name.endswith('combined'): suites.append('input_layer')
    for suite in suites:
        for variant in (0, 1):
            binary = ART / name / (suite + '-' + str(variant))
            command = [*FLAGS, '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                       '-fno-sanitize-recover=all', '-DPHYSICAL_VARIANT=' + str(variant),
                       'tests/' + suite + '_test.c', 'src/config.c', 'src/actions.c']
            if suite != 'tap_hold':
                command += ['src/storage.c', 'src/protocol_firmware.c']
            if name.endswith('combined'): command += ['-DTAP_HOLD_COMBINED=1']
            command += ['-o', str(binary)]
            result = subprocess.run(command, cwd=source, capture_output=True, text=True)
            if not result.returncode:
                result = subprocess.run([str(binary)], cwd=source, capture_output=True, text=True)
            print(name, suite, variant, result.returncode, result.stdout[-2000:], result.stderr[-2500:], flush=True)
            rows.append(dict(suite=suite + '-asan-ubsan', variant=variant, returncode=result.returncode,
                             output=result.stdout, error=result.stderr[-5000:]))
            if result.returncode: break
        if rows[-1]['returncode']: break
    if not any(r['returncode'] for r in rows) and '--focused' not in sys.argv:
        result = subprocess.run([sys.executable, 'tests/run_host_tests.py'], cwd=source,
                                capture_output=True, text=True)
        print(name, 'host', result.returncode, result.stdout[-3500:], result.stderr[-2000:], flush=True)
        rows.append(dict(suite='normal-host-runner', returncode=result.returncode,
                         output=result.stdout, error=result.stderr[-4000:]))
    suffix = '-focused' if '--focused' in sys.argv else ''
    (HERE / ('validation-' + name + suffix + '.json')).write_text(json.dumps(rows, indent=2) + '\n')
    (HERE / ('validated-' + name + '-sha256.json')).write_text(json.dumps({
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source.rglob('*')) if p.is_file() and '__pycache__' not in p.parts
        and 'webUploader' not in p.parts}, indent=2) + '\n')
    if any(r['returncode'] for r in rows): sys.exit(1)

if __name__ == '__main__': main()
