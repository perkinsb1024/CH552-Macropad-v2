"""Terminal and cancellation regressions without accessing a USB device."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import signal
import tempfile
import termios
import unittest
from unittest.mock import Mock, patch

import scan


class TerminalTests(unittest.TestCase):
    def test_terminal_flags_and_interrupt_handler_restored_on_cancel(self):
        attrs = [0, 0, 0, 0, 0, 0, [b'\x00'] * termios.NCCS]
        original_handler = signal.getsignal(signal.SIGINT)
        with patch.object(scan.os, 'isatty', return_value=True), \
             patch.object(termios, 'tcgetattr', side_effect=lambda fd: attrs[:6] + [attrs[6][:]]), \
             patch.object(termios, 'tcsetattr') as setter:
            with self.assertRaises(KeyboardInterrupt):
                with scan.terminal_session():
                    active = setter.call_args.args[2]
                    self.assertTrue(active[1] & termios.OPOST)
                    self.assertTrue(active[1] & termios.ONLCR)
                    self.assertTrue(active[3] & termios.ISIG)
                    self.assertEqual(active[6][termios.VINTR], b'\x03')
                    signal.getsignal(signal.SIGINT)(signal.SIGINT, None)
            self.assertEqual(setter.call_args.args[2], attrs)
        self.assertEqual(signal.getsignal(signal.SIGINT), original_handler)

    def test_burst_cancel_preserves_partial_transfer_log(self):
        factory = {'idVendor': 0x1189, 'idProduct': 0x8890,
                   'locationID': 7, 'IORegistryEntryID': 10}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'run'
            args = argparse.Namespace(mode='startup-burst', payload=None, repeat=1,
                include_known=False, start_byte=0, end_byte=0x4D,
                transport='interrupt', output=output, connect_timeout=30,
                burst_seconds=1, settle=0.5)
            device, util = Mock(), Mock()
            device.write.side_effect = KeyboardInterrupt
            console = io.StringIO()
            with patch.object(scan, 'usb_snapshot', return_value=[factory]), \
                 patch.object(scan, 'usb_modules', return_value=(Mock(), util, object())), \
                 patch.object(scan, 'await_reconnection', return_value=(device, 0)), \
                 patch.object(scan, 'open_target', return_value=(device, util, scan.DESCRIPTOR)), \
                 patch.object(scan.time, 'monotonic', return_value=0.1), \
                 contextlib.redirect_stdout(console):
                self.assertEqual(scan.burst_run(args), 130)
            self.assertIn('ARMED: Startup burst, 60 commands, 1000ms budget.\n', console.getvalue())
            self.assertIn('CANCELLED: Results saved.', console.getvalue())
            self.assertNotIn('"event"', console.getvalue())
            summary = json.loads((output / 'summary.json').read_text())
            self.assertEqual(summary['outcome'], 'interrupted')
            self.assertEqual(summary['attempts'], 1)
            self.assertEqual(summary['completed_writes'], 0)
            events = [json.loads(x) for x in (output / 'events.jsonl').read_text().splitlines()]
            self.assertEqual(len(events[1]['packets_hex']), 60)
            self.assertEqual(events[2]['transfers'][0]['delivery'], 'unknown')
            self.assertEqual(events[-1]['event'], 'finished')
            util.dispose_resources.assert_called_once_with(device)


if __name__ == '__main__':
    unittest.main()
