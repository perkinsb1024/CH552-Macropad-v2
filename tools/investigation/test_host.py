"""Host-tool tests use fake transports and never access attached USB devices."""
import argparse
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from unittest.mock import Mock
import sys

import host


class Terminal(io.StringIO):
    def isatty(self):
        return True


def reply(opcode=0x71, sequence=0, offset=0, status=0, data=None):
    data = [70, 68, 1, 0, 1, 1, 1, 0, 0, 0, 0] if data is None else data
    return list(bytes([4, 85, 77, 1, opcode, sequence, offset, len(data), status]) + bytes(data) + bytes(23 - len(data)))


class FakeHid:
    def __init__(self, packets):
        self.packets = packets
        self.writes = []
        self.closed = False

    def write(self, packet):
        self.writes.append(packet)
        return len(packet)

    def read(self, length, timeout):
        return self.packets.pop(0) if self.packets else []

    def close(self):
        self.closed = True


class FakeControl:
    def __init__(self, fail=False):
        self.calls = []
        self.rate = 7
        self.fail = fail

    def ctrl_transfer(self, kind, request, value, interface, data, timeout):
        self.calls.append((kind, request, value, interface, data))
        if (kind, request) == (0xa1, 2):
            return [self.rate]
        if (kind, request) == (0x21, 0x0a):
            self.rate = value >> 8
            return 0
        if (kind, request) == (0xa1, 1):
            if self.fail:
                raise IOError('Injected GET_REPORT failure')
            return [2, 0, 0, 0, 0]
        raise AssertionError('Unexpected USB operation')


class Tests(unittest.TestCase):
    def test_progress_format_completion_and_redirect(self):
        stream = Terminal()
        progress = host.MonitorProgress(600, stream)
        progress.update(296)
        self.assertTrue(stream.getvalue().endswith('4:56 [#########           ] 10:00'))
        progress.finish(601)
        self.assertTrue(stream.getvalue().endswith('10:00 [####################] 10:00\n'))
        stream = io.StringIO()
        progress = host.MonitorProgress(600, stream)
        progress.update(296)
        progress.finish(600)
        self.assertEqual(stream.getvalue(), '')
        stream = Terminal()
        progress = host.MonitorProgress(0, stream)
        progress.finish(61)
        self.assertTrue(stream.getvalue().endswith('1:01 [monitoring; Ctrl-C to stop]\n'))

    def test_timed_progress_in_both_monitor_modes(self):
        for passive in (False, True):
            stream = Terminal()
            clock = [0]
            def sleep(seconds):
                clock[0] += seconds
            args = argparse.Namespace(serial=None, passive=passive, duration=2, interval=1)
            device = FakeHid([])
            link = Mock()
            link.read.return_value = reply()[9:20]
            with patch('host.sys.stderr', stream), \
                 patch('host.time.monotonic', side_effect=lambda: clock[0]), \
                 patch('host.time.sleep', side_effect=sleep), \
                 patch('host.hid_module', return_value=object()), \
                 patch('host.candidates', return_value=[dict(path=b'pad')]), \
                 patch('host.one_device', return_value=device) as opened, \
                 patch('host.HidLink', return_value=link):
                self.assertEqual(host.monitor(args, lambda *a, **kw: None), 0)
            self.assertIn('0:01 [##########          ] 0:02', stream.getvalue())
            self.assertTrue(stream.getvalue().endswith('0:02 [####################] 0:02\n'))
            if passive:
                opened.assert_not_called()
            else:
                self.assertTrue(device.closed)

    def test_progress_keeps_console_events_and_jsonl_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.jsonl'
            stream = Terminal()
            log = host.Logger(path)
            log.progress = host.MonitorProgress(600, stream)
            log.progress.update(296)
            with patch('host.sys.stdout', new_callable=io.StringIO) as console:
                log('sample', uptimeMs=123)
            log.close()
            self.assertEqual(json.loads(path.read_text())['uptimeMs'], 123)
            self.assertEqual(json.loads(console.getvalue())['event'], 'sample')
            self.assertTrue(stream.getvalue().endswith('4:56 [#########           ] 10:00'))

    def test_macos_shared_mode_before_open(self):
        module = Mock(__file__='fake-hid.so')
        library = Mock()
        library.hid_darwin_get_open_exclusive.return_value = 0
        with patch.dict(sys.modules, hid=module), patch('host.sys.platform', 'darwin'), \
             patch('host.ctypes.CDLL', return_value=library):
            self.assertIs(host.hid_module(), module)
        library.hid_darwin_set_open_exclusive.assert_called_once_with(0)
        module.device.assert_not_called()
        library.hid_darwin_get_open_exclusive.return_value = 1
        with patch.dict(sys.modules, hid=module), patch('host.sys.platform', 'darwin'), \
             patch('host.ctypes.CDLL', return_value=library):
            with self.assertRaises(RuntimeError):
                host.hid_module()

    def test_read_only_packets(self):
        for opcode in (5, 6, 7, 8, 9, 0x70, 255):
            with self.assertRaises(ValueError):
                host.request(opcode, 0)
        with self.assertRaises(ValueError):
            host.request(3, 0, 127, 2)
        with self.assertRaises(ValueError):
            host.request(0x71, 0, 0, 1)
        self.assertEqual(host.request(4, 257, 127, 1)[:9], bytes([3, 85, 77, 1, 4, 1, 127, 1, 0]))

    def test_reply_matching(self):
        fake = FakeHid([[2, 0, 0, 0, 0], reply(sequence=255), reply()])
        rows = []
        link = host.HidLink(fake, lambda event, **fields: rows.append(event))
        result = host.decode_fault(link.read(0x71))
        self.assertEqual(result['buildId'], 1)
        self.assertEqual(rows, ['request', 'reply', 'reply'])

    def test_unsupported_and_malformed(self):
        link = host.HidLink(FakeHid([reply(status=2, data=[])]), lambda *a, **kw: None)
        with self.assertRaises(host.UnsupportedDiagnostic):
            link.read(0x71)
        self.assertIsNone(host.parse_reply(reply()[:-1]))
        data = reply()[9:20]
        data[5] = 2
        with self.assertRaises(ValueError):
            host.decode_fault(data)

    def test_clock_wrap_and_restart(self):
        def sample(uptime, build=1):
            return dict(keys=6, buildId=build, uptimeMs=uptime)
        self.assertEqual(host.compare_uptime(sample(0xffffff00), sample(744), 1000), 'consistent-with-continuous-uptime')
        self.assertEqual(host.compare_uptime(sample(100000), sample(300), 1000), 'possible-restart-or-clock-discontinuity')
        # A restart can leave uptime greater than the preceding sample.
        self.assertEqual(host.compare_uptime(sample(1000), sample(2000), 10000), 'possible-restart-or-clock-discontinuity')
        self.assertEqual(host.compare_uptime(sample(0), sample(0), 1 << 32), 'ambiguous-long-gap')
        self.assertEqual(host.compare_uptime(sample(0), sample(0, 2), 0), 'identity-changed')

    def test_capture_only_reads_images(self):
        packets = []
        sequence = 0
        for opcode in (3, 4):
            for offset in range(0, 128, 23):
                length = min(23, 128 - offset)
                packets.append(reply(opcode, sequence, offset, data=list(range(offset, offset + length))))
                sequence += 1
        fake = FakeHid(packets)
        result = host.HidLink(fake, lambda *a, **kw: None).snapshot()
        self.assertTrue(result['identical'])
        self.assertFalse(result['atomic'])
        self.assertEqual(result['active'], list(range(128)))
        self.assertTrue(all(packet[4] in (3, 4) for packet in fake.writes))

    def test_control_delivery_and_restoration(self):
        args = argparse.Namespace(report=2, rate=0, count=3, interval=0.001)
        for fail in (False, True):
            fake = FakeControl(fail)
            with patch('host.time.sleep'):
                if fail:
                    with self.assertRaises(IOError):
                        host.exercise_control(fake, args, lambda *a, **kw: None)
                else:
                    host.exercise_control(fake, args, lambda *a, **kw: None)
            self.assertEqual(fake.rate, 7)
            self.assertEqual(fake.calls[-2][0:3], (0x21, 0x0a, (7 << 8) | 2))
            self.assertTrue(all(call[:2] in [(0xa1, 2), (0xa1, 1), (0x21, 0x0a)] for call in fake.calls))

    def test_log_preserves_prior_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.jsonl'
            log = host.Logger(path)
            log('request', bytes=[3, 85, 77])
            log.close()
            with self.assertRaises(FileExistsError):
                host.Logger(path)

    def test_timeout_and_short_write(self):
        fake = FakeHid([])
        with self.assertRaises(TimeoutError):
            host.HidLink(fake, lambda *a, **kw: None, timeout_ms=1).read(0x71)
        with patch.object(fake, 'write', return_value=1):
            with self.assertRaises(IOError):
                host.HidLink(fake, lambda *a, **kw: None).read(0x71)

    def test_monitor_disappearance_and_reappearance(self):
        info = list(b'UMAC\x01\x0c') + [0, 6, 6, 5, 128, 3, 255, 255]
        first = FakeHid([reply(1, data=info), reply(sequence=1)])
        second = FakeHid([reply(1, data=info), reply(sequence=1)])
        args = argparse.Namespace(serial=None, passive=False, duration=0, interval=1)
        rows = []
        with patch('host.hid_module', return_value=object()), \
             patch('host.candidates', side_effect=[[dict(path=b'pad')], [], [dict(path=b'pad')]]), \
             patch('host.one_device', side_effect=[first, second]), \
             patch('host.time.sleep', side_effect=[None, None, KeyboardInterrupt]):
            with self.assertRaises(KeyboardInterrupt):
                host.monitor(args, lambda event, **fields: rows.append((event, fields)))
        presence = [fields['paths'] for event, fields in rows if event == 'presence_changed']
        self.assertEqual(presence, [['706164'], [], ['706164']])
        samples = [fields for event, fields in rows if event == 'sample']
        self.assertEqual(len(samples), 2)
        self.assertNotEqual(samples[1]['continuity'], 'first-sample')
        self.assertTrue(first.closed and second.closed)

    def test_passive_monitor_sends_nothing(self):
        args = argparse.Namespace(serial=None, passive=True, duration=0, interval=1)
        with patch('host.hid_module', return_value=object()), \
             patch('host.candidates', return_value=[dict(path=b'pad')]), \
             patch('host.one_device') as opened, \
             patch('host.time.sleep', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                host.monitor(args, lambda *a, **kw: None)
        opened.assert_not_called()


if __name__ == '__main__':
    unittest.main()
