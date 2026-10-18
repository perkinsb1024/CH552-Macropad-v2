"""Validate alternative snapshots with strict sanitizers and real baseline regressions."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ART=Path('/private/tmp/macropad-tap-hold-alternatives')
spec=importlib.util.spec_from_file_location('old_validation',ROOT/'protocol/tap-hold-investigation/validate.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
FLAGS=old.FLAGS

def main():
 name=sys.argv[1];source=ART/name/'source';rows=[]
 shutil.copyfile(HERE/'fixture.h',source/'tests/alternative_fixture.h')
 shutil.copyfile(HERE/'alternatives_test.c',source/'tests/alternatives_test.c')
 runner=source/'tests/run_host_tests.py';s=runner.read_text()
 s='\n'.join(line for line in s.split('\n') if 'suites +=' not in line or ('"tap_hold"' not in line and '"tap_hold_integration"' not in line and '"alternatives"' not in line and '"alternative_integration"' not in line))
 addition='    suites += [("alternatives", ["src/config.c", "src/actions.c"], variant) for variant in (0, 1)]\n'
 addition+='    suites += [("alternative_integration", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n'
 if addition not in s:s=s.replace('    for suite in suites:',addition+'    for suite in suites:')
 runner.write_text(s)
 suites=['alternatives']+(['alternative_integration'] if (HERE/'integration_test.c').exists() else [])
 if name.endswith('combined'):suites.append('input_layer')
 for suite in suites:
  if suite=='alternative_integration':shutil.copyfile(HERE/'integration_test.c',source/'tests/alternative_integration_test.c')
  for variant in (0,1):
   binary=ART/name/(suite+'-'+str(variant))
   command=[*FLAGS,'-fsanitize=address,undefined','-fno-omit-frame-pointer','-fno-sanitize-recover=all',
            '-DPHYSICAL_VARIANT='+str(variant),'tests/'+suite+'_test.c','src/config.c','src/actions.c']
   if suite!='alternatives':command+=['src/storage.c','src/protocol_firmware.c']
   if name.endswith('combined'):command+=['-DTAP_COMBINED=1']
   command+=['-o',str(binary)]
   result=subprocess.run(command,cwd=source,capture_output=True,text=True)
   if not result.returncode:result=subprocess.run([str(binary)],cwd=source,capture_output=True,text=True)
   print(name,suite,variant,result.returncode,result.stdout[-1500:],result.stderr[-2000:],flush=True)
   rows.append(dict(suite=suite,variant=variant,returncode=result.returncode,output=result.stdout,error=result.stderr[-5000:]))
   if result.returncode:break
  if rows[-1]['returncode']:break
 if not any(r['returncode'] for r in rows) and '--focused' not in sys.argv:
  result=subprocess.run([sys.executable,'tests/run_host_tests.py'],cwd=source,capture_output=True,text=True)
  print(name,'host',result.returncode,result.stdout[-3500:],result.stderr[-2000:],flush=True)
  rows.append(dict(suite='normal-host-runner',returncode=result.returncode,output=result.stdout,error=result.stderr[-4000:]))
 suffix='-focused' if '--focused' in sys.argv else ''
 (HERE/('validation-'+name+suffix+'.json')).write_text(json.dumps(rows,indent=2)+'\n')
 (HERE/('validated-'+name+'-sha256.json')).write_text(json.dumps({str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()
  for p in sorted(source.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and 'webUploader' not in p.parts},indent=2)+'\n')
 if any(r['returncode'] for r in rows):sys.exit(1)
if __name__=='__main__':main()
