"""Explicitly upload the previously verified diagnostic for the selected pad."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('keys', type=int, choices=[3, 6])
args = parser.parse_args()
directory = Path(__file__).resolve().parent
name = f'{args.keys}-key-stack-test-firmware.hex'
image = directory / name
manifest = json.loads((directory/'firmware-build.json').read_text())
if hashlib.sha256(image.read_bytes()).hexdigest() != manifest['files'][name]:
    raise SystemExit('Diagnostic checksum differs; rebuild before uploading.')
with tempfile.TemporaryDirectory(prefix='macropad-stack-upload-') as temporary:
    shutil.copyfile(image,Path(temporary)/'firmware.hex')
    subprocess.run([sys.executable,str(directory.parent/'pio-platform/build_firmware.py'),'upload',str(directory.parent),temporary,'3'],check=True)
