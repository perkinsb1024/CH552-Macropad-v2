"""Upload one explicitly selected, checksum-verified stack diagnostic image."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('keys', type=int, choices=[3, 6])
parser.add_argument('build', type=Path, help='Directory containing firmware-build.json')
args = parser.parse_args()
directory = args.build.resolve()
manifest = json.loads((directory / 'firmware-build.json').read_text())
name = f'{args.keys}-key-stack-test-firmware.hex'
image = directory / name
if manifest.get('verified') is not True or manifest.get('formatVersion') != 12:
    raise SystemExit('Build manifest is not a verified v12 diagnostic.')
if hashlib.sha256(image.read_bytes()).hexdigest() != manifest['files'][name]:
    raise SystemExit('Diagnostic checksum differs; rebuild before uploading.')
# Use the builder snapshot associated with the manifest. The upload operation
# selects this exact HEX and boot configuration 3 without a rebuild or release.
sys.path.insert(0, str(directory))
from build_firmware import upload_image
upload_image(directory, '3', image,
    f'Enter bootloader mode: hold the encoder button while connecting USB, then release. Uploading {args.keys}-key stack diagnostic.')
