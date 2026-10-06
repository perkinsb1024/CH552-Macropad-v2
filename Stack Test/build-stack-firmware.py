"""Build and verify v10 diagnostics without changing normal builds or releases."""
from configparser import ConfigParser
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parent
settings = ConfigParser()
settings.read(ROOT / 'platformio.ini')
with tempfile.TemporaryDirectory(prefix='macropad-v10-stack-') as temporary:
    root = Path(temporary)
    source = root / 'source'
    shutil.copytree(ROOT / 'src', source / 'src')
    shutil.copyfile(ROOT / 'CH552_Universal_Macropad.ino', source / 'CH552_Universal_Macropad.ino')
    def flags(diagnostic):
        copy = ConfigParser()
        copy.read(ROOT / 'platformio.ini')
        original = copy.get('env:ch552', 'build_flags', fallback='')
        copy.set('env:ch552', 'build_flags', original + ('\n-DENABLE_STACK_TEST=1' if diagnostic else ''))
        with (source / 'platformio.ini').open('w') as file: copy.write(file)
    manifest = dict(builtUtc=datetime.now(timezone.utc).isoformat(),
                    baseRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                    uncommittedChanges=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
                    formatVersion=10, diagnostic='GET_STATUS appends stack base/highest', files={}, measurements=[])
    for variant, keys in [(0,6),(1,3)]:
        outputs = []
        for diagnostic in [False,True]:
            flags(diagnostic)
            output = root / f'{keys}-key-{diagnostic}'
            with (DIRECTORY / f'{keys}-key-{ "diagnostic" if diagnostic else "normal" }-build.log').open('w') as log:
                subprocess.run([sys.executable,str(ROOT/'pio-platform/build_firmware.py'),'build',str(source),str(output),'24000000','148','14336',str(variant)],stdout=log,stderr=subprocess.STDOUT,check=True)
            outputs.append(output)
        normal, output = outputs
        subprocess.run([sys.executable,str(ROOT/'tests/stack_test_firmware.py'),str(output),'--baseline',str(normal)],check=True)
        import re
        mem = (output/'firmware.mem').read_text()
        flash = int(re.search(r'ROM/EPROM/FLASH\s+0x\w+\s+0x\w+\s+(\d+)',mem)[1])
        stack = int(re.search(r'with (\d+) bytes available',mem)[1])
        manifest['measurements'].append(dict(keys=keys,flash=flash,spare=14336-flash,stack=stack))
        for suffix in ['hex','map','mem']:
            target = DIRECTORY / f'{keys}-key-stack-test-firmware.{suffix}'
            shutil.copyfile(output/f'firmware.{suffix}',target)
            manifest['files'][target.name]=hashlib.sha256(target.read_bytes()).hexdigest()
    (DIRECTORY/'firmware-build.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest['measurements'],indent=2))
