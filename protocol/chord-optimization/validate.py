"""Full unchanged host regressions plus independent chord/differential checks."""
from pathlib import Path
import importlib.util
import json
import shutil
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ART=Path('/private/tmp/macropad-chord-optimization')
spec=importlib.util.spec_from_file_location('prior_validation',ROOT/'protocol/tap-hold-investigation/validate.py')
prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)


def main():
    names=sys.argv[1:] or ['baseline','mask-combined','local-combined']
    destination=HERE/'validation.json'
    rows=json.loads(destination.read_text()) if destination.exists() else []
    for name in names:
        source=ART/name/'source';shutil.copyfile(HERE/'chord_audit_test.c',source/'tests/chord_audit_test.c')
        for variant in (0,1):
            binary=ART/name/('audit-'+str(variant))
            command=[*prior.FLAGS,'-O2','-DPHYSICAL_VARIANT='+str(variant),'-fsanitize=address,undefined',
                '-fno-omit-frame-pointer','-fno-sanitize-recover=all','tests/chord_audit_test.c','src/config.c','src/actions.c','-o',str(binary)]
            result=subprocess.run(command,cwd=source,capture_output=True,text=True)
            if not result.returncode:result=subprocess.run([str(binary)],cwd=source,capture_output=True,text=True)
            print(name,variant,result.returncode,result.stdout,result.stderr[-4000:],flush=True)
            row=dict(candidate=name,variant=variant,suite='chord-audit-asan-ubsan',returncode=result.returncode,output=result.stdout,error=result.stderr[-6000:])
            rows=[r for r in rows if not(r['candidate']==name and r['variant']==variant and r['suite']==row['suite'])]+[row]
            destination.write_text(json.dumps(rows,indent=2)+'\n')
            if result.returncode:sys.exit(1)
            if name!='baseline':
                baseline=[r for r in rows if r['candidate']=='baseline' and r['variant']==variant and r['suite']==row['suite']]
                assert baseline and baseline[0]['output']==result.stdout,(name,variant,'baseline trace mismatch',baseline,result.stdout)
        if name!='baseline':
            result=subprocess.run([sys.executable,'tests/run_host_tests.py'],cwd=source,capture_output=True,text=True)
            print(name,'full-host',result.returncode,result.stdout[-3500:],result.stderr[-2000:],flush=True)
            row=dict(candidate=name,variant=None,suite='complete-normal-host-runner',returncode=result.returncode,output=result.stdout,error=result.stderr[-6000:])
            rows=[r for r in rows if not(r['candidate']==name and r['suite']==row['suite'])]+[row]
            destination.write_text(json.dumps(rows,indent=2)+'\n')
            if result.returncode:sys.exit(1)


if __name__=='__main__':main()
