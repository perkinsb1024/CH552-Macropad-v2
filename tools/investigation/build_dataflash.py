"""Build DataFlash capture firmware into a retained temporary artifact directory.

Never uploads firmware, commits source, or generates release files.
"""
import argparse
from configparser import ConfigParser
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--fix-usb-overlap', action='store_true')
    parser.add_argument('--stack-test', action='store_true')
    parser.add_argument('--with-text', action='store_true', help='Try retaining Type text; may exceed flash capacity')
    parser.add_argument('--full-capture', action='store_true', help='Try the detailed capture; may exceed flash capacity')
    args = parser.parse_args()
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(
        prefix='macropad-dataflash-', dir='/private/tmp'))
    if output == ROOT or ROOT in output.parents:
        parser.error('Use an empty artifact directory outside the repository')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error('Artifact directory must be empty')
    source = output / 'source'
    shutil.copytree(ROOT / 'src', source / 'src')
    shutil.copyfile(ROOT / 'CH552_Universal_Macropad.ino', source / 'CH552_Universal_Macropad.ino')
    shutil.copyfile(ROOT / 'pio-platform/build_firmware.py', output / 'target_builder.py')
    shutil.copyfile(ROOT / 'DATAFLASH_DIAGNOSTIC.md', output / 'DATAFLASH_DIAGNOSTIC.md')
    shutil.copyfile(Path(__file__).with_name('parse_dataflash.py'), output / 'parse_dataflash.py')
    settings = ConfigParser()
    settings.read(ROOT / 'platformio.ini')
    build_id = 11 if args.fix_usb_overlap else 10
    flags = ['DATAFLASH_DIAGNOSTICS=1', 'INVESTIGATION_DIAGNOSTICS=0',
             'CONFIG_TIMED_MAX=0',
             f'DIAGNOSTIC_REDUCED={int(not args.full_capture)}',
             f'INVESTIGATION_BUILD_ID={build_id}', 'ENABLE_COLOR_PREVIEW=0',
             f'CONFIG_TYPE_TEXT={int(args.with_text)}',
             f'ENABLE_STACK_TEST={int(args.stack_test)}',
             f'INVESTIGATION_OVERLAP_FIX={int(args.fix_usb_overlap)}']
    original = settings.get('env:ch552', 'build_flags', fallback='')
    settings.set('env:ch552', 'build_flags', original + '\n' + '\n'.join('-D' + f for f in flags))
    with (source / 'platformio.ini').open('w') as file:
        settings.write(file)
    spec = importlib.util.spec_from_file_location('investigation_builder', Path(__file__).with_name('build_firmware.py'))
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    manifest = dict(schema=1, diagnosticSchema=1, buildId=build_id,
                    builtUtc=datetime.now(timezone.utc).isoformat(), flags=flags,
                    baseRevision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                    sourceHashes={str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in source.rglob('*') if p.is_file()},
                    builds=[], hardwareTested=False)
    spec = importlib.util.spec_from_file_location('target_builder', output / 'target_builder.py')
    target_builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(target_builder)
    _, sdcc, _ = target_builder.locations()
    manifest['compilerVersion'] = subprocess.check_output([str(sdcc / 'bin/sdcc'), '--version'], text=True).strip()
    manifest['toolHashes'] = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                             for name in ('target_builder.py', 'parse_dataflash.py', 'DATAFLASH_DIAGNOSTIC.md')}
    print(f'Artifacts: {output}', flush=True)
    try:
        for keys in (6, 3):
            target = output / f'{keys}-key-dataflash'
            with (output / f'{keys}-key-build.log').open('w') as log:
                result = subprocess.run([sys.executable, str(output / 'target_builder.py'), 'build',
                    str(source), str(target), '24000000', '148', '14336', str(int(keys == 3))],
                    stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError(f'{keys}-key build failed; inspect {output / f"{keys}-key-build.log"}')
            record = dict(keys=keys, path=str(target.relative_to(output) / 'firmware.hex'),
                          hexSha256=hashlib.sha256((target / 'firmware.hex').read_bytes()).hexdigest(),
                          **builder.measure(target))
            # Verify the entry shim in linked machine code, not just its source.
            verify_shim(target, builder.symbols(target), reduced=not args.full_capture)
            record['internalSymbols'] = {name: int(address, 16) for address, name in re.findall(
                r'(?m)^\s+([0-9A-F]{8})\s+(_\w+)\s+\w+\s*$', (target / 'firmware.map').read_text())
                if 0x50 <= int(address, 16) <= 0x7B}
            record['entryShimVerified'] = True
            record['stackReduction'] = max(0, (75 if keys == 6 else 78) - record['stackCapacity'])
            manifest['builds'].append(record)
            print(json.dumps(record), flush=True)
    finally:
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Manifest: {output / "manifest.json"}', flush=True)


def verify_shim(target, symbols, reduced=True):
    memory = {}
    for line in (target / 'firmware.hex').read_text().splitlines():
        data = bytes.fromhex(line[1:])
        if data[3] == 0:
            address = int.from_bytes(data[1:3], 'big')
            memory.update({address + i: value for i, value in enumerate(data[4:4 + data[0]])})
    base = symbols['_stagedConfig']
    def dptr(offset):
        return bytes([0x90, (base + offset) >> 8, (base + offset) & 255])
    destination = symbols['_diagnosticCapture']
    expected = (bytes.fromhex('AE 82 AF 83') + dptr(21)
                + bytes.fromhex('E5 D0 F0 A3 E5 A8 C2 AF F0 A3 E5 B8 F0 A3 E5 87 F0')
                + dptr(20) + bytes.fromhex('E5 81 F0'))
    if reduced:
        expected += (bytes.fromhex('78 50') + dptr(60) + bytes.fromhex('79 2C E6 F0 08 A3 D9 FA')
                     + bytes([0x78, symbols['_eventData'] & 255]) + dptr(112)
                     + bytes.fromhex('79 10 E2 F0 08 A3 D9 FA'))
    expected += (bytes([0x78, symbols['_diagnosticReason'] & 255, 0xEE, 0xF2,
                       0x78, symbols['_diagnosticSite'] & 255, 0xEF, 0xF2])
                + bytes([2, destination >> 8, destination & 255]))
    address = symbols['_logDiagnostics']
    actual = bytes(memory[address + i] for i in range(len(expected)))
    if actual != expected:
        raise RuntimeError(f'Linked diagnostic entry shim differs: {actual.hex()}')


if __name__ == '__main__':
    main()
