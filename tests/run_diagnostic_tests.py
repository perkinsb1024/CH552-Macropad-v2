"""Exercise capture/recovery against real firmware modules and decode their dumps."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('parse_dataflash', ROOT / 'tools/investigation/parse_dataflash.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
flags = ['cc', '-std=c99', '-Wall', '-Wextra', '-Wno-unknown-pragmas',
         '-D__data=', '-D__idata=', '-D__pdata=', '-D__xdata=', '-D__code=',
         '-DDATAFLASH_DIAGNOSTICS=1', '-DCONFIG_TIMED_MAX=0',
         '-DENABLE_COLOR_PREVIEW=0', '-DCONFIG_TYPE_TEXT=0', '-DINVESTIGATION_BUILD_ID=10',
         '-Itests/stubs']
with tempfile.TemporaryDirectory(prefix='macropad-diagnostics-') as directory:
    for keys in (6, 3):
        for reduced in (1, 0):
            target = Path(directory) / f'{keys}-{reduced}'
            dump = target.with_suffix('.bin')
            subprocess.run([*flags, f'-DPHYSICAL_VARIANT={int(keys == 3)}', f'-DDIAGNOSTIC_REDUCED={reduced}',
                'tests/diagnostics_test.c', 'src/config.c', 'src/actions.c', 'src/storage.c',
                'src/protocol_firmware.c', 'src/diagnostics.c', '-o', str(target)], cwd=ROOT, check=True)
            subprocess.run([str(target), str(dump)], check=True)
            decoded = parser.decode(dump.read_bytes())
            assert decoded['trusted'] and decoded['keys'] == keys and decoded['reducedCapture'] == bool(reduced)
            print(f'Passed {keys}-key capture/recovery, reduced={reduced}', flush=True)
    usb = Path(directory) / 'usb'
    subprocess.run([*flags, '-DDIAGNOSTIC_REDUCED=1',
        '-IwebUploader/upstream/ch55xduino/ch55x/variants/ch552',
        '-IwebUploader/upstream/ch55xduino/ch55x/cores/ch55xduino',
        '-Wno-bitwise-op-parentheses', '-Wno-pointer-to-int-cast',
        'tests/usb_test.c', '-o', str(usb)], cwd=ROOT, check=True)
    subprocess.run([str(usb)], check=True)
    print('Passed USB queue trap and normal USB regressions', flush=True)
subprocess.run([sys.executable, str(ROOT / 'tests/dataflash_parser_test.py')], check=True)
