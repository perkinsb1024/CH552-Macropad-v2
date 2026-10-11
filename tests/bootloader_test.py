"""Exercise bootloader protocol and upload ordering without restarting hardware."""

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

PLATFORM = Path(__file__).resolve().parents[1] / "pio-platform"
sys.dont_write_bytecode = True
sys.path.insert(0, str(PLATFORM))
import bootloader
import build_firmware


def reply(opcode, sequence, payload=b"", status=0):
    return bytes([4, 0x55, 0x4D, 1, opcode, sequence, 0, len(payload), status]) + payload + bytes(23 - len(payload))


class BootloaderTests(unittest.TestCase):
    def setUp(self):
        self.configuration = patch.object(bootloader, "configure_macos_hid", return_value=None)
        self.configure = self.configuration.start()
        self.addCleanup(self.configuration.stop)
        self.hid = Mock()
        self.hid.enumerate.return_value = [dict(path=b"pad", usage_page=0xFF00, usage=1)]
        self.device = self.hid.device.return_value
        self.device.write.return_value = 32
        self.info = b"UMAC\x01\x0d\x00\x06\x06\x08\x80\x00\x00\x00"
        self.device.read.side_effect = [reply(1, 1, self.info), reply(10, 2)]

    def test_entry_validates_identity_then_requests_restart(self):
        self.assertTrue(bootloader.enter_bootloader(self.hid))
        self.hid.enumerate.assert_called_once_with(0x1209, 0xC55D)
        self.device.open_path.assert_called_once_with(b"pad")
        self.assertEqual(self.device.write.call_args_list[0].args[0], bytes([3, 0x55, 0x4D, 1, 1, 1]) + bytes(26))
        self.assertEqual(self.device.write.call_args_list[1].args[0], bytes([3, 0x55, 0x4D, 1, 10, 2]) + bytes(26))
        self.device.close.assert_called_once()

    def test_three_key_identity(self):
        info = bytearray(self.info)
        info[6:9] = bytes([1, 3, 3])
        self.device.read.side_effect = [reply(1, 1, info), reply(10, 2)]
        self.assertTrue(bootloader.enter_bootloader(self.hid))

    def test_no_running_pad_leaves_bootloader_available_to_uploader(self):
        self.hid.enumerate.return_value = []
        self.assertFalse(bootloader.enter_bootloader(self.hid))
        self.hid.device.assert_not_called()

    def test_keyboard_collection_is_ignored(self):
        self.hid.enumerate.return_value.append(dict(path=b"keyboard", usage_page=1, usage=6))
        self.assertTrue(bootloader.enter_bootloader(self.hid))

    def test_multiple_pads_are_rejected_before_open(self):
        self.hid.enumerate.return_value *= 2
        with self.assertRaises(bootloader.UnsafeDeviceError):
            bootloader.enter_bootloader(self.hid)
        self.hid.device.assert_not_called()

    def test_unknown_identity_does_not_send_restart(self):
        self.device.read.side_effect = [reply(1, 1, bytes(14))]
        with self.assertRaises(bootloader.UnsafeDeviceError):
            bootloader.enter_bootloader(self.hid)
        self.assertEqual(self.device.write.call_count, 1)
        self.device.close.assert_called_once()

    def test_unsupported_command_is_reported_and_device_closed(self):
        self.device.read.side_effect = [reply(1, 1, self.info), reply(10, 2, status=2)]
        with self.assertRaisesRegex(bootloader.BootloaderError, "does not support"):
            bootloader.enter_bootloader(self.hid)
        self.device.close.assert_called_once()

    def test_unrelated_reports_do_not_count_as_acknowledgement(self):
        self.device.read.side_effect = [bytes(8), reply(1, 99, self.info), reply(1, 1, self.info), reply(10, 2)]
        self.assertTrue(bootloader.enter_bootloader(self.hid))

    def test_timeout(self):
        with patch.object(bootloader.time, "monotonic", side_effect=[0, 4]):
            with self.assertRaisesRegex(bootloader.BootloaderError, "No HID acknowledgement"):
                bootloader.request(self.device, 1, 1)

    def test_short_write(self):
        self.device.write.return_value = 31
        with self.assertRaisesRegex(bootloader.BootloaderError, "complete HID request"):
            bootloader.enter_bootloader(self.hid)
        self.device.read.assert_not_called()
        self.device.close.assert_called_once()

    def test_upload_enters_bootloader_before_invoking_uploader(self):
        calls = []
        with patch.object(bootloader, "enter_bootloader", side_effect=lambda: calls.append("entry")):
            with patch.object(build_firmware, "upload_image", side_effect=lambda *args: calls.append("upload")):
                build_firmware.upload(Path("build"), "3", "yes")
        self.assertEqual(calls, ["entry", "upload"])

    def test_upload_preserves_manual_fallback_but_aborts_unsafe_selection(self):
        for error, should_upload in [(bootloader.BootloaderError("unsupported"), True),
                                     (bootloader.UnsafeDeviceError("multiple pads"), False)]:
            with patch.object(bootloader, "enter_bootloader", side_effect=error):
                with patch.object(build_firmware, "upload_image") as uploader:
                    if should_upload:
                        build_firmware.upload(Path("build"), "3", "yes")
                        uploader.assert_called_once()
                    else:
                        with self.assertRaises(bootloader.UnsafeDeviceError):
                            build_firmware.upload(Path("build"), "3", "yes")
                        uploader.assert_not_called()

    def test_default_upload_never_invokes_hid_helper(self):
        with patch.object(bootloader, "enter_bootloader") as entry:
            with patch.object(build_firmware, "upload_image") as uploader:
                build_firmware.upload(Path("build"), "3")
                build_firmware.upload(Path("build"), "3", "no")
                entry.assert_not_called()
                self.assertEqual(uploader.call_count, 2)

    def test_invalid_opt_in_is_rejected_before_upload(self):
        with patch.object(build_firmware, "upload_image") as uploader:
            with self.assertRaisesRegex(ValueError, "yes or no"):
                build_firmware.upload(Path("build"), "3", "maybe")
            uploader.assert_not_called()

    def test_open_failure_explains_alternatives_without_sending_requests(self):
        self.device.open_path.side_effect = OSError("open failed")
        with patch.object(bootloader.sys, "platform", "darwin"):
            with self.assertRaisesRegex(bootloader.BootloaderError, "Input Monitoring.*browser"):
                bootloader.enter_bootloader(self.hid)
        self.device.write.assert_not_called()

    def test_open_failure_preserves_native_error_detail(self):
        native = self.configure.return_value = Mock()
        native.hid_error.return_value = "IOHIDDeviceOpen: privilege violation"
        self.device.open_path.side_effect = OSError("open failed")
        with self.assertRaisesRegex(bootloader.BootloaderError, "privilege violation"):
            bootloader.enter_bootloader(self.hid)
        native.hid_error.assert_called_once_with(None)
        self.device.write.assert_not_called()


class MacHidTests(unittest.TestCase):
    def test_shared_mode_is_set_on_the_bundled_library(self):
        hid = Mock(__file__="/fake/hid.so")
        native = Mock()
        with patch.object(bootloader.sys, "platform", "darwin"):
            with patch.object(bootloader.ctypes, "CDLL", return_value=native) as load:
                self.assertIs(bootloader.configure_macos_hid(hid), native)
        load.assert_called_once_with("/fake/hid.so")
        native.hid_darwin_set_open_exclusive.assert_called_once_with(0)
        self.assertIsNone(native.hid_darwin_set_open_exclusive.restype)
        self.assertEqual(native.hid_error.restype, bootloader.ctypes.c_wchar_p)

    def test_other_platforms_do_not_load_native_macos_functions(self):
        with patch.object(bootloader.sys, "platform", "linux"):
            with patch.object(bootloader.ctypes, "CDLL") as load:
                self.assertIsNone(bootloader.configure_macos_hid(Mock()))
        load.assert_not_called()

    def test_missing_native_switch_is_reported(self):
        with patch.object(bootloader.sys, "platform", "darwin"):
            with patch.object(bootloader.ctypes, "CDLL", side_effect=OSError("missing")):
                with self.assertRaisesRegex(bootloader.BootloaderError, "shared HID access"):
                    bootloader.configure_macos_hid(Mock(__file__="/fake/hid.so"))


if __name__ == "__main__":
    unittest.main()
