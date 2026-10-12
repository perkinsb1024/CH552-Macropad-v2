#!/usr/bin/env python3
"""Factory 1189:8890 HID experiments on macOS; no firmware programming."""
import argparse
from contextlib import contextmanager
import datetime as dt
import json
import math
import os
import signal
from pathlib import Path
import plistlib
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FACTORY = (0x1189, 0x8890)
WCH = {(0x4348, 0x55E0), (0x1A86, 0x55E0)}
DESCRIPTOR = bytes.fromhex('0600ff0901a1018503090215002600ff750895408106090215002600ff750895409106c0')
SKIP = set(range(1, 19)) | {0xA1, 0xAA, 0xB0}
PROPOSALS = ([bytes([0xAA, c]) for c in [0xA0, *range(0xA2, 0xAA), 0xAB, 0xAC, 0x55, 0x5A, 0xFF]]
             + [bytes([0xA1, c]) for c in [0, 4, 0xFF]]
             + [bytes.fromhex(p) for p in ['55AA', '5AA5', 'F05A', 'FFAA']])


def usb_modules():
    sys.path.insert(0, str(ROOT / '.pio/mac-hid-scan'))
    import usb.core
    import usb.util
    import usb.backend.libusb1
    import libusb_package
    backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)
    if backend is None:
        raise RuntimeError('Bundled libusb backend unavailable.')
    return usb.core, usb.util, backend


def open_target(candidate=None):
    core, util, backend = usb_modules()
    devices = ([candidate] if candidate is not None else
               list(core.find(find_all=True, idVendor=FACTORY[0], idProduct=FACTORY[1], backend=backend)))
    if len(devices) != 1:
        raise RuntimeError(f'Expected one factory USB device, found {len(devices)}.')
    device = devices[0]
    try:
        # Do not set configuration, detach keyboard drivers, or reset the device.
        config = device.get_active_configuration()
        interface = config[(1, 0)]
        if interface.bInterfaceClass != 3:
            raise RuntimeError('Interface 1 is not HID.')
        endpoints = [(e.bEndpointAddress, e.bmAttributes, e.wMaxPacketSize) for e in interface]
        if endpoints != [(2, 3, 64)]:
            raise RuntimeError(f'Unexpected interface 1 endpoints: {endpoints}.')
        util.claim_interface(device, 1)
        descriptor = bytes(device.ctrl_transfer(0x81, 6, 0x2200, 1, 4096, timeout=2000))
        if descriptor != DESCRIPTOR:
            raise RuntimeError('HID descriptor differs from captured factory interface 1.')
        return device, util, descriptor
    except BaseException:
        util.dispose_resources(device)
        raise


def usb_devices(tree):
    result = {}
    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            if node.get('IOObjectClass') == 'IOUSBHostDevice' and 'idVendor' in node:
                dev = {key: node.get(key) for key in
                       ('idVendor', 'idProduct', 'locationID', 'IORegistryEntryID', 'USB Product Name')}
                result[(dev['locationID'], dev['IORegistryEntryID'])] = dev
            walk(node.get('IORegistryEntryChildren', []))
    walk(tree)
    return list(result.values())


def usb_snapshot():
    data = subprocess.run(['/usr/sbin/ioreg', '-a', '-r', '-c', 'IOUSBHostDevice'],
                          capture_output=True, check=True, timeout=5).stdout
    # ioreg exits successfully with empty output when no USB devices match.
    if not data.strip():
        return []
    return usb_devices(plistlib.loads(data))


def identity(dev):
    return dev['idVendor'], dev['idProduct']


def observation(devices, location):
    here = [d for d in devices if d['locationID'] == location]
    if any(identity(d) in WCH for d in here):
        return 'wch_identity_at_target_port'
    if any(identity(d) in WCH for d in devices):
        return 'wch_identity_elsewhere'
    if len(here) == 1 and identity(here[0]) == FACTORY:
        return 'factory'
    return 'missing_or_changed'


def packet(prefix):
    if not 1 <= len(prefix) <= 64:
        raise ValueError('Provide 1..64 payload bytes; report ID 03 is added automatically.')
    return bytes([3]) + bytes(prefix) + bytes(64 - len(prefix))


def hex_bytes(value):
    try:
        result = bytes.fromhex(value)
        packet(result)
        return result
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def byte(value):
    try:
        result = int(value, 16)
        if not 0 <= result <= 255:
            raise ValueError()
        return result
    except ValueError:
        raise argparse.ArgumentTypeError('Expected one hex byte, 00..FF.')


def plan(args):
    if args.mode == 'probe':
        prefixes = args.payload or [bytes([c]) for c in (0x2A, 0x2B, 0x2C)]
    elif args.mode == 'proposals':
        prefixes = PROPOSALS
    elif args.mode == 'first':
        prefixes = [bytes([c]) for c in range(256) if c not in SKIP]
    else:
        prefixes = [bytes([args.prefix, c]) for c in range(256)]
    if not args.include_known and any(p[0] in SKIP for p in prefixes):
        raise ValueError('Known configuration prefix: use --include-known to explicitly enable it.')
    return prefixes * args.repeat


def worker(payload, transport):
    """Isolated USB write: parent timeout bounds native calls and cleanup."""
    device = None
    try:
        device, util, descriptor = open_target()
        report = packet(bytes.fromhex(payload))
        if transport == 'interrupt':
            count = device.write(2, report, timeout=2000)
        else:
            count = device.ctrl_transfer(0x21, 9, 0x0203, 1, report, timeout=2000)
        answer = {'write_bytes': count, 'descriptor_hex': descriptor.hex(),
                  'transport': transport,
                  'write_status': 'complete' if count == 65 else 'short'}
    except Exception as error:
        answer = {'write_status': 'error', 'error': str(error),
                  'errno': getattr(error, 'errno', None)}
    finally:
        if device is not None:
            util.dispose_resources(device)
    print(json.dumps(answer), flush=True)


def event_lines(kind, fields):
    if kind == 'burst_armed':
        action = 'Startup burst' if fields['startup'] else 'Burst'
        lines = [f"ARMED: {action}, {fields['planned']} commands, {fields['budget_ms']}ms budget."]
        if fields['startup']:
            lines += ['Unplug for about 2 seconds, then reconnect on the same USB port.',
                      'Waiting for unplug/reconnect. Press Ctrl+C to cancel.']
        return lines
    if kind == 'startup_armed':
        payload = bytes.fromhex(fields['payload_prefix']).hex(' ').upper()
        return [f'ARMED: Startup packet {payload}.',
                'Unplug for about 2 seconds, then reconnect on the same USB port.',
                'Waiting for unplug/reconnect. Press Ctrl+C to cancel.']
    if kind in ('startup_intent', 'burst_intent'):
        return []
    if kind == 'baseline':
        return [f"Connected to factory pad 1189:8890. Planned: {fields['planned']} commands.",
                'Running. Press Ctrl+C to cancel.']
    if kind == 'attempt':
        payload = bytes.fromhex(fields['payload_prefix']).hex(' ').upper()
        return [f"[{fields['index']}/{fields['planned']}] Sending {payload}"]
    if kind in ('transfer', 'startup_transfer'):
        if fields['write_status'] != 'complete':
            return [f"Transfer {fields['write_status']}: {fields.get('error', 'incomplete report')}"]
        if kind == 'startup_transfer':
            return [f"Transferred {fields['write_bytes']} bytes; started {fields['detection_to_write_ms']:.3f}ms after USB detection."]
        return []
    if kind == 'burst_transfers':
        count = sum(r['write_status'] == 'complete' for r in fields['transfers'])
        return [f"Transferred {count} complete reports in {fields['elapsed_ms']:.3f}ms."]
    if kind == 'observation':
        labels = {'factory': 'Factory device remains (1189:8890).',
                  'wch_identity_at_target_port': 'WCH identity at target port; protocol unconfirmed.',
                  'wch_identity_elsewhere': 'WCH identity at another port; attribution unknown.',
                  'missing_or_changed': 'Device missing or USB identity changed.'}
        return ['USB: ' + labels.get(fields['identity'], fields['identity'])]
    if kind == 'finished':
        outcome = fields['outcome']
        if outcome == 'interrupted':
            return ['CANCELLED: Results saved.']
        if 'no_transition' in outcome or 'no_observed_transition' in outcome:
            counts = f" ({fields.get('completed_writes', 0)}/{fields.get('planned', fields.get('attempts', 0))} complete writes)"
            return ['FINISHED: No bootloader identity observed.' + counts]
        return ['STOPPED: ' + outcome.replace('_', ' ') + '. Results saved.']
    if kind == 'error':
        return ['ERROR: ' + fields['error']]
    return [kind.replace('_', ' ').capitalize() + ': ' + str(fields)]


@contextmanager
def terminal_session():
    """Repair raw serial-session flags for this CLI, restoring prior settings."""
    saved = None
    previous_handler = signal.signal(signal.SIGINT, signal.default_int_handler)
    try:
        import termios
        # Output and input normally share the same terminal. Prefer stdin so
        # Ctrl+C still works if stdout was redirected.
        fd = next((fd for fd in (0, 1, 2) if os.isatty(fd)), None)
        if fd is not None:
            original = termios.tcgetattr(fd)
            attrs = termios.tcgetattr(fd)
            attrs[1] |= termios.OPOST | termios.ONLCR
            attrs[3] |= termios.ISIG
            attrs[6][termios.VINTR] = b'\x03'
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
            saved = (fd, original)
        yield
    finally:
        try:
            if saved is not None:
                termios.tcsetattr(saved[0], termios.TCSANOW, saved[1])
        finally:
            signal.signal(signal.SIGINT, previous_handler)


class Log:
    def __init__(self, path, json_console=False):
        self.file = path.open('x')
        self.json_console = json_console
        if not json_console:
            print('Logs: ' + os.path.relpath(path.parent) + '\n', flush=True)
    def event(self, kind, **fields):
        row = {'event': kind, 'utc': dt.datetime.now(dt.timezone.utc).isoformat(), **fields}
        line = json.dumps(row)
        self.file.write(line + '\n')
        self.file.flush()
        os.fsync(self.file.fileno())
        if self.json_console:
            print(line, flush=True)
        else:
            for text in event_lines(kind, fields):
                print(text, flush=True)
    def close(self):
        self.file.close()


def run(args):
    prefixes = plan(args)
    devices = usb_snapshot()
    factory = [d for d in devices if identity(d) == FACTORY]
    if any(identity(d) in WCH for d in devices):
        raise RuntimeError('A WCH identity is already connected; remove it before baseline attribution.')
    if len(factory) != 1:
        raise RuntimeError(f'Expected one directly connected factory pad, found {len(factory)}. '
                           'Connect it to the Mac, outside the RP2350.')
    location = factory[0]['locationID']
    # Inspect/open/descriptor validation happens before every native write.
    args.output.mkdir(parents=True, exist_ok=False)
    log = Log(args.output / 'events.jsonl', json_console=getattr(args, 'json', False))
    attempts = completed = 0
    outcome = 'interrupted'
    try:
        log.event('baseline', usb_devices=devices, location=location, planned=len(prefixes),
                  observe_ms=round(args.observe * 1000),
                  transport=args.transport,
                  scope='Output report 03, 64-byte zero-padded payload; no forced reset or power cycle')
        baseline_end = time.monotonic() + args.observe
        while time.monotonic() < baseline_end:
            if observation(usb_snapshot(), location) != 'factory':
                raise RuntimeError('Factory baseline was unstable before any probe.')
            time.sleep(0.1)
        for prefix in prefixes:
            before = usb_snapshot()
            if observation(before, location) != 'factory':
                outcome = 'pre_probe_identity_changed'
                log.event('stopped', usb_devices=before, outcome=outcome)
                break
            attempts += 1
            # Persist intent first: timeout/interruption may leave delivery unknown.
            log.event('attempt', index=attempts, planned=len(prefixes), payload_prefix=prefix.hex(),
                      packet_hex=packet(prefix).hex())
            try:
                process = subprocess.run([sys.executable, str(Path(__file__).resolve()),
                                          '_write', prefix.hex(), args.transport], capture_output=True,
                                         text=True, timeout=args.write_timeout)
                if process.returncode:
                    transfer = {'write_status': 'worker_failed', 'error': process.stderr}
                else:
                    transfer = json.loads(process.stdout)
            except subprocess.TimeoutExpired:
                transfer = {'write_status': 'timeout', 'delivery': 'unknown'}
            log.event('transfer', index=attempts, **transfer)
            if transfer['write_status'] == 'complete':
                completed += 1
            deadline = time.monotonic() + args.observe
            seen = 'factory'
            last = before
            while time.monotonic() < deadline:
                last = usb_snapshot()
                seen = observation(last, location)
                if seen != 'factory':
                    break
                time.sleep(0.1)
            log.event('observation', index=attempts, identity=seen, usb_devices=last)
            if seen != 'factory':
                outcome = seen
                break
            if transfer['write_status'] != 'complete':
                outcome = 'write_uncertain'
                break
        else:
            outcome = 'plan_complete_no_transition'
    except KeyboardInterrupt:
        outcome = 'interrupted'
    except Exception as error:
        outcome = 'error'
        log.event('error', error=str(error))
    finally:
        summary = {'outcome': outcome, 'attempts': attempts, 'completed_writes': completed,
                   'planned': len(prefixes), 'bootloader_protocol_confirmed': False,
                   'limitations': 'WCH VID/PID is a lead only; no A1 bulk confirmation. '
                                  'No application acknowledgement, forced reset, or power-cycle isolation.'}
        log.event('finished', **summary)
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        log.close()
    return 130 if outcome == 'interrupted' else 0 if outcome == 'plan_complete_no_transition' else 2


def await_reconnection(find, sleep, deadline, clock):
    # Require observed absence; an already-running device is never a startup trial.
    while find():
        if clock() >= deadline:
            raise TimeoutError('No disconnection observed before timeout.')
        sleep(0.01)
    while True:
        if clock() >= deadline:
            raise TimeoutError('No reconnection observed before timeout.')
        devices = find()
        if len(devices) > 1:
            raise RuntimeError('Multiple factory devices appeared.')
        if devices:
            return devices[0], clock()
        sleep(0.01)


def startup_run(args):
    if not args.payload or len(args.payload) != 1 or args.repeat != 1:
        raise ValueError('startup requires exactly one --payload and --repeat 1.')
    prefix = args.payload[0]
    if prefix[0] in SKIP and not args.include_known:
        raise ValueError('Known configuration prefix requires --include-known.')
    devices = usb_snapshot()
    factory = [d for d in devices if identity(d) == FACTORY]
    if len(factory) != 1 or any(identity(d) in WCH for d in devices):
        raise RuntimeError('Arm startup mode with exactly one factory pad connected and no WCH device.')
    location = factory[0]['locationID']
    core, util, backend = usb_modules()  # Warm imports/backend before the replug.
    find = lambda: list(core.find(find_all=True, idVendor=FACTORY[0], idProduct=FACTORY[1], backend=backend))
    args.output.mkdir(parents=True, exist_ok=False)
    log = Log(args.output / 'events.jsonl', json_console=getattr(args, 'json', False))
    attempts = completed = 0
    outcome = 'interrupted'
    device = None
    try:
        log.event('startup_armed', location=location, usb_devices=devices,
                  payload_prefix=prefix.hex(), transport=args.transport,
                  instructions='Unplug and reconnect the pad on the same USB port.',
                  wait_seconds=args.connect_timeout)
        # Persist exact intent before waiting, to avoid fsync/process launch after detection.
        log.event('startup_intent', packet_hex=packet(prefix).hex())
        candidate, detected = await_reconnection(find, time.sleep,
                                                 time.monotonic() + args.connect_timeout,
                                                 time.monotonic)
        device, util, descriptor = open_target(candidate)
        write_started = time.monotonic()
        attempts = 1
        try:
            if args.transport == 'interrupt':
                count = device.write(2, packet(prefix), timeout=2000)
            else:
                count = device.ctrl_transfer(0x21, 9, 0x0203, 1, packet(prefix), timeout=2000)
            transfer = {'write_status': 'complete' if count == 65 else 'short', 'write_bytes': count}
            completed = int(count == 65)
        except Exception as error:
            transfer = {'write_status': 'error', 'error': str(error), 'delivery': 'unknown'}
        elapsed = time.monotonic() - detected
        util.dispose_resources(device)
        device = None
        log.event('startup_transfer', **transfer, descriptor_hex=descriptor.hex(),
                  detection_to_write_ms=round((write_started - detected) * 1000, 3),
                  detection_to_completion_ms=round(elapsed * 1000, 3),
                  timing_reference='First libusb visibility, not electrical power-on')
        end = time.monotonic() + args.observe
        seen = 'factory'
        while time.monotonic() < end:
            after = usb_snapshot()
            seen = observation(after, location)
            if seen != 'factory':
                break
            time.sleep(0.1)
        log.event('observation', identity=seen, usb_devices=after)
        outcome = (seen if seen != 'factory' else
                   'startup_complete_no_transition' if completed else 'write_uncertain')
    except KeyboardInterrupt:
        outcome = 'interrupted'
    except Exception as error:
        outcome = 'error'
        log.event('error', error=str(error))
    finally:
        if device is not None:
            util.dispose_resources(device)
        summary = {'outcome': outcome, 'attempts': attempts, 'completed_writes': completed,
                   'bootloader_protocol_confirmed': False, 'payload_prefix': prefix.hex(),
                   'limitations': 'No access before USB enumeration. Timing measured from first libusb visibility. '
                                  'Manual same-port replug; no electrical power-on timestamp. No A1 confirmation.'}
        log.event('finished', **summary)
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        log.close()
    return 130 if outcome == 'interrupted' else 0 if outcome == 'startup_complete_no_transition' else 2


def burst_plan(args):
    if args.payload:
        prefixes = args.payload * args.repeat
    else:
        prefixes = [bytes([c]) for c in range(args.start_byte, args.end_byte + 1)
                    if args.include_known or c not in SKIP] * args.repeat
    if not args.include_known and any(p[0] in SKIP for p in prefixes):
        raise ValueError('Known configuration prefix requires --include-known.')
    if not prefixes:
        raise ValueError('No candidates in the selected range.')
    return prefixes


def send_burst(device, reports, seconds, reference, clock=time.monotonic, rows=None):
    """No disk writes, stdout, pauses, or USB identity checks inside the burst."""
    rows = [] if rows is None else rows
    deadline = reference + seconds
    for index, report in enumerate(reports, 1):
        started = clock()
        # Two transactions per 65-byte report; reserve 25ms for a healthy write.
        if deadline - started < 0.025:
            break
        timeout = max(1, min(2000, math.ceil((deadline - started) * 1000)))
        row = {'index': index, 'start_ms': round((started - reference) * 1000, 3),
               'write_status': 'interrupted', 'delivery': 'unknown'}
        rows.append(row)
        try:
            count = device.write(2, report, timeout=timeout)
            row.update(write_status='complete' if count == len(report) else 'short', write_bytes=count)
            row.pop('delivery', None)
        except Exception as error:
            row.update(write_status='error', error=str(error), delivery='unknown')
        row['end_ms'] = round((clock() - reference) * 1000, 3)
        if row['write_status'] != 'complete':
            break
    return rows


def burst_run(args):
    if args.transport != 'interrupt':
        raise ValueError('Burst mode currently requires interrupt transport.')
    prefixes = burst_plan(args)
    reports = [packet(p) for p in prefixes]  # Preconstruct before startup detection.
    devices = usb_snapshot()
    factory = [d for d in devices if identity(d) == FACTORY]
    if len(factory) != 1 or any(identity(d) in WCH for d in devices):
        raise RuntimeError('Arm with exactly one factory pad connected and no WCH device.')
    location = factory[0]['locationID']
    core, util, backend = usb_modules()
    args.output.mkdir(parents=True, exist_ok=False)
    log = Log(args.output / 'events.jsonl', json_console=getattr(args, 'json', False))
    device = None
    rows = []
    outcome = 'interrupted'
    reference = None
    startup = args.mode == 'startup-burst'
    burst_logged = False
    try:
        log.event('burst_armed', startup=startup, location=location, usb_devices=devices,
                  planned=len(reports), budget_ms=round(args.burst_seconds * 1000),
                  instructions='Unplug/reconnect on the same USB port.' if startup else 'Sending on running pad.')
        log.event('burst_intent', packets_hex=[r.hex() for r in reports],
                  payload_prefixes=[p.hex() for p in prefixes])
        if startup:
            find = lambda: list(core.find(find_all=True, idVendor=FACTORY[0], idProduct=FACTORY[1], backend=backend))
            candidate, reference = await_reconnection(find, time.sleep,
                                                       time.monotonic() + args.connect_timeout,
                                                       time.monotonic)
            device, util, descriptor = open_target(candidate)
        else:
            device, util, descriptor = open_target()
            reference = time.monotonic()
        send_burst(device, reports, args.burst_seconds, reference, clock=time.monotonic, rows=rows)
        ended_ms = round((time.monotonic() - reference) * 1000, 3)
        # One registry snapshot after a short settling delay, without per-command checks.
        time.sleep(args.settle)
        after = usb_snapshot()
        seen = observation(after, location)
        checked_ms = round((time.monotonic() - reference) * 1000, 3)
        log.event('burst_transfers', transfers=rows, elapsed_ms=ended_ms,
                  descriptor_hex=descriptor.hex(),
                  timing_reference='First libusb visibility' if startup else 'After interface validation')
        burst_logged = True
        log.event('observation', identity=seen, usb_devices=after, check_ms=checked_ms)
        if seen != 'factory':
            outcome = seen
        elif rows and rows[-1]['write_status'] != 'complete':
            outcome = 'write_uncertain'
        elif len(rows) == len(reports):
            outcome = 'burst_plan_complete_no_observed_transition'
        else:
            outcome = 'burst_budget_reached_no_observed_transition'
    except KeyboardInterrupt:
        outcome = 'interrupted'
    except Exception as error:
        outcome = 'error'
        log.event('error', error=str(error))
    finally:
        if rows and not burst_logged:
            log.event('burst_transfers', transfers=rows,
                      elapsed_ms=round((time.monotonic() - reference) * 1000, 3),
                      interrupted=True)
        if device is not None:
            util.dispose_resources(device)
        completed = [r for r in rows if r['write_status'] == 'complete']
        summary = {'outcome': outcome, 'planned': len(reports), 'attempts': len(rows),
                   'completed_writes': len(completed),
                   'completed_within_budget': sum(r.get('end_ms', math.inf) <= args.burst_seconds * 1000 for r in completed),
                   'tested_prefixes': [prefixes[r['index'] - 1].hex() for r in completed],
                   'budget_ms': round(args.burst_seconds * 1000), 'startup': startup,
                   'settle_ms': round(args.settle * 1000),
                   'bootloader_protocol_confirmed': False,
                   'limitations': 'Single post-burst USB registry check only; intermediate/delayed transitions may be missed. '
                                  'No application acknowledgement or A1 confirmation. '
                                  'Startup timing starts at USB visibility, not power-on. '
                                  'Multiple packets prevent individual attribution. Partial writes may have occurred on timeout.'}
        log.event('finished', **summary)
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        log.close()
    return 130 if outcome == 'interrupted' else 0 if outcome.startswith('burst_') else 2


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '_write':
        worker(sys.argv[2], sys.argv[3])
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['inspect', 'probe', 'first', 'second', 'proposals', 'startup', 'burst', 'startup-burst'])
    parser.add_argument('--json', action='store_true', help='Print raw JSON events instead of readable progress.')
    parser.add_argument('--payload', action='append', type=hex_bytes,
                        help='Explicit payload prefix in hex, e.g. "2B" or "F0 5A" (probe mode).')
    parser.add_argument('--prefix', type=byte, help='Fixed first byte for second-byte sweep.')
    parser.add_argument('--transport', choices=['interrupt', 'control'], default='interrupt')
    parser.add_argument('--connect-timeout', type=float, default=120, help='Seconds to wait for a manual startup replug.')
    parser.add_argument('--settle', type=float, default=0.5, help='Seconds after burst before the single identity check.')
    parser.add_argument('--burst-seconds', type=float, default=1, help='Burst time budget in seconds.')
    parser.add_argument('--start-byte', type=byte, default=0, help='First-byte range start in hex for bursts.')
    parser.add_argument('--end-byte', type=byte, default=255, help='First-byte range end in hex for bursts.')
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--observe', type=float, default=1.0, help='Seconds per observation window.')
    parser.add_argument('--write-timeout', type=float, default=5.0)
    parser.add_argument('--include-known', action='store_true')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent / 'output' /
                        dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    args = parser.parse_args()
    if (args.repeat < 1 or not math.isfinite(args.observe) or args.observe < 1
            or not math.isfinite(args.write_timeout) or args.write_timeout <= 0
            or not math.isfinite(args.connect_timeout) or args.connect_timeout <= 0
            or not math.isfinite(args.burst_seconds) or args.burst_seconds <= 0
            or not math.isfinite(args.settle) or args.settle < 0):
        parser.error('repeat >= 1, observe >= 1s, write-timeout > 0 required.')
    if args.mode == 'second' and args.prefix is None:
        parser.error('second requires --prefix.')
    if args.start_byte > args.end_byte:
        parser.error('start-byte must be <= end-byte.')
    if args.payload and args.mode not in ('probe', 'startup', 'burst', 'startup-burst'):
        parser.error('--payload is only valid in probe/startup mode.')
    if args.prefix is not None and args.mode != 'second':
        parser.error('--prefix is only valid in second mode.')
    try:
        if sys.platform != 'darwin':
            raise RuntimeError('This CLI requires macOS.')
        if args.mode == 'inspect':
            devices = usb_snapshot()
            details = {'usb_devices': devices}
            if any(identity(d) == FACTORY for d in devices):
                device, util, descriptor = open_target()
                details['validated_interface'] = 1
                details['report_descriptor_hex'] = descriptor.hex()
                util.dispose_resources(device)
            if args.json:
                print(json.dumps(details, indent=2))
            else:
                if not devices:
                    print('No USB devices connected.')
                for dev in devices:
                    print(f"USB {dev['idVendor']:04X}:{dev['idProduct']:04X} at port {dev['locationID']:#x}")
                if 'validated_interface' in details:
                    print('Factory interface 1 validated: report 03, 64-byte payload.')
            return 0
        if args.mode in ('burst', 'startup-burst'):
            return burst_run(args)
        return startup_run(args) if args.mode == 'startup' else run(args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    try:
        with terminal_session():
            result = main()
    except KeyboardInterrupt:
        print('CANCELLED.', file=sys.stderr, flush=True)
        result = 130
    sys.exit(result)
