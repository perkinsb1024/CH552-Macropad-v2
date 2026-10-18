"""Validate saved HID layer snapshots, including real-sketch ASan/UBSan coverage."""
from pathlib import Path
import difflib
import hashlib
import json
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ARTIFACTS = Path('/private/tmp/macropad-hid-layer')
FLAGS = ['cc', '-std=c99', '-Wall', '-Wextra', '-Wno-unknown-pragmas',
         '-Wno-bitwise-op-parentheses', '-Wno-pointer-to-int-cast',
         '-D__data=', '-D__idata=', '-D__pdata=', '-D__xdata=', '-D__code=',
         '-Itests/stubs', '-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552',
         '-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino']


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'shared-reset-wake'
    source = ARTIFACTS / name / 'source'
    shutil.copyfile(HERE / 'hid_layer_test.c', source / 'tests/hid_layer_test.c')
    input_mode = 'input' in name
    if input_mode:
        content = (HERE / 'input_layer_test.c').read_text()
        if not name.startswith('optional-'):
            content = content.replace('#define HID_LAYER_OPTIONAL 1', '#define HID_LAYER_OPTIONAL 0')
        (source / 'tests/input_layer_test.c').write_text(content)
        runner = (source / 'tests/run_host_tests.py').read_text()
        addition = '    suites += [("input_layer", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n'
        if addition not in runner:
            runner = runner.replace('    for suite in suites:', addition + '    for suite in suites:')
            (source / 'tests/run_host_tests.py').write_text(runner)
    rows = []
    for variant in (0, 1):
        binary = ARTIFACTS / name / ('hid-layer-' + str(variant))
        command = [*FLAGS, '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                   '-fno-sanitize-recover=all', '-DPHYSICAL_VARIANT=' + str(variant),
                   *(['-DHID_LAYER_OPTIONAL=' + str(int(name.startswith('optional-')))] if input_mode else []),
                   'tests/' + ('input_layer_test.c' if input_mode else 'hid_layer_test.c'), 'src/config.c', 'src/actions.c',
                   'src/storage.c', 'src/protocol_firmware.c', '-o', str(binary)]
        result = subprocess.run(command, cwd=source, capture_output=True, text=True)
        if not result.returncode:
            result = subprocess.run([str(binary)], cwd=source, capture_output=True, text=True)
        print(name, variant, result.returncode, result.stdout[-2000:], result.stderr[-3000:], flush=True)
        rows.append(dict(suite='hid-layer-asan-ubsan', variant=variant,
                         returncode=result.returncode, output=result.stdout, error=result.stderr[-3000:]))
        if result.returncode:
            break
    if not any(r['returncode'] for r in rows) and '--focused' not in sys.argv:
        result = subprocess.run([sys.executable, 'tests/run_host_tests.py'], cwd=source,
                                capture_output=True, text=True)
        print(name, 'host', result.returncode, result.stdout[-3000:], result.stderr[-2000:], flush=True)
        rows.append(dict(suite='normal-host-runner', returncode=result.returncode,
                         output=result.stdout, error=result.stderr[-2000:]))
    suffix = '-focused' if '--focused' in sys.argv else ''
    (HERE / ('validation-' + name + suffix + '.json')).write_text(json.dumps(rows, indent=2) + '\n')
    (HERE / ('validated-' + name + '-sha256.json')).write_text(json.dumps({
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source.rglob('*')) if p.is_file()
        and '__pycache__' not in p.parts and 'webUploader' not in p.parts}, indent=2) + '\n')
    patch = list(difflib.unified_diff((ROOT / 'tests/protocol_test.c').read_text().splitlines(True),
                  (source / 'tests/protocol_test.c').read_text().splitlines(True),
                  fromfile='a/tests/protocol_test.c', tofile='b/tests/protocol_test.c'))
    if input_mode:
        patch.extend(difflib.unified_diff((ROOT / 'tests/run_host_tests.py').read_text().splitlines(True),
                     (source / 'tests/run_host_tests.py').read_text().splitlines(True),
                     fromfile='a/tests/run_host_tests.py', tofile='b/tests/run_host_tests.py'))
    for filename in ['hid_layer_test.c'] + (['input_layer_test.c'] if input_mode else []):
        patch.extend(difflib.unified_diff([], (source / 'tests' / filename).read_text().splitlines(True),
                     fromfile='/dev/null', tofile='b/tests/' + filename))
    (HERE / (name + '-tests.patch')).write_text(''.join(patch))
    if any(row['returncode'] for row in rows):
        sys.exit(1)


if __name__ == '__main__':
    main()
