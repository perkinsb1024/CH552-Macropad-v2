"""Assemble reviewable final patches and a table from measured/validated snapshots."""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / 'results.json').read_text())
rows = data['rows']
names = list(dict.fromkeys(row['candidate'] for row in rows))
table = ['# Candidate Measurements', '',
         'All values are measured bytes. Failed production-limit links are retained as diagnostics.', '',
         '| Candidate | Flash Six/Three | Added Flash Six/Three | Stack Six/Three | Real-Limit Links |',
         '| --- | --- | --- | --- | --- |']
for name in names:
    six, three = [next(r for r in rows if r['candidate'] == name and r['variant'] == v) for v in (0, 1)]
    table.append(f'| `{name}` | {six["flash"]} / {three["flash"]} | '
                 f'{six["flash"] - 14205} / {three["flash"] - 14201} | '
                 f'{six["stack"]} / {three["stack"]} | '
                 f'{"Pass" if six["returncode"] == 0 else "Fail"} / '
                 f'{"Pass" if three["returncode"] == 0 else "Fail"} |')
table.extend(['', '`opt-index`, `opt-early`, `opt-slot` and `opt-bit` were prepared as',
              'separate source probes but were not linked individually. Their combined',
              'effects are measured in `opt-all` / `opt-final`; no isolated savings are claimed.'])
(HERE / 'candidate-table.md').write_text('\n'.join(table) + '\n')
for candidate, output in [('optional-input-clean', 'recommended'), ('input-clean', 'always-input')]:
    validation = json.loads((HERE / ('validation-' + candidate + '.json')).read_text())
    assert len(validation) == 3 and all(row['returncode'] == 0 for row in validation)
    patch = (HERE / (candidate + '.patch')).read_text() + (HERE / (candidate + '-tests.patch')).read_text()
    (HERE / (output + '.patch')).write_text(patch)
(HERE / 'artifact-sha256.json').write_text(json.dumps({
    p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.iterdir())
    if p.is_file() and p.name != 'artifact-sha256.json'}, indent=2) + '\n')
