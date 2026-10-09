"""Read-only fault monitoring and explicit HID class-request experiments.

No upload, reset, kernel-driver detachment, configuration selection or profile
write operations are provided. SET_IDLE changes transient HID report policy.
"""
import argparse
import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

VID, PID = 0x1209, 0xC55D
MODULUS = 1 << 32
READS = (1, 2, 3, 4, 0x71)


class UnsupportedDiagnostic(RuntimeError):
    pass


def request(opcode, sequence, offset=0, length=0):
    if opcode not in READS:
        raise ValueError('Only read opcodes are allowed')
    if not (0 <= offset < 128 and 0 <= length <= 23):
        raise ValueError('Invalid range')
    if opcode in (3, 4):
        if not length or offset + length > 128:
            raise ValueError('Invalid image range')
    elif offset or length:
        raise ValueError('Unexpected range for scalar read')
    packet = bytearray(32)
    packet[:9] = bytes([3, 0x55, 0x4D, 1, opcode, sequence & 255, offset, length, 0])
    return packet


def parse_reply(raw):
    if len(raw) != 32 or bytes(raw[:4]) != b'\x04UM\x01' or raw[7] > 23:
        return None
    return dict(opcode=raw[4], sequence=raw[5], offset=raw[6], status=raw[8],
                data=list(raw[9:9 + raw[7]]))


def decode_fault(data):
    if len(data) != 11 or bytes(data[:3]) != b'FD\1' or data[3] not in (0, 1) or data[4] not in (1, 2):
        raise ValueError('Unexpected fault diagnostic identity')
    if data[5] not in (0, 1) or data[6] not in (0, 1):
        raise ValueError('Invalid validity flags')
    return dict(schema=1, keys=3 if data[3] else 6, buildId=data[4],
                flashValid=bool(data[5]), activeConfigValid=bool(data[6]),
                uptimeMs=int.from_bytes(bytes(data[7:11]), 'little'))


def compare_uptime(previous, current, elapsed_ms, tolerance_ms=2000):
    if elapsed_ms >= MODULUS:
        return 'ambiguous-long-gap'
    if (previous['keys'], previous['buildId']) != (current['keys'], current['buildId']):
        return 'identity-changed'
    delta = (current['uptimeMs'] - previous['uptimeMs']) % MODULUS
    if abs(delta - elapsed_ms) > tolerance_ms:
        return 'possible-restart-or-clock-discontinuity'
    return 'consistent-with-continuous-uptime'


class Logger:
    def __init__(self, path):
        # Exclusive creation protects earlier evidence.
        self.file = Path(path).open('x', buffering=1)

    def __call__(self, event, **fields):
        row = dict(utc=datetime.now(timezone.utc).isoformat(), monotonic=time.monotonic(),
                   event=event, **fields)
        self.file.write(json.dumps(row) + '\n')
        if event not in ('request', 'reply', 'class_request'):
            print(json.dumps(row), flush=True)

    def close(self):
        self.file.close()


class HidLink:
    def __init__(self, device, log, timeout_ms=3000):
        self.device, self.log, self.timeout_ms = device, log, timeout_ms
        self.sequence = 0

    def read(self, opcode, offset=0, length=0):
        packet = request(opcode, self.sequence, offset, length)
        self.sequence = (self.sequence + 1) & 255
        self.log('request', bytes=list(packet))
        if self.device.write(packet) != len(packet):
            raise IOError('Short HID write')
        deadline = time.monotonic() + self.timeout_ms / 1000
        while time.monotonic() < deadline:
            raw = self.device.read(64, 100)
            if not raw or raw[0] != 4:
                continue
            self.log('reply', bytes=list(raw))
            reply = parse_reply(raw)
            if reply is None or (reply['opcode'], reply['sequence'], reply['offset']) != (opcode, packet[5], offset):
                continue
            if reply['status']:
                if opcode == 0x71 and reply['status'] == 2:
                    raise UnsupportedDiagnostic('Firmware has no fault diagnostic; select a prepared diagnostic image')
                raise IOError(f'Device status {reply["status"]} for opcode {opcode}')
            return reply['data']
        raise TimeoutError('HID reply timeout; this alone does not prove a disconnect or restart')

    def identify(self):
        info = self.read(1)
        if len(info) != 14 or bytes(info[:6]) != b'UMAC\x01\x0c' or info[6] not in (0, 1) or info[7] != (3 if info[6] else 6):
            raise ValueError('Expected a format-12 Universal Macropad')
        return info

    def snapshot(self):
        images = {}
        for name, opcode in [('flash', 3), ('active', 4)]:
            image = []
            for offset in range(0, 128, 23):
                length = min(23, 128 - offset)
                chunk = self.read(opcode, offset, length)
                if len(chunk) != length:
                    raise IOError('Short image reply')
                image.extend(chunk)
            images[name] = image
        return dict(**images, identical=images['flash'] == images['active'], atomic=False)


def hid_module():
    try:
        import hid
    except ImportError as error:
        raise RuntimeError('Install tools/investigation/requirements.txt in a virtual environment') from error
    if sys.platform == 'darwin':
        # The installed Python wheel defaults to exclusive opens, even though
        # some upstream HIDAPI revisions default to shared mode. Configure the
        # same loaded extension before any device open; fail rather than seize.
        try:
            library = ctypes.CDLL(hid.__file__)
            library.hid_darwin_set_open_exclusive.argtypes = [ctypes.c_int]
            library.hid_darwin_set_open_exclusive.restype = None
            library.hid_darwin_get_open_exclusive.argtypes = []
            library.hid_darwin_get_open_exclusive.restype = ctypes.c_int
            library.hid_darwin_set_open_exclusive(0)
            if library.hid_darwin_get_open_exclusive() != 0:
                raise RuntimeError('Could not confirm shared HID access')
        except (AttributeError, OSError) as error:
            raise RuntimeError('HIDAPI does not expose the macOS shared-open API; no pad was opened') from error
    return hid


def candidates(hid, serial=None):
    devices = hid.enumerate(VID, PID)
    # macOS exposes HID collections separately. Linux may omit usage metadata.
    devices = [d for d in devices if d.get('usage_page', 0) in (0, 0xff00)
               and (not serial or d.get('serial_number') == serial)]
    return list({d['path']: d for d in devices}.values())


def one_device(hid, serial):
    devices = candidates(hid, serial)
    if len(devices) != 1:
        raise RuntimeError(f'Expected one matching pad; found {len(devices)}. Use --serial if needed.')
    device = hid.device()
    device.open_path(devices[0]['path'])
    return device


def monitor(args, log):
    hid = hid_module()
    device = link = None
    previous = previous_time = previous_presence = None
    started = time.monotonic()
    try:
        while not args.duration or time.monotonic() - started < args.duration:
            paths = sorted(d['path'].hex() for d in candidates(hid, args.serial))
            if paths != previous_presence:
                log('presence_changed', paths=paths, previous=previous_presence)
                previous_presence = paths
                if device:
                    device.close()
                    device = link = None
            if paths and not args.passive:
                try:
                    if device is None:
                        device = one_device(hid, args.serial)
                        link = HidLink(device, log)
                        log('opened', info=link.identify())
                    sent_at = time.monotonic()
                    sample = decode_fault(link.read(0x71))
                    received_at = time.monotonic()
                    sample_time = (sent_at + received_at) / 2
                    classification = 'first-sample' if previous is None else compare_uptime(
                        previous, sample, (sample_time - previous_time) * 1000)
                    log('sample', **sample, continuity=classification, requestLatencyMs=(received_at - sent_at) * 1000)
                    previous, previous_time = sample, sample_time
                    if not sample['flashValid'] or not sample['activeConfigValid']:
                        log('invalid_state', **sample)
                        log('image_capture', **link.snapshot())
                        return 2  # Preserve the first fault; do not reconnect/reapply automatically.
                except UnsupportedDiagnostic:
                    raise
                except (OSError, TimeoutError) as error:
                    log('transport_error', error=str(error))
                    if device:
                        device.close()
                        device = link = None
            time.sleep(args.interval)
    finally:
        if device:
            device.close()
    return 0


def hid_exercise(args, log):
    hid = hid_module()
    device = one_device(hid, args.serial)
    try:
        # Validate identity before generating traffic; original format-12
        # firmware can also be tested before adding diagnostics or the fix.
        link = HidLink(device, log)
        link.identify()
        try:
            log('exercise_identity', **decode_fault(link.read(0x71)))
        except UnsupportedDiagnostic:
            log('exercise_identity', diagnosticSupported=False, buildId=None)
        if not hasattr(device, 'get_input_report'):
            raise RuntimeError('This HIDAPI binding has no get_input_report; update hidapi')
        for iteration in range(args.count):
            data = list(device.get_input_report(args.report, {1: 9, 2: 5, 5: 3}[args.report]))
            validate_input_report(args.report, data)
            # Keyboard contents are deliberately not logged.
            log('class_request', iteration=iteration, request='GET_REPORT', report=args.report, length=len(data))
            time.sleep(args.interval)
        log('exercise_finished', requests=args.count, backend='hid', setIdleTested=False)
    finally:
        device.close()


def validate_input_report(report, data):
    if len(data) != {1: 9, 2: 5, 5: 3}[report] or data[0] != report:
        raise IOError('Unexpected GET_REPORT identity/length; request delivery is not established')


def usb_exercise(args, log):
    try:
        import usb.core
        import usb.util
        import usb.backend.libusb1
        import libusb_package
    except ImportError as error:
        raise RuntimeError('Install tools/investigation/requirements.txt in a virtual environment') from error
    backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)
    if backend is None:
        raise RuntimeError('No libusb backend available')
    devices = list(usb.core.find(find_all=True, idVendor=VID, idProduct=PID, backend=backend))
    if args.serial:
        devices = [d for d in devices if d.serial_number == args.serial]
    if len(devices) != 1:
        raise RuntimeError(f'Expected one matching pad; found {len(devices)}')
    device = devices[0]
    try:
        # Reads the existing configuration; never selects one or detaches HID.
        config = device.get_active_configuration()
        if config[(0, 0)].bInterfaceClass != 3:
            raise RuntimeError('Interface zero is not HID')
        exercise_control(device, args, log)
    finally:
        usb.util.dispose_resources(device)


def exercise_control(device, args, log):
    old_rate = None
    attempted_set = False
    try:
        rate = list(device.ctrl_transfer(0xa1, 2, args.report, 0, 1, timeout=3000))
        if len(rate) != 1:
            raise IOError('Short GET_IDLE response')
        old_rate = rate[0]
        log('idle_baseline', report=args.report, rate=old_rate)
        for iteration in range(args.count):
            attempted_set = True
            result = device.ctrl_transfer(0x21, 0x0a, (args.rate << 8) | args.report, 0, b'', timeout=3000)
            if result != 0:
                raise IOError('Unexpected SET_IDLE transfer length')
            observed = list(device.ctrl_transfer(0xa1, 2, args.report, 0, 1, timeout=3000))
            if observed != [args.rate]:
                raise IOError('GET_IDLE did not confirm the requested rate')
            data = list(device.ctrl_transfer(0xa1, 1, 0x100 | args.report, 0,
                       {1: 9, 2: 5, 5: 3}[args.report], timeout=3000))
            validate_input_report(args.report, data)
            log('class_request', iteration=iteration, request='SET_IDLE+GET_IDLE+GET_REPORT',
                report=args.report, rate=args.rate, length=len(data))
            time.sleep(args.interval)
        log('exercise_finished', requests=args.count, backend='usb', setIdleTested=True)
    finally:
        if old_rate is not None and attempted_set:
            device.ctrl_transfer(0x21, 0x0a, (old_rate << 8) | args.report, 0, b'', timeout=3000)
            restored = list(device.ctrl_transfer(0xa1, 2, args.report, 0, 1, timeout=3000))
            if restored != [old_rate]:
                raise IOError('Idle-rate restoration was not confirmed')
            log('idle_restored', report=args.report, rate=old_rate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', required=True, type=Path, help='New JSONL file; existing files are never overwritten')
    parser.add_argument('--serial')
    sub = parser.add_subparsers(dest='command', required=True)
    mon = sub.add_parser('monitor')
    mon.add_argument('--passive', action='store_true', help='Observe enumeration without opening the pad or sending requests')
    mon.add_argument('--interval', type=float, default=1.0)
    mon.add_argument('--duration', type=float, default=0, help='Seconds; zero runs until Ctrl-C')
    cap = sub.add_parser('capture', help='Read one diagnostic snapshot and saved/active images')
    exercise = sub.add_parser('exercise')
    exercise.add_argument('--backend', choices=['hid', 'usb'], default='hid',
                          help='hid: GET_REPORT only; usb: also SET_IDLE, subject to OS access')
    exercise.add_argument('--report', type=int, choices=[1, 2, 5], default=2)
    exercise.add_argument('--rate', type=int, default=0, help='SET_IDLE rate in units of 4ms')
    exercise.add_argument('--count', type=int, default=100)
    exercise.add_argument('--interval', type=float, default=0.02)
    args = parser.parse_args()
    if getattr(args, 'interval', 1) < 0.001 or getattr(args, 'duration', 0) < 0:
        parser.error('Interval must be at least 0.001 seconds; duration must be nonnegative')
    if args.command == 'exercise' and (args.count < 1 or not 0 <= args.rate <= 255):
        parser.error('Count must be positive and rate must be 0–255')
    log = Logger(args.log)
    try:
        log('start', command=args.command, options={k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()})
        if args.command == 'monitor':
            return monitor(args, log)
        if args.command == 'capture':
            device = one_device(hid_module(), args.serial)
            try:
                link = HidLink(device, log)
                log('identity', info=link.identify())
                log('sample', **decode_fault(link.read(0x71)))
                log('image_capture', **link.snapshot())
            finally:
                device.close()
        else:
            (hid_exercise if args.backend == 'hid' else usb_exercise)(args, log)
        return 0
    except KeyboardInterrupt:
        log('stopped', reason='Ctrl-C')
        return 0
    except Exception as error:
        log('error', error=str(error))
        return 1
    finally:
        log.close()


if __name__ == '__main__':
    sys.exit(main())
