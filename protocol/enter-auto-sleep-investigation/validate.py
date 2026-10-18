"""Validate saved candidate snapshots with host regressions and entry tests."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = Path(__file__).resolve().parent
ARTIFACTS = Path('/private/tmp/macropad-enter-auto-sleep')
FLAGS = ['cc', '-std=c99', '-Wall', '-Wextra', '-Wno-unknown-pragmas',
         '-Wno-bitwise-op-parentheses', '-Wno-pointer-to-int-cast',
         '-D__data=', '-D__idata=', '-D__pdata=', '-D__xdata=', '-D__code=',
         '-Itests/stubs', '-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552',
         '-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino']


def check(name):
    source = ARTIFACTS / name / 'source'
    output = ARTIFACTS / name
    shutil.copyfile(HERE / 'enter_sleep_test.c', source / 'tests/enter_sleep_test.c')
    rows = []
    for variant in (0, 1):
        binary = output / ('entry-' + str(variant))
        command = [*FLAGS, '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                   '-fno-sanitize-recover=all',
                   '-DPHYSICAL_VARIANT=' + str(variant),
                   '-DENTER_SLEEP_ENABLED_ONLY=' + str(int(name == 'enabled-only')),
                   'tests/enter_sleep_test.c', 'src/config.c', 'src/actions.c', '-o', str(binary)]
        result = subprocess.run(command, cwd=source, capture_output=True, text=True)
        if not result.returncode:
            result = subprocess.run([str(binary)], cwd=source, capture_output=True, text=True)
        (output / ('entry-' + str(variant) + '.log')).write_text(result.stdout + result.stderr)
        print(name, variant, result.returncode, result.stdout[-3000:], result.stderr[-3000:], flush=True)
        rows.append(dict(suite='enter-sleep-asan-ubsan', variant=variant, returncode=result.returncode))
        if result.returncode:
            return rows
    if '--entry-only' not in sys.argv:
        result = subprocess.run([sys.executable, 'tests/run_host_tests.py'], cwd=source,
                                capture_output=True, text=True)
        (output / 'host-tests.log').write_text(result.stdout + result.stderr)
        rows.append(dict(suite='normal-host-runner', returncode=result.returncode))
        print(name, 'host', result.returncode, result.stdout[-1500:], result.stderr[-1500:], flush=True)
    (HERE / ('validated-' + name + '-sha256.json')).write_text(json.dumps({
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source.rglob('*')) if p.is_file()
        and '__pycache__' not in p.parts and 'webUploader' not in p.parts}, indent=2) + '\n')
    return rows


def main():
    names = [arg for arg in sys.argv[1:] if not arg.startswith('--')] or ['any-layer', 'enabled-only']
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = dict(zip(names, pool.map(check, names)))
    (HERE / ('validation-entry.json' if '--entry-only' in sys.argv else 'validation.json')).write_text(
        json.dumps(rows, indent=2) + '\n')
    if any(row['returncode'] for suites in rows.values() for row in suites):
        sys.exit(1)


if __name__ == '__main__':
    main()
