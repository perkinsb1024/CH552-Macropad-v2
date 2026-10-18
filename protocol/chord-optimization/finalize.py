"""Preserve the complete measurement ledger, patch replay and active-source evidence."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import tarfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ART=Path('/private/tmp/macropad-chord-optimization')
spec=importlib.util.spec_from_file_location('measure',HERE/'measure.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

DESCRIPTIONS={
 'baseline':('','Unchanged firmware.'),
 'global-byte':('baseline','Narrow the global identifier comparison.'),
 'lookup-countdown':('baseline','Replace the lookup induction variable with a countdown.'),
 'lookup-single-read':('baseline','Read each candidate identifier once.'),
 'lookup-nibble':('baseline','Compare scope and pair nibbles separately.'),
 'pair-inline':('baseline','Inline bounded triangular pair arithmetic.'),
 'pair-table':('baseline','Use row bases instead of triangular arithmetic.'),
 'validator-scope':('baseline','Compare shifted layer limits instead of decoded scope.'),
 'validator-order':('baseline','Use incremented IDs and a zero sentinel for ordering.'),
 'shared-dispatch':('baseline','Share chord and ordinary input dispatch.'),
 'cached-mask':('baseline','Compute an accepted input mask once.'),
 'offset-pair':('baseline','Return an action offset through a pair-oriented API.'),
 'mask-lookup':('baseline','One mask-based scan serves participation and exact-pair queries.'),
 'mask-direct':('mask-lookup','Load chosen actions directly into button state.'),
 'resolve-unguarded':('baseline','Move the pending guard into the layer-update caller.'),
 'partner-internal':('baseline','Move partner state to indirect internal RAM.'),
 'pending-internal':('baseline','Move pending state to indirect internal RAM.'),
 'local-combined':('baseline','Combine local arithmetic, dispatch, mask and validator probes.'),
 'mask-combined':('baseline','Combine mask API, dispatch, cached mask and validator probes.'),
 'mask-callee':('mask-combined','Add callee-saves for the lookup.'),
 'local-selected':('baseline','Combine the beneficial local changes without the mask API.'),
 'mask-selected':('baseline','Combine mask lookup, shared dispatch and cached input mask.'),
 'mask-narrow':('mask-selected','Keep scope and ROM table indices byte-sized.'),
 'mask-scope':('mask-selected','Keep scope byte-sized without narrowing the ROM index.'),
 'mask-xor':('mask-selected','Compare excluded bits instead of equality with the query mask.'),
 'mask-do':('mask-selected','Early zero-count return and decrement loop.'),
 'mask-physical':('mask-selected','Cache physical-key status in a native bit.'),
 'mask-time':('mask-selected','Share exact 16-bit elapsed comparison in a helper.'),
 'mask-time-bytes':('mask-selected','Split high/low elapsed comparison inside a shared helper.'),
 'mask-release':('mask-selected','Capture the partner value in the release condition.'),
 'mask-links':('mask-selected','Reuse pending input plus one when linking partners.'),
 'mask-narrow-time':('mask-narrow','Combine narrowed lookup and exact timing helper.'),
 'mask-narrow-physical':('mask-narrow','Combine narrowed lookup and cached physical status.'),
 'mask-final-probe':('mask-selected','Compose narrow, bit, time, release, link and loop probes.'),
 'mask-inverted':('mask-narrow','Store complemented chord masks and test excluded bits directly.'),
 'mask-release-byte':('mask-narrow','Bound pending-input comparison to one byte.'),
 'mask-release-local':('mask-narrow','Replace obsolete paged release scratch with a local mask.'),
 'mask-inverted-byte':('mask-inverted','Add the bounded pending-input comparison.'),
 'mask-compact':('mask-inverted-byte','Add local release-mask storage.'),
 'mask-compact-do':('mask-compact','Add zero-count fast return and decrement loop.'),
 'mask-compact-register':('mask-compact','Add callee-saves for the palette-offset getter.'),
 'mask-inline-time':('mask-narrow','Inline exact split high/low elapsed comparisons.'),
 'mask-compact-unguarded':('mask-compact','Move the pending guard into the layer-update caller.'),
 'compact-validator-byte':('mask-compact-do','Store decoded validation scope in a byte.'),
 'compact-validator-fold':('mask-compact-do','Fold reserved-bit rejection into pair range checking.'),
 'compact-validator-signed':('mask-compact-do','Use signed minus-one ordering sentinel.'),
 'compact-bit-table':('mask-compact-do','Replace repeated bounded variable shifts with seven ROM bytes.'),
 'compact-bit-helper':('mask-compact-do','Factor shifts into a shared helper instead of a table.'),
 'compact-order-init':('mask-compact-do','Merge partner initialization with the existing input loop.'),
 'final-table':('compact-bit-table','Add merged partner initialization.'),
 'data-input':('compact-bit-table','Store the physical-down mask in direct internal RAM.'),
 'data-pending':('compact-bit-table','Store pending input/layer/timestamp in direct internal RAM.'),
 'data-clock':('compact-bit-table','Store only the pending timestamp in direct internal RAM.'),
 'data-all':('compact-bit-table','Move all five hot input/pending bytes to direct RAM.'),
 'data-all-init':('data-all','Add merged partner initialization.'),
 'final':('data-all-init','Clarify mask tables and omit unused native three-key input-bit entries.'),
 'optimized-no-chords':('','Diagnostic removal control with the same generic input optimizations; not adopted.'),
}

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    results=json.loads((HERE/'results.json').read_text());rows=results['rows']
    names=list(dict.fromkeys(r['candidate'] for r in rows))
    by={(r['candidate'],r['variant']):r for r in rows}
    assert set(names)==set(DESCRIPTIONS)
    out=['# Chord Optimization Measurements\n\n',
        'All sizes are bytes, ordered six/three. Every row passes the real 14336-byte link and native layout checks. A negative parent delta saves flash. Tests cover the selected candidates, not every measured probe.\n\n',
        '| Candidate | Parent | Flash | Parent Delta | Baseline Saving | Stack | PSEG | XSEG | Change |\n',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n']
    for name in names:
        a,b=by[name,0],by[name,1];parent,description=DESCRIPTIONS[name]
        assert all(r['layout_checks']=='passed' and not r['real_limit_returncode'] for r in (a,b))
        delta='/'.join(f"{r['flash']-by[parent,v]['flash']:+}" for v,r in enumerate((a,b))) if parent else '-'
        values=lambda k:f"{a[k]}/{b[k]}"
        out.append(f"| `{name}` | `{parent or '-'}` | {values('flash')} | {delta} | {14205-a['flash']}/{14201-b['flash']} | {values('stack')} | {values('paged')} | {values('external')} | {description} |\n")
    (HERE/'candidate-table.md').write_text(''.join(out))
    # Replay every measured firmware/test patch against the frozen original input.
    baseline=ART/'baseline/source';checks=[]
    for name in names:
        source=ART/name/'source';replay=ART/('replay-'+name)/'source'
        if replay.exists():raise RuntimeError(f'Existing replay: {replay}')
        shutil.copytree(baseline,replay,symlinks=True)
        for suffix in ('.patch','-tests.patch'):
            patch=HERE/(name+suffix)
            if patch.stat().st_size:subprocess.run(['git','apply','--unsafe-paths',str(patch)],cwd=replay,check=True)
        files=[*m.FILES,'tests/config_fixture.h','tests/run_host_tests.py']+(['tests/chord_lookup_test.c'] if name=='final' else [])
        assert all(digest(replay/f)==digest(source/f) for f in files),name
        checks.append(dict(candidate=name,exact=True))
    (HERE/'reapplication.json').write_text(json.dumps(checks,indent=2)+'\n')
    # Root sources must match the tested final snapshot and freshly built HEX.
    active={f:digest(ROOT/f) for f in m.FILES}
    assert all(active[f]==digest(ART/'final/source'/f) for f in m.FILES)
    for f in ('tests/config_fixture.h','tests/run_host_tests.py','tests/chord_lookup_test.c'):
        assert digest(ROOT/f)==digest(ART/'final/source'/f)
    binaries={}
    for variant,board in enumerate(('six','three')):
        build=ART/('active-'+board);assert digest(build/'firmware.hex')==by['final',variant]['hex_sha256']
        binaries[board]=dict(hex_sha256=digest(build/'firmware.hex'),flash=by['final',variant]['flash'],layout='passed')
    (HERE/'active-validation.json').write_text(json.dumps(dict(baseline_revision=results['baseline_revision'],
        working_tree='uncommitted firmware/tests and memory documentation',sources=active,native=binaries,
        full_host_runner='passed',final_differential_sanitizers='passed on identical sources',
        configurator='passed via npm run verify:deploy',uploader='95 passed',
        complete_site='passed, TypeScript/build and 16 frozen archive manifests',hardware='not tested'),indent=2)+'\n')
    archives=[]
    for name in ('final','local-selected'):
        archive=HERE/(name+'-sources.tar.gz')
        with tarfile.open(archive,'w:gz') as tar:
            for p in sorted((ART/name/'source').rglob('*')):
                if not p.is_file() or '__pycache__' in p.parts or 'webUploader' in p.parts or p.name=='.DS_Store':continue
                tar.add(p,arcname=str(p.relative_to(ART/name/'source')),recursive=False)
        archives.append(dict(file=archive.name,sha256=digest(archive)))
    (HERE/'archives.json').write_text(json.dumps(archives,indent=2)+'\n')
    # Preserve the complete reproducible notebook entry without replacing prior work.
    notebook=ROOT/'potential_optimizations.md';heading='## Chord Optimization Pass — October 18, 2026'
    if heading not in notebook.read_text():
        with notebook.open('a') as f:
            f.write('\n\n'+heading+'\n\n')
            f.write((HERE/'NOTEBOOK.md').read_text())
            f.write('\n'+''.join(out[2:]))
    (HERE/'artifact-sha256.json').write_text(json.dumps({p.name:digest(p) for p in sorted(HERE.iterdir())
        if p.is_file() and p.name!='artifact-sha256.json'},indent=2)+'\n')
    print(f'{len(names)} candidate patch replays verified; active source/HEX equality verified; notebook appended.')

if __name__=='__main__':main()
