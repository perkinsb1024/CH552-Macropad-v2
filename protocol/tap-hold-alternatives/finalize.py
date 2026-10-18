"""Preserve candidate lineage, source archives and exact patch reapplication proofs."""
from pathlib import Path
import difflib
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tarfile
import tempfile
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ART=Path('/private/tmp/macropad-tap-hold-alternatives')
spec=importlib.util.spec_from_file_location('measurement',HERE/'measure.py')
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
PARENTS={
 'baseline':(None,'Unchanged active firmware.'),
 'wrapper-external':('baseline','Previous small wrapper, exclude chord actions and remove the unnecessary chord-owner timestamp.'),
 'wrapper-internal':('wrapper-external','Place pending timestamps and release parameter in internal RAM.'),
 'wrapper-internal-fixed':('wrapper-internal','Fixed 200ms threshold; per-binding selectors are ignored in this diagnostic format.'),
 'sparse-internal':('baseline','Ten-byte header, three-byte hold records, independent deadlines and cached ordinary taps. Initial internal layout fails.'),
 'sparse-narrow':('sparse-internal','Byte-bound metadata subtotals, indirect validator temporaries and lookup argument restore a valid layout.'),
 'sparse-fixed':('sparse-narrow','Fixed 200ms threshold instead of eight profile-wide threshold choices.'),
 'sparse-single':('sparse-narrow','One pending dual-role input; chord matching before interruption promotion; ordinary chord state remains separate.'),
 'sparse-single-fixed':('sparse-single','Fixed 200ms threshold for the single-pending comparison.'),
 'sparse-tag':('sparse-narrow','Internal runtime marker replaces the per-input hold-reference array; resolve normal tap through saved assignment ID.'),
 'sparse-tag-fixed':('sparse-tag','Fixed 200ms threshold for the runtime-marker comparison.'),
 'wrapper-internal-fixed-raw':('wrapper-internal-fixed','Move raw input levels into internal RAM.'),
 'wrapper-internal-fixed-temps':('wrapper-internal-fixed','Try internal telemetry temporaries; compiler spills fail direct RAM allocation.'),
 'wrapper-internal-fixed-maxram':('wrapper-internal-fixed','Raw levels, telemetry temporaries/layer and error clock in internal RAM; layout fails.'),
 'wrapper-internal-fixed-clocks':('wrapper-internal-fixed','Move debounce clock array into internal RAM, release parameter back to xdata to retain 70-byte floor.'),
 'wrapper-internal-fixed-live':('wrapper-internal-fixed','Move telemetry counters into internal RAM and mouse snapshot to xdata; meets floor but smaller saving.'),
 'sparse-tag-fixed-maxram':('sparse-tag-fixed','The same raw/telemetry/error-clock relocation fits this overlay layout, but saves only two flash bytes.'),
 'sparse-fixed-merged':('sparse-fixed','Merge hold lookup into configBinding return value; reuse computed layer/input context and parameter storage.'),
 'sparse-tag-fixed-merged':('sparse-tag-fixed','Merge lookup into ordinary binding read for the runtime-marker variant.'),
 'sparse-single-fixed-merged':('sparse-single-fixed','Merge lookup into ordinary binding read for the single-pending variant.'),
 'wrapper-internal-fixed-bound':('wrapper-internal-fixed','Central physical-record bound rejects chord/nested wrappers; remove separate context handling and body F checks.'),
 'wrapper-internal-fixed-bound-clocks':('wrapper-internal-fixed-bound','Combine centralized validation with both timestamp arrays in internal RAM.'),
 'wrapper-single':('wrapper-internal-fixed-bound','Reuse existing chord pending slot/timestamp; preserve matching chords, layer changes and encoder overlap. Extra control paths outweigh state savings.'),
 'wrapper-single-raw':('wrapper-single','Move raw levels into internal RAM.'),
 'sparse-fixed-merged-linear':('sparse-fixed-merged','Linear layer/input ordinal replaces bit fields; one identifier range check replaces layer/input checks.'),
 'wrapper-internal-bound-clocks':('wrapper-internal-fixed-bound-clocks','Restore per-binding configurable 32-512ms thresholds.'),
 'wrapper-single-raw-clocks':('wrapper-single-raw','Move debounce clocks into internal RAM, release parameter back to xdata.'),
 'sparse-fixed-merged-linear-raw-release':('sparse-fixed-merged-linear','Move raw levels into internal RAM and release parameter to xdata, leaving 71-byte six-key stack.'),
 'sparse-fixed-merged-linear-tail':('sparse-fixed-merged-linear','Place hold records at image end; cheaper lookup but extra macro boundary/terminator validation. Net growth.'),
 'sparse-fixed-merged-linear-tail-raw-release':('sparse-fixed-merged-linear-tail','Apply raw-level/release-argument placement to the tail-table alternative.'),
 'sparse-single-fixed-merged-linear-raw-clocks':('sparse-single-fixed-merged','Combine linear IDs and raw/debounce-clock relocation while retaining chord-first single-pending behavior.'),
 'wrapper-internal-fixed-bound-clocks-combined':('wrapper-internal-fixed-bound-clocks','Compose optional-input HID layer command and adapt header/test contexts.'),
 'wrapper-internal-bound-clocks-combined':('wrapper-internal-bound-clocks','Compose HID with configurable thresholds.'),
 'sparse-fixed-merged-linear-raw-release-combined':('sparse-fixed-merged-linear-raw-release','Compose HID with independent sparse holds and ten-byte profile test fixtures.'),
 'sparse-single-fixed-merged-linear-raw-clocks-combined':('sparse-single-fixed-merged-linear-raw-clocks','Compose HID with the nonpreferred single-pending sparse prototype.'),
}
ALIASES={
 'preferred-fixed':'wrapper-internal-fixed-bound-clocks',
 'preferred-configurable':'wrapper-internal-bound-clocks',
 'sparse-independent':'sparse-fixed-merged-linear-raw-release',
 'single-sparse':'sparse-single-fixed-merged-linear-raw-clocks',
 'single-wrapper':'wrapper-single-raw-clocks',
 'sparse-tail':'sparse-fixed-merged-linear-tail-raw-release',
 'preferred-fixed-combined':'wrapper-internal-fixed-bound-clocks-combined',
 'preferred-configurable-combined':'wrapper-internal-bound-clocks-combined',
 'sparse-independent-combined':'sparse-fixed-merged-linear-raw-release-combined',
 'single-sparse-combined':'sparse-single-fixed-merged-linear-raw-clocks-combined',
}

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def source_files(source):
 return [p for p in sorted(source.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and 'webUploader' not in p.parts]
def manifest(source):return {str(p.relative_to(source)):sha(p) for p in source_files(source)}
def delta_patch(left,right):
 files={str(p.relative_to(left)) for p in source_files(left)}|{str(p.relative_to(right)) for p in source_files(right)}
 lines=[]
 for f in sorted(files):
  a=(left/f).read_bytes() if (left/f).exists() else b'';b=(right/f).read_bytes() if (right/f).exists() else b''
  if a==b:continue
  lines+=list(difflib.unified_diff(a.decode().splitlines(True),b.decode().splitlines(True),
              fromfile='a/'+f if a else '/dev/null',tofile='b/'+f if b else '/dev/null'))
 return ''.join(lines)

def main():
 assert not set(ALIASES) & set(PARENTS)
 data=json.loads((HERE/'results.json').read_text());by={(r['candidate'],r['variant']):r for r in data['rows']}
 assert len(PARENTS)*2==len(by)
 table=['# Alternative Candidate Measurements\n\n',
        'Six/three ordering throughout. Deltas are measured against the named parent. '
        '`RAM FAIL` rows are unsuccessful diagnostic links; their stack figures are not usable reserves. '
        'All nonbaseline candidates exceed the real 14336-byte flash limit.\n\n',
        '| Candidate | Parent | Flash Six/Three | Delta Six/Three | Stack Six/Three | XSEG Six/Three | Layout | Change |\n',
        '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |\n']
 ledger=[]
 for name,(parent,reason) in PARENTS.items():
  a,b=by[name,0],by[name,1];d=[a['flash']-by[parent,0]['flash'],b['flash']-by[parent,1]['flash']] if parent else [0,0]
  layout='Pass' if a['layout_checks']==b['layout_checks']=='passed' else 'RAM FAIL'
  table.append(f"| `{name}` | `{parent or '-'}` | {a['flash']}/{b['flash']} | {d[0]:+}/{d[1]:+} | {a['stack']}/{b['stack']} | {a['external']}/{b['external']} | {layout} | {reason} |\n")
  ledger.append(dict(candidate=name,parent=parent,reason=reason,flash_delta=d,layout=layout))
  source=ART/name/'source'
  if source.exists():q.m.save(name,source)
 (HERE/'candidate-table.md').write_text(''.join(table));(HERE/'lineage.json').write_text(json.dumps(ledger,indent=2)+'\n')
 baseline=ART/'baseline/source';firmware=q.m.FIRMWARE
 hashes={f:sha(ROOT/f) for f in firmware};assert hashes=={f:sha(baseline/f) for f in firmware}
 unchanged=dict(revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                branch=subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),hashes=hashes,unchanged=True)
 (HERE/'active-firmware-unchanged.json').write_text(json.dumps(unchanged,indent=2)+'\n')
 checks=[];reapplied={}
 for alias,name in ALIASES.items():
  source=ART/name/'source';a,b=by[name,0],by[name,1]
  assert a['layout_checks']==b['layout_checks']=='passed' and min(a['stack'],b['stack'])>=70
  successful=[]
  for p in [HERE/('validation-'+name+'.json'),HERE/('validation-'+name+'-focused.json')]:
   if p.exists():
    rows=json.loads(p.read_text())
    if all(not r['returncode'] for r in rows):successful.append(p.name)
  assert successful,name
  for suffix in ('.patch','-tests.patch'):shutil.copyfile(HERE/(name+suffix),HERE/(alias+suffix))
  with tarfile.open(HERE/(alias+'-source.tar.gz'),'w:gz') as tar:
   for p in source_files(source):tar.add(p,arcname=str(p.relative_to(source)),recursive=False)
  target=Path(tempfile.mkdtemp(prefix='reapply-'+alias+'-',dir=ART));reapplied[alias]=target
  for directory in ('src','tests','pio-platform'):shutil.copytree(baseline/directory,target/directory,dirs_exist_ok=True)
  for f in ('CH552_Universal_Macropad.ino','platformio.ini'):shutil.copyfile(baseline/f,target/f)
  for suffix in ('.patch','-tests.patch'):
   subprocess.run(['git','apply','--unsafe-paths',str(HERE/(alias+suffix))],cwd=target,check=True)
  expected=manifest(source);assert all((target/f).exists() and sha(target/f)==digest for f,digest in expected.items()),alias
  checks.append(dict(alias=alias,candidate=name,files=len(expected),reapplied_exactly=True,validation=successful))
 for alias in ('preferred-fixed','preferred-configurable','sparse-independent','single-sparse'):
  left=ART/ALIASES[alias]/'source';right=ART/ALIASES[alias+'-combined']/'source'
  patch=HERE/('hid-on-'+alias+'.patch');patch.write_text(delta_patch(left,right))
  target=reapplied[alias];subprocess.run(['git','apply','--unsafe-paths',str(patch)],cwd=target,check=True)
  expected=manifest(right);assert all((target/f).exists() and sha(target/f)==digest for f,digest in expected.items())
  checks.append(dict(incremental='hid-on-'+alias,files=len(expected),reapplied_exactly=True))
 (HERE/'aliases.json').write_text(json.dumps(ALIASES,indent=2)+'\n');(HERE/'reapplication.json').write_text(json.dumps(checks,indent=2)+'\n')
 print(json.dumps(dict(candidates=len(PARENTS),native_measurements=len(by),patch_reapplications=len(checks),active_firmware_unchanged=True),indent=2))

if __name__=='__main__':main()
