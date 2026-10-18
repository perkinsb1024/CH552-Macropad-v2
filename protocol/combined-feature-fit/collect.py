"""Preserve source, measurements and a compact probe ledger for this experiment."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import tarfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('m', HERE / 'measure.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
dest = HERE / 'results.json'
data = json.loads(dest.read_text())
for filename in ('binding-results.json', 'order-index-results.json', 'order-bit-results.json'):
    data['rows'] += json.loads((HERE / filename).read_text())
unique = {(r['candidate'], r['variant']): r for r in data['rows']}
data['rows'] = sorted(unique.values(), key=lambda r: (r['candidate'], r['variant']))
names = sorted({r['candidate'] for r in data['rows']})
test_patches = {}
for name in names:
    m.save(name, m.ART / name / 'source')
    patch = HERE / (name + '-tests.patch')
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    if digest not in test_patches or name in ('combined', 'binding-offset', 'selected'):
        test_patches[digest] = patch.name
for name in names:
    patch = HERE / (name + '-tests.patch')
    chosen = test_patches[hashlib.sha256(patch.read_bytes()).hexdigest()]
    for row in data['rows']:
        if row['candidate'] == name:
            row['test_patch'] = chosen
    if chosen != patch.name:
        patch.unlink()
dest.write_text(json.dumps(data, indent=2) + '\n')

tree = ast.parse((HERE / 'measure.py').read_text())
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'optimize')
recipes = ast.literal_eval(function.body[0].value)
(HERE / 'recipes.json').write_text(json.dumps(recipes, indent=2) + '\n')
lines = ['# Combined-Feature Candidate Measurements\n\n',
    'Six-/three-key ordering throughout. RAM Fail includes native overlay allocation failures. '
    'Oversized images use a diagnostic link solely for measurement; only real-limit successes fit. '
    'The selected source preserves ordinary chord scan ordering. Earlier combined, hot-* '
    'and final scheduling prototypes are not adoption candidates.\n\n',
    '| Candidate | Recipe or Parent | Flash | Free | Stack Reserve | PSEG | XSEG | Native Result |\n',
    '| --- | --- | --- | --- | --- | --- | --- | --- |\n']
for name in names:
    rows = [unique[(name, v)] for v in (0, 1)]
    pair = lambda key: '/'.join(str(r[key]) for r in rows)
    result = 'RAM Fail' if any(r['layout_checks'] != 'passed' for r in rows) else (
        'Fits' if all(r['real_limit_returncode'] == 0 for r in rows) else 'Over Flash Limit')
    recipe = recipes.get(name, 'hot-r + cleanup/tests (superseded)' if name == 'final' else
        'order-m + cleanup/tests' if name == 'selected' else '-' if name == 'baseline' else 'combined')
    values = [name, recipe, pair('flash'), pair('free'), pair('stack'),
        pair('paged'), pair('external'), result]
    lines.append('| ' + ' | '.join(values) + ' |\n')
(HERE / 'candidate-table.md').write_text(''.join(lines))

for name in ('baseline', 'selected'):
    source = m.ART / name / 'source'
    files = [p for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts
        and 'webUploader' not in p.parts and p.name != '.DS_Store']
    with tarfile.open(HERE / (name + '-source.tar.gz'), 'w:gz') as archive:
        for p in sorted(files):
            archive.add(p, arcname=str(p.relative_to(source)), recursive=False)

print('Preserved', len(names), 'candidates /', len(data['rows']), 'measurements;',
    len(test_patches), 'distinct regression patches.')
