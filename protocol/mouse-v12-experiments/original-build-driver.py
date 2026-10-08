from pathlib import Path
import concurrent.futures, subprocess, json, re
work=Path(__file__).resolve().parent

def build(pair):
    name, variant=pair
    project=work/name
    out=work/(name+'-'+str(variant))
    with (work/(out.name+'.log')).open('w') as log:
        result=subprocess.run(['python3',str(project/'pio-platform/build_firmware.py'),'build',str(project),str(out),'24000000','148','14336',str(variant)],stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:
        return {'name':name,'variant':variant,'error':str(work/(out.name+'.log'))}
    m=(out/'firmware.map').read_text()
    symbols={n:int(v,16) for v,n in re.findall(r'(?m)^\s*(?:[CD]:\s+)?([0-9A-F]{8})\s+([A-Za-z_]\w*)\b',m)}
    return {'name':name,'variant':variant,'symbols':{k:v for k,v in symbols.items() if k.startswith(('l_','s_'))},'mem':(out/'firmware.mem').read_text()}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results=list(pool.map(build,[(n,v) for n in ('baseline','global') for v in (0,1)]))
(work/'results.json').write_text(json.dumps(results,indent=2))
for r in results:
    print(json.dumps(r),flush=True)
