import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("embed_image", ROOT / "standalone/embed_image.py")
embed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(embed)


def record(address, kind, data=b""):
    body = bytes([len(data), address >> 8, address & 255, kind]) + data
    return ":" + (body + bytes([-sum(body) & 255])).hex() + "\n"


class ImageTests(unittest.TestCase):
    def good(self, keys=1):
        return record(0, 0, b"\x02\x01\x00") + record(32, 0, b"UMAC\x01\x0a" + bytes([keys])) + record(0, 1)

    def test_three_key_identity_and_erased_gaps_tail(self):
        data, end, version = embed.parse_hex(self.good())
        self.assertEqual(len(data), 0x3800)
        self.assertEqual(end, 39)
        self.assertEqual(version, 10)
        self.assertEqual(data[3:32], b"\xff" * 29)
        self.assertEqual(data[39:], b"\xff" * (0x3800 - 39))

    def test_reject_bad_images(self):
        for text in (self.good(keys=0), self.good()[:-12], self.good() + record(2, 0, b"\x00"),
                     record(0, 0, b"x") + record(0, 0, b"y") + record(0, 1),
                     record(0x3800, 0, b"x") + record(0, 1),
                     record(0, 4, b"\x00\x01") + record(0, 0, b"x") + record(0, 1),
                     self.good().replace(":03000000", ":03000001", 1)):
            with self.subTest(text=text), self.assertRaises(ValueError):
                embed.parse_hex(text)

    def test_existing_release_has_three_key_signature_and_fits(self):
        files = list((ROOT.parents[1] / "releases").glob("ch552-macropad-3-key-*.hex"))
        self.assertEqual(len(files), 1)
        data, end, version = embed.parse_hex(files[0].read_text())
        self.assertEqual(len(data), 0x3800)
        self.assertGreater(end, 0)
        self.assertGreaterEqual(version, 2)


if __name__ == "__main__":
    unittest.main()
