"""Request runtime bootloader entry using the macropad's transport-v1 HID lane."""

import ctypes
import sys
import time
from pathlib import Path


class BootloaderError(RuntimeError):
    pass


class UnsafeDeviceError(BootloaderError):
    pass


def configure_macos_hid(hid_module):
    if sys.platform != "darwin":
        return None
    # cython-hidapi does not expose this switch. Call the bundled HIDAPI,
    # rather than loading a second copy with independent global state.
    try:
        native = ctypes.CDLL(hid_module.__file__)
        native.hid_darwin_set_open_exclusive.argtypes = [ctypes.c_int]
        native.hid_darwin_set_open_exclusive.restype = None
        native.hid_error.argtypes = [ctypes.c_void_p]
        native.hid_error.restype = ctypes.c_wchar_p
        # All report collections share a keyboard interface on macOS. Seizing
        # that interface can fail even with Input Monitoring permission.
        native.hid_darwin_set_open_exclusive(0)
        return native
    except (AttributeError, OSError) as error:
        raise BootloaderError(
            "Could not enable shared HID access. Reinstall the dependency from "
            "pio-platform/requirements-hid.txt."
        ) from error


def request(device, opcode, sequence, timeout_ms=3000):
    packet = bytes([3, 0x55, 0x4D, 1, opcode, sequence]) + bytes(26)
    if device.write(packet) != len(packet):
        raise BootloaderError("Could not send the complete HID request.")
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        reply = bytes(device.read(32, max(1, int((deadline - time.monotonic()) * 1000))))
        if len(reply) != 32 or reply[:6] != bytes([4, 0x55, 0x4D, 1, opcode, sequence]):
            continue
        if reply[6] or reply[7] > 23:
            raise BootloaderError("Invalid HID acknowledgement.")
        if reply[8] == 2:
            raise BootloaderError("This firmware does not support runtime bootloader entry.")
        if reply[8]:
            raise BootloaderError(f"Macropad rejected the request (status {reply[8]}).")
        return reply[9:9 + reply[7]]
    raise BootloaderError("No HID acknowledgement; close the configurator or installer and retry.")


def enter_bootloader(hid_module=None):
    if hid_module is None:
        # Keep the optional dependency inside the checkout, outside PIO's own environment.
        dependency_dir = Path(__file__).resolve().parents[1] / ".pio" / "hidapi"
        sys.path.insert(0, str(dependency_dir))
        try:
            import hid as hid_module
        except ImportError as error:
            raise BootloaderError(
                "Install the HID helper dependency with: "
                f'"{sys.executable}" -m pip install --target .pio/hidapi '
                "-r pio-platform/requirements-hid.txt"
            ) from error
    native = configure_macos_hid(hid_module)
    devices = [d for d in hid_module.enumerate(0x1209, 0xC55D)
               if d["usage_page"] == 0xFF00 and d["usage"] == 1]
    if not devices:
        print("No running macropad found (it may already be in bootloader mode).", flush=True)
        return False
    if len(devices) != 1:
        raise UnsafeDeviceError("Multiple macropads found. Connect only the one you want to update.")
    device = hid_module.device()
    try:
        try:
            device.open_path(devices[0]["path"])
        except OSError as error:
            # The Python wrapper reduces every native open error to "open failed".
            detail = native.hid_error(None) if native is not None else None
            permission_hint = (
                "macOS may block native HID access without Input Monitoring permission "
                "for VS Code or the terminal. "
                if sys.platform == "darwin" else ""
            )
            raise BootloaderError(
                f"Could not open the macropad ({detail or error}). {permission_hint}"
                "Close any configurator or installer connection and retry, or use "
                "the browser installer's Enter Bootloader button or hold the encoder "
                "button while reconnecting USB."
            ) from error
        info = request(device, 1, 1)
        if (len(info) != 14 or info[:5] != b"UMAC\x01" or info[6] > 1
                or info[7] != (3 if info[6] else 6) or info[8] != info[7] or info[10] != 128):
            raise UnsafeDeviceError("Unrecognized macropad identity; refusing bootloader entry.")
        if request(device, 0x0A, 2):
            raise BootloaderError("Unexpected bootloader acknowledgement.")
        print(f"{info[7]}-key macropad acknowledged bootloader entry.", flush=True)
        return True
    finally:
        # Disconnection immediately after the acknowledgement is normal.
        try:
            device.close()
        except OSError:
            pass


if __name__ == "__main__":
    try:
        if not enter_bootloader():
            sys.exit(1)
    except (BootloaderError, OSError) as error:
        print(f"Bootloader entry failed: {error}", file=sys.stderr)
        sys.exit(1)
