"""Build v12 stack diagnostics into temporary outputs without generating releases."""
import argparse
from configparser import ConfigParser
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 14336


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(directory):
    text = (directory / 'firmware.mem').read_text()
    symbols = {name: int(value, 16) for value, name in re.findall(
        r'(?m)^\s*(?:[CD]:\s+)?([0-9A-F]{8})\s+([A-Za-z_]\w*)\b',
        (directory / 'firmware.map').read_text())}
    flash = int(re.search(r'ROM/EPROM/FLASH\s+0x\w+\s+0x\w+\s+(\d+)', text)[1])
    return dict(flash=flash, spare=LIMIT-flash, stackBase=symbols['__start__stack'],
                stackCapacity=symbols['l_SSEG'], pagedRam=symbols['l_PSEG'],
                externalRam=symbols['l_XSEG'], activeImage=symbols['_activeConfig'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-preview', action='store_true',
                        help='Omit live color preview in diagnostic/control builds (explicitly approved for this investigation)')
    parser.add_argument('--output', type=Path, help='Artifact directory; default is a retained temporary directory')
    args = parser.parse_args()
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='macropad-v12-stack-'))
    if output == ROOT or ROOT / 'releases' == output or ROOT / 'releases' in output.parents:
        parser.error('Use a dedicated temporary build directory')
    output.mkdir(parents=True, exist_ok=True)
    source = output / 'source'
    source.mkdir(exist_ok=True)
    shutil.copytree(ROOT / 'src', source / 'src', dirs_exist_ok=True)
    shutil.copyfile(ROOT / 'CH552_Universal_Macropad.ino', source / 'CH552_Universal_Macropad.ino')
    shutil.copyfile(ROOT / 'platformio.ini', source / 'original-platformio.ini')
    for file in ['build-stack-firmware.py', 'read-stack.html', 'reader.mjs', 'upload-stack-firmware.py']:
        shutil.copyfile(ROOT / 'Stack Test' / file, output / file)
    shutil.copyfile(ROOT / 'pio-platform/build_firmware.py', output / 'build_firmware.py')
    shutil.copyfile(ROOT / 'tests/stack_test_firmware.py', output / 'stack_test_firmware.py')
    manifest = dict(builtUtc=datetime.now(timezone.utc).isoformat(), formatVersion=12,
        baseRevision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        gitStatus=subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True),
        diagnosticOpcode=0x70, pattern=0xa5, codeLimit=LIMIT,
        disabledFeatures=['live color preview'] if args.no_preview else [],
        files={}, measurements=[])
    manifest['sourceHashes'] = {str(path.relative_to(source)): sha256(path)
        for path in sorted(source.rglob('*')) if path.is_file()}
    production_flags = ConfigParser()
    production_flags.read(ROOT / 'platformio.ini')
    original = production_flags.get('env:ch552', 'build_flags', fallback='')
    manifest['originalBuildFlags'] = original
    manifest['compilerVersion'] = subprocess.check_output([
        str(Path.home() / 'Library/Arduino15/packages/CH55xDuino/tools/sdcc/build.13407_4/bin/sdcc'),
        '--version'], text=True).strip()
    manifest_path = output / 'firmware-build.json'
    print(f'Artifacts: {output}', flush=True)
    try:
        for variant, keys in [(0, 6), (1, 3)]:
            stages = [('production', ''), ('control', '\n-DENABLE_COLOR_PREVIEW=0' if args.no_preview else '')]
            stages.append(('diagnostic', stages[-1][1] + '\n-DENABLE_STACK_TEST=1'))
            measurements = {}
            for stage, extra in stages:
                settings = ConfigParser()
                settings.read(ROOT / 'platformio.ini')
                settings.set('env:ch552', 'build_flags', original + extra)
                with (source / 'platformio.ini').open('w') as file:
                    settings.write(file)
                build = output / f'{keys}-key-{stage}'
                log = output / f'{keys}-key-{stage}.log'
                with log.open('w') as file:
                    result = subprocess.run([sys.executable, str(output / 'build_firmware.py'), 'build',
                        str(source), str(build), '24000000', '148', str(LIMIT), str(variant)],
                        stdout=file, stderr=subprocess.STDOUT)
                if result.returncode:
                    print(log.read_text()[-2500:], file=sys.stderr)
                    raise RuntimeError(f'{keys}-key {stage} failed; see {log}')
                measurements[stage] = measure(build)
                manifest['measurements'].append(dict(keys=keys, stage=stage, flags=original+extra, **measurements[stage]))
                print(f'{keys}-key {stage}: {measurements[stage]}', flush=True)
            with (output / f'{keys}-key-linked-check.log').open('w') as file:
                subprocess.run([sys.executable, str(output / 'stack_test_firmware.py'),
                    str(output / f'{keys}-key-diagnostic'), '--baseline', str(output / f'{keys}-key-control')],
                    stdout=file, stderr=subprocess.STDOUT, check=True)
            print((output / f'{keys}-key-linked-check.log').read_text().strip(), flush=True)
            for field in ['stackBase', 'stackCapacity', 'pagedRam', 'externalRam', 'activeImage']:
                if measurements['diagnostic'][field] != measurements['production'][field]:
                    raise RuntimeError(f'Diagnostic changed {field} relative to production')
            for suffix in ['hex', 'map', 'mem']:
                target = output / f'{keys}-key-stack-test-firmware.{suffix}'
                shutil.copyfile(output / f'{keys}-key-diagnostic/firmware.{suffix}', target)
                manifest['files'][target.name] = sha256(target)
        manifest['verified'] = True
    finally:
        manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
    print(f'Verified manifest: {manifest_path}', flush=True)


if __name__ == '__main__':
    main()
