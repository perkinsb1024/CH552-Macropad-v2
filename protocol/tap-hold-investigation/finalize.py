"""Seal reviewable patches, lineage, source checksums and reapplication checks."""
from pathlib import Path
import hashlib
import difflib
import importlib.util
import json
import re
import shutil
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ART = Path('/private/tmp/macropad-tap-hold')
spec = importlib.util.spec_from_file_location('measurement', HERE / 'measure.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PARENTS = {
 'baseline': (None, 'Unchanged active firmware.'),
 'initial': ('baseline', 'First complete wrapper/block implementation; direct parameter and validator storage fails internal RAM allocation.'),
 'ram': ('initial', 'Move new helper parameters to xdata; still fails internal RAM due to validator spills; reject.'),
 'shared-clock': ('initial', 'Share a decision clock between release/poll; idata validator metadata; still fails internal RAM.'),
 'narrow': ('shared-clock', 'Byte-cast alignment subtraction and bounded block arithmetic; simplify threshold shifts. First valid RAM layout.'),
 'combined-loop': ('narrow', 'Validate alternating tap/hold records in one two-byte loop instead of two calls per four-byte record.'),
 'fixed-clock': ('narrow', 'Diagnostic fixed 200ms threshold; changes new-feature behavior, not selected or validated.'),
 'external-state': ('combined-loop', 'Move decision clock, validator metadata and branch parameter to xdata; spills defeat internal layout; reject.'),
 'precheck': ('external-state', 'Resolve due decisions before physical scanning; parent layout still invalid.'),
 'direct-state': ('combined-loop', 'Direct validator metadata with xdata release argument saves flash without adding internal storage.'),
 'precheck-good': ('direct-state', 'Extract due-input resolution and call it before scanning and during output polling; correct same-frame layer dispatch.'),
 'inline-expiry': ('precheck-good', 'Inline expiry predicate at both call sites; grows flash; reject.'),
 'stack-safe': ('precheck-good', 'Structured reference checks and external helper state recover three stack bytes, still two below baseline.'),
 'one-loop': ('precheck-good', 'Combine pair-body and macro-tail validation in one scan with separate contexts.'),
 'stack-final': ('one-loop', 'Try external state plus local prefix cursor and four/seven timestamps; validator spills fail RAM layout; reject.'),
 'byte-count': ('one-loop', 'Bound prefix end with byte arithmetic: original end<=128, optional span<=65, sum<=193; use four timestamps on three-key pad.'),
 'split-clock': ('one-loop', 'Compare elapsed>>5 with selector; exact integer equivalence, no timing precision loss. Four/seven timestamps.'),
 'dispatch-type': ('one-loop', 'Reuse decoded type in runAction; zero flash saving; no reason to retain.'),
 'end-aligned': ('byte-count', 'Use block end for four-byte alignment and tap/hold parity; eliminate stored pair-start byte.'),
 'end-aligned-stack': ('end-aligned', 'External decision clock, branch argument and single validator end restore full baseline stack.'),
 'end-aligned-small': ('end-aligned', 'Retain exact elapsed>>5 comparison; save two flash bytes.'),
 'final-combined': ('end-aligned-stack', 'Earlier composition probe with optional-input HID layer patch; superseded by complete-combined.'),
 'complete-small': ('end-aligned-small', 'Recompute effective layer inside branch resolution before release cleanup; no flash-size change.'),
 'complete-stack': ('end-aligned-stack', 'Same release-boundary correction, preserving baseline stack.'),
 'complete-combined': ('complete-stack', 'Apply optional-input HID layer command, adapt conflicting header context and old test release calls.'),
 'complete-small-combined': ('complete-small', 'Same HID composition using the smaller, four-byte-lower-stack variant.'),
}

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    rows = json.loads((HERE / 'results.json').read_text())['rows']
    by = {(r['candidate'], r['variant']): r for r in rows}
    table = ['# Tap-Hold Candidate Measurements\n\n',
             'All deltas are measured against the named parent, not estimates. '
             'Six/three values are ordered consistently. `RAM FAIL` means linker placement failed; '
             'its reported flash/stack figures are diagnostic and are not usable firmware measurements. '
             'Every nonbaseline candidate fails the real flash limit.\n\n',
             '| Candidate | Parent | Flash Six/Three | Delta Six/Three | Stack Six/Three | XSEG Six/Three | Layout | Change |\n',
             '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |\n']
    ledger = []
    for name, (parent, reason) in PARENTS.items():
        a, b = by[name, 0], by[name, 1]
        delta = [a['flash'] - by[parent, 0]['flash'], b['flash'] - by[parent, 1]['flash']] if parent else [0, 0]
        layout = 'Pass' if a['layout_checks'] == b['layout_checks'] == 'passed' else 'RAM FAIL'
        table.append(f"| `{name}` | `{parent or '-'}` | {a['flash']}/{b['flash']} | {delta[0]:+}/{delta[1]:+} | {a['stack']}/{b['stack']} | {a['external']}/{b['external']} | {layout} | {reason} |\n")
        ledger.append(dict(candidate=name, parent=parent, reason=reason, flash_delta=delta, layout=layout))
        source = ART / name / 'source'
        if source.exists(): m.save(name, source)
    (HERE / 'candidate-table.md').write_text(''.join(table))
    (HERE / 'lineage.json').write_text(json.dumps(ledger, indent=2) + '\n')
    baseline = ART / 'baseline/source'
    active = {filename: sha(ROOT / filename) for filename in m.FIRMWARE}
    assert active == {filename: sha(baseline / filename) for filename in m.FIRMWARE}
    (HERE / 'active-firmware-unchanged.json').write_text(json.dumps(dict(
        revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        branch=subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip(),
        hashes=active, active_firmware_matches_baseline=True), indent=2) + '\n')
    checks = []
    reapplied_by_name = {}
    for name in ('complete-small', 'complete-stack', 'complete-combined', 'complete-small-combined'):
        source = ART / name / 'source'
        # Durable compact source snapshot also preserves the exact tested tests/runner.
        with tarfile.open(HERE / (name + '-source.tar.gz'), 'w:gz') as archive:
            for path in sorted(source.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and 'webUploader' not in path.parts:
                    archive.add(path, arcname=str(path.relative_to(source)), recursive=False)
        reapplied = Path(tempfile.mkdtemp(prefix='reapply-' + name + '-', dir=ART))
        reapplied_by_name[name] = reapplied
        for directory in ('src', 'tests', 'pio-platform'):
            shutil.copytree(baseline / directory, reapplied / directory, dirs_exist_ok=True)
        for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
            shutil.copyfile(baseline / filename, reapplied / filename)
        for suffix in ('.patch', '-tests.patch'):
            subprocess.run(['git', 'apply', '--unsafe-paths', str(HERE / (name + suffix))], cwd=reapplied, check=True)
        manifest = json.loads((HERE / ('source-' + name + '-sha256.json')).read_text())
        differences = [filename for filename, digest in manifest.items()
                       if not (reapplied / filename).exists() or sha(reapplied / filename) != digest]
        assert not differences, (name, differences)
        checks.append(dict(candidate=name, patches_reapply=True, exact_files=len(manifest)))
    for left_name, right_name in [('complete-small', 'complete-small-combined'), ('complete-stack', 'complete-combined')]:
        left, right = ART / left_name / 'source', ART / right_name / 'source'
        filenames = set(str(p.relative_to(right)) for p in right.rglob('*') if p.is_file()
                        and '__pycache__' not in p.parts and 'webUploader' not in p.parts)
        patch = []
        for filename in sorted(filenames):
            before = (left / filename).read_bytes() if (left / filename).exists() else b''
            after = (right / filename).read_bytes()
            if before == after: continue
            patch.extend(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True),
                         fromfile='a/' + filename if before else '/dev/null', tofile='b/' + filename))
        patch_path = HERE / ('hid-on-' + left_name + '.patch')
        patch_path.write_text(''.join(patch))
        target = reapplied_by_name[left_name]
        subprocess.run(['git', 'apply', '--unsafe-paths', str(patch_path)], cwd=target, check=True)
        manifest = json.loads((HERE / ('source-' + right_name + '-sha256.json')).read_text())
        assert all((target / f).exists() and sha(target / f) == digest for f, digest in manifest.items())
        checks.append(dict(incremental='hid-on-' + left_name, patches_reapply=True, exact_files=len(manifest)))
    (HERE / 'reapplication.json').write_text(json.dumps(checks, indent=2) + '\n')
    print(json.dumps(dict(candidates=len(PARENTS), native_measurements=len(rows), reapplication=checks,
                         active_firmware_unchanged=True), indent=2))

if __name__ == '__main__': main()
