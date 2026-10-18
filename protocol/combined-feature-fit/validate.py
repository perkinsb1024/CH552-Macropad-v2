"""Validate exact combined sources with the original full-feature test families."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ART=Path('/private/tmp/macropad-combined-feature-fit')
spec=importlib.util.spec_from_file_location('v',ROOT/'protocol/tap-hold-investigation/validate.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

def main():
    name=sys.argv[1] if len(sys.argv)>1 else 'combined'
    source=ART/name/'source';rows=[]
    for suite in ('tap_hold','tap_hold_integration','input_layer','chord_scan_order'):
        for variant in (0,1):
            binary=ART/name/(suite+'-'+str(variant))
            command=[*v.FLAGS,'-fsanitize=address,undefined','-fno-omit-frame-pointer','-fno-sanitize-recover=all',
                '-DTAP_HOLD_COMBINED=1','-DPHYSICAL_VARIANT='+str(variant),'tests/'+suite+'_test.c','src/config.c','src/actions.c']
            if suite in ('tap_hold_integration','input_layer'):command+=['src/storage.c','src/protocol_firmware.c']
            command+=['-o',str(binary)]
            r=subprocess.run(command,cwd=source,capture_output=True,text=True)
            if not r.returncode:r=subprocess.run([str(binary)],cwd=source,capture_output=True,text=True)
            print(name,suite,variant,r.returncode,r.stdout[-1500:],r.stderr[-2500:],flush=True)
            rows.append(dict(suite=suite+'-asan-ubsan',variant=variant,returncode=r.returncode,output=r.stdout,error=r.stderr[-6000:]))
            if r.returncode:break
        if rows[-1]['returncode']:break
    if not any(r['returncode'] for r in rows) and '--focused' not in sys.argv:
        r=subprocess.run([sys.executable,'tests/run_host_tests.py'],cwd=source,capture_output=True,text=True)
        print(name,'full-host',r.returncode,r.stdout[-3500:],r.stderr[-2000:],flush=True)
        rows.append(dict(suite='complete-normal-host-runner',returncode=r.returncode,output=r.stdout,error=r.stderr[-6000:]))
    suffix='-focused' if '--focused' in sys.argv else ''
    (HERE/('validation-'+name+suffix+'.json')).write_text(json.dumps(rows,indent=2)+'\n')
    (HERE/('validated-'+name+'-sha256.json')).write_text(json.dumps({str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(source.rglob('*')) if p.is_file() and 'webUploader' not in p.parts and '__pycache__' not in p.parts and p.name!='.DS_Store'},indent=2)+'\n')
    if any(r['returncode'] for r in rows):sys.exit(1)

if __name__=='__main__':main()
