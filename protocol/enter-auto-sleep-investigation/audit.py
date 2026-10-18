"""Check saved evidence, active-source preservation and independent patch application."""
from pathlib import Path
import hashlib
import json
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ARTIFACTS = Path('/private/tmp/macropad-enter-auto-sleep')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    baseline = json.loads((HERE / 'source-baseline-sha256.json').read_text())
    for filename, expected in baseline.items():
        assert digest(ROOT / filename) == expected, ('Active baseline changed', filename)
    builds = json.loads((HERE / 'results.json').read_text())
    for row in builds['rows']:
        native = Path(row['artifacts'])
        assert row['returncode'] == 0
        assert digest(native / 'firmware.hex') == row['firmware_sha256']
        assert digest(native / 'firmware.mem') == digest(
            HERE / (row['candidate'] + '-' + str(row['variant']) + '.mem'))
    for name in ('any-layer', 'enabled-only'):
        measured = json.loads((HERE / ('source-' + name + '-sha256.json')).read_text())
        validated = json.loads((HERE / ('validated-' + name + '-sha256.json')).read_text())
        source = ARTIFACTS / name / 'source'
        for filename, expected in measured.items():
            if filename.startswith('tests/'):
                continue  # Additional integration tests were extended after native measurement.
            assert validated[filename] == expected == digest(source / filename), filename
        for filename, expected in validated.items():
            assert digest(source / filename) == expected, filename
        for suffix in ('.patch', '-tests.patch'):
            subprocess.run(['git', 'apply', '--check', str(HERE / (name + suffix))],
                           cwd=ROOT, check=True)
    validation = json.loads((HERE / 'validation.json').read_text())
    assert all(row['returncode'] == 0 for rows in validation.values() for row in rows)
    (HERE / 'artifact-sha256.json').write_text(json.dumps({
        str(path.relative_to(HERE)): digest(path) for path in sorted(HERE.rglob('*'))
        if path.is_file() and '__pycache__' not in path.parts
        and path.name != 'artifact-sha256.json'}, indent=2) + '\n')
    print('Evidence verified; active baseline unchanged; both firmware/test patches apply independently.')


if __name__ == '__main__':
    main()
