"""Preserve exact patches, tested source archives and baseline-relative evidence."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ART = Path('/private/tmp/macropad-tap-hold-no-chords')
spec = importlib.util.spec_from_file_location('measure', HERE / 'measure.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    rows = json.loads((HERE / 'results.json').read_text())['rows']
    table = ['# Native Measurement Ledger\n\n',
        'Six-/three-key values are separate rows. All sizes are bytes. Every real 14336-byte link and native layout check passes.\n\n',
        '| Candidate | Board | Flash | Delta from Baseline | Free Flash | Stack | PSEG | XSEG | Total External RAM |\n',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n']
    for r in rows:
        assert r['real_limit_returncode'] == 0 and r['layout_checks'] == 'passed'
        base = 14201 if r['variant'] else 14205
        table.append(f"| {r['candidate']} | {3 if r['variant'] else 6} | {r['flash']} | {r['flash']-base:+} | {r['free']} | {r['stack']} | {r['paged']} | {r['external']} | {r['paged']+r['external']+148+134} |\n")
    (HERE / 'candidate-table.md').write_text(''.join(table))
    verified = []
    archives = []
    for candidate, test_name in [('header-count', 'header-count'), ('independent', 'independent'), ('unified-chords', 'chords')]:
        validation = json.loads((HERE / ('validation-' + test_name + '.json')).read_text())
        assert all(r['returncode'] == 0 for r in validation['rows'])
        measured = ART / candidate / 'source'
        tested = ART / ('validation-' + test_name) / 'source'
        for filename in m.prior.FIRMWARE:
            assert digest(measured / filename) == digest(tested / filename), filename
        reapplied = m.blank('reapplication-' + candidate)
        for patch in [candidate + '.patch', test_name + '-tests.patch']:
            subprocess.run(['git', 'apply', '--unsafe-paths', str(HERE / patch)], cwd=reapplied, check=True)
        for filename in m.FILES:
            assert digest(reapplied / filename) == digest(measured / filename), filename
        for p in (tested / 'tests').glob('*'):
            if p.is_file() and p.suffix in ('.c', '.h', '.py'):
                assert digest(p) == digest(reapplied / 'tests' / p.name), p.name
        verified.append(dict(candidate=candidate, tests=test_name, exact_reapplication=True))
        archive = HERE / (candidate + '-tested-sources.tar.gz')
        with tarfile.open(archive, 'w:gz') as tar:
            for p in sorted(reapplied.rglob('*')):
                if not p.is_file() or '__pycache__' in p.parts or 'webUploader' in p.parts or p.name == '.DS_Store':
                    continue
                tar.add(p, arcname=str(p.relative_to(reapplied)), recursive=False)
        archives.append(dict(file=archive.name, sha256=digest(archive)))
    (HERE / 'reapplication.json').write_text(json.dumps(verified, indent=2) + '\n')
    (HERE / 'archives.json').write_text(json.dumps(archives, indent=2) + '\n')
    unchanged = {f: digest(ROOT / f) == digest(ART / 'baseline/source' / f) for f in m.FILES}
    assert all(unchanged.values())
    assert not subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).strip()
    (HERE / 'active-firmware-unchanged.json').write_text(json.dumps(unchanged, indent=2) + '\n')
    (HERE / 'artifact-sha256.json').write_text(json.dumps({p.name:digest(p) for p in sorted(HERE.iterdir())
        if p.is_file() and p.name != 'artifact-sha256.json'}, indent=2) + '\n')
    print('Exact firmware/test reapplication, tested archives and unchanged active inputs verified.')


if __name__ == '__main__':
    main()
