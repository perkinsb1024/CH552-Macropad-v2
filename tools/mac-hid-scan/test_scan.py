import argparse
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import scan

FACTORY = {'idVendor': 0x1189, 'idProduct': 0x8890, 'locationID': 7, 'IORegistryEntryID': 10}


class Tests(unittest.TestCase):
    def args(self, output, **kw):
        defaults = dict(mode='probe', payload=None, prefix=None, repeat=1, include_known=False,
                        observe=1, write_timeout=5, output=output, transport='interrupt', connect_timeout=120)
        return argparse.Namespace(**(defaults | kw))

    def test_scope_and_packets(self):
        args = self.args(Path('unused'), mode='first')
        prefixes = scan.plan(args)
        self.assertEqual(len(prefixes), 235)
        self.assertEqual(len(set(prefixes)), 235)
        self.assertNotIn(b'\xaa', prefixes)
        self.assertEqual(scan.packet(bytes.fromhex('2b5a')), b'\x03\x2b\x5a' + bytes(62))
        args = self.args(Path('unused'), mode='second', prefix=0xAA)
        with self.assertRaises(ValueError):
            scan.plan(args)
        args.include_known = True
        self.assertEqual(len(scan.plan(args)), 256)

    def test_reconnection_waits_for_absence(self):
        find = Mock(side_effect=[[object()], [object()], [], [], ['new device']])
        clock = Mock(side_effect=range(10))
        sleep = Mock()
        device, detected = scan.await_reconnection(find, sleep, 100, clock)
        self.assertEqual(device, 'new device')
        self.assertEqual(find.call_count, 5)
        self.assertEqual(sleep.call_count, 3)

    def test_reconnection_timeout_and_multiple_devices(self):
        with self.assertRaises(TimeoutError):
            scan.await_reconnection(lambda: [object()], Mock(), 1, lambda: 2)
        with self.assertRaises(RuntimeError):
            scan.await_reconnection(Mock(side_effect=[[], [1, 2]]), Mock(), 100, lambda: 0)

    def test_startup_sends_only_after_reconnection(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'run'
            args = self.args(output, mode='startup', payload=[bytes.fromhex('AA55')], include_known=True)
            dev, util = Mock(), Mock()
            dev.write.return_value = 65
            ticks = iter(x * 0.1 for x in range(100))
            def reconnected(*unused):
                rows = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
                self.assertEqual(rows[-1]['event'], 'startup_intent')
                dev.write.assert_not_called()
                return dev, 0.1
            with patch.object(scan, 'usb_snapshot', return_value=[FACTORY]), patch.object(scan, 'usb_modules', return_value=(Mock(), util, object())), patch.object(scan, 'await_reconnection', side_effect=reconnected), patch.object(scan, 'open_target', return_value=(dev, util, scan.DESCRIPTOR)) as opened, patch.object(scan.time, 'monotonic', side_effect=lambda: next(ticks)), patch.object(scan.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(scan.startup_run(args), 0)
            dev.write.assert_called_once_with(2, bytes.fromhex('03AA55') + bytes(62), timeout=2000)
            opened.assert_called_once_with(dev)
            summary = json.loads((output / 'summary.json').read_text())
            self.assertEqual(summary['completed_writes'], 1)
            self.assertEqual(summary['outcome'], 'startup_complete_no_transition')
            rows = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
            self.assertEqual(rows[2]['timing_reference'], 'First libusb visibility, not electrical power-on')

    def test_two_byte_proposals(self):
        args = self.args(Path('unused'), mode='proposals', include_known=True)
        candidates = scan.plan(args)
        self.assertEqual(len(candidates), 21)
        self.assertEqual(len(set(candidates)), 21)
        self.assertIn(bytes.fromhex('AAA2'), candidates)
        self.assertIn(bytes.fromhex('A100'), candidates)
        self.assertNotIn(bytes.fromhex('AAAA'), candidates)
        self.assertEqual(scan.plan(self.args(Path('unused'), mode='second', prefix=0xAA,
                                            include_known=True)),
                         [bytes([0xAA, c]) for c in range(256)])

    def test_empty_usb_registry(self):
        process = subprocess.CompletedProcess([], 0, stdout=b'')
        with patch.object(scan.subprocess, 'run', return_value=process):
            self.assertEqual(scan.usb_snapshot(), [])

    def test_burst_deadline_and_failures(self):
        device = Mock()
        device.write.return_value = 65
        clock = Mock(side_effect=[0, 0.4, 0.4, 0.8, 1.0])
        rows = scan.send_burst(device, [scan.packet(b'\x00')] * 3, 1, 0, clock)
        self.assertEqual(len(rows), 2)
        self.assertEqual(device.write.call_count, 2)
        self.assertEqual(device.write.call_args.kwargs['timeout'], 600)
        device = Mock()
        device.write.side_effect = TimeoutError('timed out')
        rows = scan.send_burst(device, [scan.packet(b'\x00')] * 3, 1, 0,
                               Mock(side_effect=[0, 1.01]))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['delivery'], 'unknown')
        device = Mock()
        device.write.return_value = 64
        rows = scan.send_burst(device, [scan.packet(b'\x00')] * 3, 1, 0,
                               Mock(side_effect=[0, 0.01]))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['write_status'], 'short')

    def test_burst_reserves_time_and_preserves_interrupted_intent(self):
        dev = Mock()
        rows = scan.send_burst(dev, [scan.packet(b'\x00')], 1, 0, Mock(return_value=0.99))
        self.assertEqual(rows, [])
        dev.write.assert_not_called()
        dev.write.side_effect = KeyboardInterrupt()
        persisted = []
        with self.assertRaises(KeyboardInterrupt):
            scan.send_burst(dev, [scan.packet(b'\x00')], 1, 0, Mock(return_value=0), rows=persisted)
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]['delivery'], 'unknown')

    def test_burst_range_and_prepared_reports(self):
        args = self.args(Path('unused'), start_byte=0, end_byte=255)
        self.assertEqual(len(scan.burst_plan(args)), 235)
        args.start_byte = 0x40
        args.end_byte = 0x4F
        self.assertEqual(scan.burst_plan(args), [bytes([c]) for c in range(0x40, 0x50)])
        args.payload = [b'\x00']
        args.repeat = 100
        self.assertEqual(len(scan.burst_plan(args)), 100)

    def test_startup_burst_logs_before_writes_and_checks_once(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'run'
            args = self.args(output, mode='startup-burst', payload=[b'\x00', b'\x13'],
                             burst_seconds=1, start_byte=0, end_byte=255, settle=0.5)
            dev, util = Mock(), Mock()
            ticks = iter(x * 0.05 for x in range(100))
            def write(*unused, **kwargs):
                rows = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
                self.assertEqual([r['event'] for r in rows], ['burst_armed', 'burst_intent'])
                return 65
            dev.write.side_effect = write
            with patch.object(scan, 'usb_snapshot', return_value=[FACTORY]) as snapshot, patch.object(scan, 'usb_modules', return_value=(Mock(), util, object())), patch.object(scan, 'await_reconnection', return_value=(dev, 0.05)), patch.object(scan, 'open_target', return_value=(dev, util, scan.DESCRIPTOR)), patch.object(scan.time, 'monotonic', side_effect=lambda: next(ticks)), patch.object(scan.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(scan.burst_run(args), 0)
            self.assertEqual(snapshot.call_count, 2)  # Baseline plus one post-burst check.
            sleep.assert_called_once_with(0.5)
            self.assertEqual(dev.write.call_count, 2)
            summary = json.loads((output / 'summary.json').read_text())
            self.assertEqual(summary['completed_writes'], 2)
            self.assertEqual(summary['outcome'], 'burst_plan_complete_no_observed_transition')

    def test_registry_identity(self):
        tree = [{'IOObjectClass': 'IOUSBHostDevice', **FACTORY,
                 'IORegistryEntryChildren': [{'IOObjectClass': 'IOUSBHostInterface', **FACTORY}]}]
        self.assertEqual(len(scan.usb_devices(tree)), 1)
        self.assertEqual(scan.observation([FACTORY], 7), 'factory')
        wch = dict(FACTORY, idVendor=0x4348, idProduct=0x55E0)
        self.assertEqual(scan.observation([wch], 7), 'wch_identity_at_target_port')
        self.assertEqual(scan.observation([wch], 8), 'wch_identity_elsewhere')
        self.assertEqual(scan.observation([], 7), 'missing_or_changed')

    def test_descriptor_mismatch_prevents_write(self):
        dev = Mock()
        config = Mock()
        interface = Mock()
        interface.bInterfaceClass = 3
        ep = argparse.Namespace(bEndpointAddress=2, bmAttributes=3, wMaxPacketSize=64)
        config.__getitem__ = Mock(return_value=interface)
        interface.__iter__ = Mock(return_value=iter([ep]))
        dev.get_active_configuration.return_value = config
        dev.ctrl_transfer.return_value = b'wrong descriptor'
        core, util = Mock(), Mock()
        core.find.return_value = [dev]
        with patch.object(scan, 'usb_modules', return_value=(core, util, object())):
            with self.assertRaisesRegex(RuntimeError, 'descriptor differs'):
                scan.open_target()
        dev.write.assert_not_called()
        util.dispose_resources.assert_called_once_with(dev)

    def test_worker_transport(self):
        for transport in ('interrupt', 'control'):
            dev = Mock()
            dev.write.return_value = 65
            dev.ctrl_transfer.return_value = 65
            util = Mock()
            with patch.object(scan, 'open_target', return_value=(dev, util, scan.DESCRIPTOR)), contextlib.redirect_stdout(io.StringIO()) as out:
                scan.worker('2b', transport)
            self.assertEqual(json.loads(out.getvalue())['write_status'], 'complete')
            if transport == 'interrupt':
                dev.write.assert_called_once_with(2, b'\x03\x2b' + bytes(63), timeout=2000)
            else:
                dev.ctrl_transfer.assert_called_once_with(0x21, 9, 0x0203, 1, b'\x03\x2b' + bytes(63), timeout=2000)
            util.dispose_resources.assert_called_once_with(dev)

    def session(self, result=None, after=None):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'run'
            ticks = iter(x * 0.4 for x in range(1000))
            writes = []
            def fake_process(*args, **kwargs):
                # Intent is durable BEFORE a USB worker can transmit.
                log = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
                self.assertEqual(log[-1]['event'], 'attempt')
                writes.append(args[0])
                if isinstance(result, Exception):
                    raise result
                return subprocess.CompletedProcess(args[0], 0, json.dumps(result or {'write_status': 'complete', 'write_bytes': 65}), '')
            def snapshot():
                return after if after is not None and writes else [FACTORY]
            with patch.object(scan, 'usb_snapshot', side_effect=snapshot), patch.object(scan.time, 'monotonic', side_effect=lambda: next(ticks)), patch.object(scan.time, 'sleep'), patch.object(scan.subprocess, 'run', side_effect=fake_process), contextlib.redirect_stdout(io.StringIO()):
                scan.run(self.args(output))
            summary = json.loads((output / 'summary.json').read_text())
            events = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
            return summary, events, writes

    def test_full_targeted_plan(self):
        summary, events, writes = self.session()
        self.assertEqual(summary['outcome'], 'plan_complete_no_transition')
        self.assertEqual(summary['completed_writes'], 3)
        self.assertEqual([w[-2] for w in writes], ['2a', '2b', '2c'])
        self.assertFalse(summary['bootloader_protocol_confirmed'])

    def test_timeout_stops_without_retry(self):
        summary, events, writes = self.session(subprocess.TimeoutExpired('worker', 5))
        self.assertEqual(summary['outcome'], 'write_uncertain')
        self.assertEqual(len(writes), 1)
        self.assertEqual(events[2]['delivery'], 'unknown')

    def test_transition_stops_without_claiming_confirmation(self):
        wch = dict(FACTORY, idVendor=0x4348, idProduct=0x55E0)
        summary, events, writes = self.session(after=[wch])
        self.assertEqual(summary['outcome'], 'wch_identity_at_target_port')
        self.assertFalse(summary['bootloader_protocol_confirmed'])
        self.assertEqual(len(writes), 1)

    def test_disappearance_stops(self):
        summary, events, writes = self.session(after=[])
        self.assertEqual(summary['outcome'], 'missing_or_changed')
        self.assertEqual(len(writes), 1)


if __name__ == '__main__':
    unittest.main()
