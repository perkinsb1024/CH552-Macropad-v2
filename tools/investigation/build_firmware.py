"""Build matched fault-investigation variants; never upload or generate releases."""
import argparse
from configparser import ConfigParser
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 14336


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def symbols(build):
    return {name: int(value, 16) for value, name in re.findall(
        r'(?m)^\s*(?:[CD]:\s+)?([0-9A-F]{8})\s+([A-Za-z_]\w*)\b',
        (build / 'firmware.map').read_text())}


def measure(build):
    names = symbols(build)
    memory = (build / 'firmware.mem').read_text()
    flash = int(re.search(r'ROM/EPROM/FLASH\s+0x\w+\s+0x\w+\s+(\d+)', memory)[1])
    return dict(flash=flash, spare=LIMIT - flash,
                stackBase=names['__start__stack'], stackCapacity=names['l_SSEG'],
                pagedRam=names['l_PSEG'], externalRam=names['l_XSEG'],
                overlayBase=names['s_OSEG'], overlaySize=names['l_OSEG'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='macropad-fault-'))
    # Never mix artifacts with tracked source or overwrite a previous run.
    if output == ROOT or ROOT in output.parents:
        parser.error('Use an artifact directory outside the repository')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error('Artifact directory must be empty')
    source = output / 'source'
    shutil.copytree(ROOT / 'src', source / 'src')
    shutil.copyfile(ROOT / 'CH552_Universal_Macropad.ino', source / 'CH552_Universal_Macropad.ino')
    shutil.copyfile(ROOT / 'platformio.ini', source / 'original-platformio.ini')
    shutil.copyfile(ROOT / 'pio-platform/build_firmware.py', output / 'target_builder.py')
    shutil.copytree(Path(__file__).parent, output / 'tools', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT / 'tests', output / 'tests', ignore=shutil.ignore_patterns('__pycache__'))
    settings = ConfigParser()
    settings.read(ROOT / 'platformio.ini')
    original = settings.get('env:ch552', 'build_flags', fallback='')
    spec = importlib.util.spec_from_file_location('target_builder', output / 'target_builder.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _, sdcc, _ = module.locations()
    manifest = dict(schema=1, builtUtc=datetime.now(timezone.utc).isoformat(),
                    baseRevision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                    gitStatus=subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True),
                    compilerVersion=subprocess.check_output([str(sdcc / 'bin/sdcc'), '--version'], text=True).strip(),
                    codeLimit=LIMIT, diagnosticOpcode=0x71, verified=False,
                    verificationScope='Linked layout, HEX/listing agreement and parameter-fragment replay; no hardware testing',
                    builds=[], attempts=[], sourceHashes={str(p.relative_to(source)): digest(p)
                        for p in source.rglob('*') if p.is_file()})
    (output / 'working-tree.patch').write_text(subprocess.check_output(['git', 'diff', 'HEAD'], cwd=ROOT, text=True))
    print(f'Artifacts: {output}', flush=True)

    def build(keys, stage, flags):
        settings.set('env:ch552', 'build_flags', original + '\n' + '\n'.join('-D' + f for f in flags))
        with (source / 'platformio.ini').open('w') as file:
            settings.write(file)
        target = output / f'{keys}-key-{stage}'
        with (output / f'{keys}-key-{stage}.log').open('w') as log:
            result = subprocess.run([sys.executable, str(output / 'target_builder.py'), 'build',
                str(source), str(target), '24000000', '148', str(LIMIT), str(int(keys == 3))],
                stdout=log, stderr=subprocess.STDOUT)
        record = dict(keys=keys, stage=stage, flags=flags, returncode=result.returncode)
        if (target / 'firmware.mem').exists() and (target / 'firmware.map').exists():
            record.update(measure(target))
        manifest['attempts'].append(record)
        if result.returncode:
            # Only application-size failures justify automatic feature cuts.
            log_text = (output / f'{keys}-key-{stage}.log').read_text()
            if record.get('spare', 0) >= 0 or 'Insufficient ROM/EPROM/FLASH memory' not in log_text:
                raise RuntimeError(f'Build failed for a reason other than flash capacity: {target}; see log')
            print(f'{keys}-key {stage}: rejected ({record.get("flash")} bytes)', flush=True)
            return None
        record['hexSha256'] = digest(target / 'firmware.hex')
        print(f'{keys}-key {stage}: {record}', flush=True)
        return record

    try:
        for keys in (6, 3):
            baseline = build(keys, 'production', ['ENABLE_STACK_TEST=0'])
            if baseline is None:
                raise RuntimeError('Unmodified production baseline does not fit')
            manifest['builds'].append(baseline)
            corrected = build(keys, 'corrected-production', ['ENABLE_STACK_TEST=0', 'INVESTIGATION_OVERLAP_FIX=1'])
            if corrected:
                manifest['builds'].append(corrected)
        common = ['ENABLE_STACK_TEST=0', 'ENABLE_COLOR_PREVIEW=0', 'INVESTIGATION_DIAGNOSTICS=1']
        # Matched pairs have exactly the same approved feature reductions.
        # Start with preview off, then use E (text) if necessary. Stop for review
        # rather than silently implementing larger cuts.
        for cut in ([], ['CONFIG_TYPE_TEXT=0']):
            pairs = []
            fits = True
            suffix = 'no-text' if cut else 'preview-off'
            for keys in (6, 3):
                for fixed in (False, True):
                    stage = f'diagnostic-{"fixed" if fixed else "overlap"}-{suffix}'
                    record = build(keys, stage, common + cut + [
                        f'INVESTIGATION_OVERLAP_FIX={int(fixed)}', f'INVESTIGATION_BUILD_ID={2 if fixed else 1}'])
                    fits &= record is not None
                    if record:
                        pairs.append(record)
            if fits:
                manifest['builds'].extend(pairs)
                manifest['disabledFeatures'] = ['live color preview'] + (['Type text'] if cut else [])
                manifest['selectedImages'] = {f'{r["keys"]}-key-{"fixed" if "fixed" in r["stage"] else "overlap"}':
                    dict(path=f'{r["keys"]}-key-{r["stage"]}/firmware.hex', sha256=r['hexSha256']) for r in pairs}
                for record in pairs:
                    build_dir = output / f'{record["keys"]}-key-{record["stage"]}'
                    baseline_dir = output / f'{record["keys"]}-key-production'
                    subprocess.run([sys.executable, str(output / 'tools/verify_linked.py'),
                        str(build_dir), '--baseline', str(baseline_dir),
                        '--fixed' if 'fixed' in record['stage'] else '--overlap'], check=True)
                manifest['verified'] = True
                break
        if not manifest['verified']:
            raise RuntimeError('Further approved cuts need implementation; no matched pair fits yet')
    finally:
        manifest['artifactHashes'] = {str(p.relative_to(output)): digest(p)
            for p in output.rglob('*') if p.is_file() and p.name in ('firmware.hex', 'firmware.map', 'firmware.mem')}
        manifest['toolHashes'] = {str(p.relative_to(output)): digest(p)
            for p in (output / 'tools').rglob('*') if p.is_file()}
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Verified manifest: {output / "manifest.json"}', flush=True)


if __name__ == '__main__':
    main()
