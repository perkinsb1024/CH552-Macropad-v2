import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools/investigation/parse_dataflash.py'
spec = importlib.util.spec_from_file_location('parse_dataflash', TOOL)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def record(reduced=False):
    data = bytearray(128)
    data[:4] = parser.SIGNATURE
    data[4:12] = bytes([0xA5, 1, 0, 0xD2, 10, 0, 4, 5])
    data[16:20] = (0x12345678).to_bytes(4, 'little')
    data[20:28] = bytes([190, 128, 130, 0, 0, 169, 255, 0])
    data[32:41] = bytes.fromhex('4d500c000000123468')
    data[41] = 0x83 if reduced else 3
    data[54] = 255
    data[56:58] = (0x5000).to_bytes(2, 'little')
    data[60:104] = bytes(range(44))
    data[112:128] = bytes(range(16))
    data[14:16] = parser.crc16(data, (14, 15)).to_bytes(2, 'little')
    return data


class DataFlashParserTests(unittest.TestCase):
    def test_verified_full_and_reduced(self):
        for reduced in (False, True):
            decoded = parser.decode(record(reduced))
            self.assertEqual(decoded['status'], 'verified')
            self.assertEqual(decoded['buildId'], 10)
            self.assertEqual(decoded['reason'], 'Runtime encoder hold')
            self.assertEqual(decoded['inputs']['encoderMovement'], -1)
            self.assertEqual(decoded['reducedCapture'], reduced)
            if reduced:
                self.assertIsNone(decoded['leds'])
                self.assertIsNone(decoded['inputs']['pendingInput'])
                self.assertEqual(decoded['rawInternalRam']['hex'], bytes(range(44)).hex())
                self.assertEqual(decoded['actions']['eventSlots'][7], [14, 15])

    def test_every_single_bit_corruption_is_untrusted(self):
        original = record(True)
        for offset in range(128):
            for bit in range(8):
                damaged = original.copy()
                damaged[offset] ^= 1 << bit
                self.assertFalse(parser.decode(damaged)['trusted'], (offset, bit))

    def test_pending_partial_and_unsupported(self):
        data = record()
        data[4] = 0
        self.assertEqual(parser.decode(data)['status'], 'incomplete-or-corrupt')
        data[1] = 0
        decoded = parser.decode(data)
        self.assertTrue(decoded['reservationPresent'])
        self.assertNotIn('reason', decoded)
        data = record(); data[5] = 2
        self.assertEqual(parser.decode(data)['status'], 'unsupported-schema')
        data[0] = ord('M')
        self.assertEqual(parser.decode(data)['status'], 'not-diagnostic')
        with self.assertRaises(ValueError):
            parser.decode(data[:-1])

    def test_binary_and_hex_inputs(self):
        data = bytes(record())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'dump'
            for content in (data, data.hex().encode(),
                            ' '.join(f'0x{b:02x}' for b in data).encode()):
                path.write_bytes(content)
                self.assertEqual(parser.read_dump(path), data)
            path.write_text('00 ' * 127)
            with self.assertRaises(ValueError):
                parser.read_dump(path)

    def test_cli_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / 'dump.bin'
            manifest = Path(directory) / 'manifest.json'
            dump.write_bytes(record(True))
            manifest.write_text(json.dumps(dict(buildId=10, builds=[dict(keys=6,
                internalSymbols={'_eventUsed': 0x55})])))
            result = subprocess.run([sys.executable, str(TOOL), str(dump), '--json',
                                     '--manifest', str(manifest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            decoded = json.loads(result.stdout)
            self.assertEqual(decoded['internalVariables']['_eventUsed']['byte'], 5)
            manifest.write_text('{"buildId":11,"builds":[]}')
            result = subprocess.run([sys.executable, str(TOOL), str(dump), '--json',
                                     '--manifest', str(manifest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
