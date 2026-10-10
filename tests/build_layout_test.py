"""Guard the hardware addressing assumptions that host C tests cannot exercise."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "firmware_builder", Path(__file__).resolve().parents[1] / "pio-platform/build_firmware.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MemoryLayoutTests(unittest.TestCase):
    def check(self, **changes):
        symbols = dict(s_PSEG=148, l_PSEG=102, s_XSEG=270, l_XSEG=538,
                       l_XINIT=0, l_XISEG=0, __mcs51_genXRAMCLEAR=92)
        symbols.update(changes)
        text = "\n".join(f"    {value:08X} {name}" for name, value in symbols.items()
                         if value is not None)
        builder.check_memory_layout(text, 148)

    def test_normal_and_exact_page_end(self):
        self.check()
        self.check(l_PSEG=108)

    def test_page_wrap(self):
        with self.assertRaisesRegex(RuntimeError, "page zero"):
            self.check(l_PSEG=109)
        with self.assertRaisesRegex(RuntimeError, "page zero"):
            self.check(s_PSEG=256)

    def test_usb_and_external_overlap(self):
        with self.assertRaisesRegex(RuntimeError, "USB DMA"):
            self.check(s_PSEG=140)
        with self.assertRaisesRegex(RuntimeError, "overlaps"):
            self.check(s_XSEG=249)

    def test_external_capacity(self):
        self.check(l_XSEG=754)
        with self.assertRaisesRegex(RuntimeError, "exceeds"):
            self.check(l_XSEG=755)

    def test_usb_interrupt_parameter_storage(self):
        parameters = dict(_USB_setIdle_PARM_2=270, _USB_getReport_PARM_2=271,
                          _USB_getReport_PARM_3=272)
        self.check(**parameters)
        for name in parameters:
            with self.subTest(name=name):
                with self.assertRaisesRegex(RuntimeError, "must use external RAM"):
                    self.check(**(parameters | {name: 124}))
                with self.assertRaisesRegex(RuntimeError, "must use external RAM"):
                    self.check(**(parameters | {name: None}))
        # The full two-byte pointer must fit, even if its first byte fits.
        with self.assertRaisesRegex(RuntimeError, "must use external RAM"):
            self.check(**(parameters | {"_USB_getReport_PARM_3": 807}))
        with self.assertRaisesRegex(RuntimeError, "storage overlaps"):
            self.check(**(parameters | {"_USB_getReport_PARM_3": 271}))

    def test_absolute_active_configuration(self):
        self.check(_activeConfig=0x300, l_XSEG=498)
        with self.assertRaisesRegex(RuntimeError, "absolute active configuration"):
            self.check(_activeConfig=0x300, l_XSEG=499)
        with self.assertRaisesRegex(RuntimeError, "Unexpected absolute"):
            self.check(_activeConfig=0x380)

    def test_startup_copy_and_clear(self):
        for area in ("l_XINIT", "l_XISEG"):
            with self.assertRaisesRegex(RuntimeError, "XINIT"):
                self.check(**{area: 1})
        with self.assertRaisesRegex(RuntimeError, "Startup"):
            self.check(__mcs51_genXRAMCLEAR=None)


if __name__ == "__main__":
    unittest.main()
