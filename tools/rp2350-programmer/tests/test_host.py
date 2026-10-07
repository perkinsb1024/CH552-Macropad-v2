import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import select
import threading
import time
import unittest
from unittest.mock import patch
import errno

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("probe", ROOT / "host" / "probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class HostTests(unittest.TestCase):
    def reset_adapter(self, *, old_overrides=None, new_overrides=None,
                      disconnect=True, status_only=False, missing=False):
        commands = []
        idle = {"event": "status", "protocol": 1, "read_only": True,
                "board": "waveshare_rp2350_usb_a", "state": "idle",
                "host_started": False, "dropped_logs": 0}
        old = dict(idle, state="failed", host_started=True, **(old_overrides or {}))
        fresh = dict(idle, **(new_overrides or {}))
        info = {"event": "identified", "chip": "CH552", "read_only": True}

        class FakeConsole:
            discarded_initial_fragment = None

            def __init__(self, name, events):
                self.name, self.events, self.closed = name, iter(events), False

            def send(self, command):
                commands.append((self.name, command))

            def receive(self, deadline):
                event = next(self.events)
                if isinstance(event, Exception):
                    raise event
                return event

            def close(self, restore=True):
                self.closed = True

        first = FakeConsole("before", [old, OSError(errno.ENXIO, "Device not configured")
                                     if disconnect else probe.ProbeError("Timed out waiting for adapter")])
        second = FakeConsole("after", [fresh, {"event": "armed"},
                                       {"event": "host_start"}, info])
        attempts = [0]

        def open_console(port):
            attempts[0] += 1
            if attempts[0] == 1:
                return first
            if missing or attempts[0] == 2:
                raise FileNotFoundError(errno.ENOENT, "Port not yet present")
            return second

        ticks = iter(i / 4 for i in range(1000))
        log = io.StringIO()
        with patch.object(probe, "SerialConsole", side_effect=open_console), \
                patch.object(probe.time, "sleep"), \
                patch.object(probe.time, "monotonic", side_effect=lambda: next(ticks)):
            try:
                result = probe.capture("explicit-port", 1000, log, report=lambda _: None,
                                       reset=True, status_only=status_only)
            except probe.ProbeError as exc:
                result = exc
        self.assertTrue(first.closed)
        if attempts[0] >= 3 and not missing:
            self.assertTrue(second.closed)
        return result, commands, log.getvalue()

    def test_reset_reconnects_used_early_adapter_before_arm(self):
        result, commands, log = self.reset_adapter()
        self.assertEqual(result["event"], "identified")
        self.assertEqual(commands, [("before", "status"), ("before", "reset"),
                                    ("after", "status"), ("after", "arm 1000")])
        self.assertIn('"host_event": "reset_requested"', log)
        self.assertIn('"host_event": "reconnect_open"', log)
        self.assertIn('"host_event": "reconnect_status"', log)

    def test_disconnected_close_does_not_restore_terminal_settings(self):
        console = probe.SerialConsole.__new__(probe.SerialConsole)
        console.fd, console.original = 123, [0] * 7
        with patch("termios.tcsetattr") as restore, patch.object(probe.os, "close") as close:
            console.close(restore=False)
            restore.assert_not_called()
            close.assert_called_once_with(123)
            self.assertIsNone(console.fd)

    def test_buffered_events_do_not_bypass_receive_deadline(self):
        console = probe.SerialConsole.__new__(probe.SerialConsole)
        console.pending = bytearray(b'{"event":"ready"}\n')
        with self.assertRaisesRegex(probe.ProbeError, "Timed out"):
            console.receive(time.monotonic() - 1)

    def test_reset_status_only_and_changed_boot_id(self):
        result, commands, _ = self.reset_adapter(old_overrides={"boot_id": "old"},
                                                 new_overrides={"boot_id": "new"},
                                                 status_only=True)
        self.assertEqual(result["boot_id"], "new")
        self.assertEqual([c for _, c in commands], ["status", "reset", "status"])

    def test_reset_refuses_wrong_adapter_before_reset_or_arm(self):
        result, commands, _ = self.reset_adapter(old_overrides={"board": "other"})
        self.assertIsInstance(result, probe.ProbeError)
        self.assertEqual(commands, [("before", "status")])

    def test_reset_requires_disconnect(self):
        result, commands, _ = self.reset_adapter(disconnect=False)
        self.assertIn("Reset did not disconnect", str(result))
        self.assertEqual([c for _, c in commands], ["status", "reset"])

    def test_reset_requires_valid_fresh_adapter_before_arm(self):
        for overrides in ({"board": "other"}, {"host_started": True},
                          {"state": "armed"}, {"dropped_logs": 1}, {"boot_id": "old"}):
            with self.subTest(overrides=overrides):
                result, commands, _ = self.reset_adapter(old_overrides={"boot_id": "old"},
                                                         new_overrides=overrides)
                self.assertIsInstance(result, probe.ProbeError)
                self.assertNotIn("arm 1000", [c for _, c in commands])

    def test_reset_reconnection_is_bounded(self):
        result, commands, _ = self.reset_adapter(missing=True)
        self.assertIn("did not reconnect within 15s", str(result))
        self.assertEqual([c for _, c in commands], ["status", "reset"])

    def run_adapter(self, events, status_overrides=None, status_only=False, initial_bytes=b""):
        master, slave = pty.openpty()
        commands = []
        errors = []
        status = {"event": "status", "protocol": 1, "read_only": True,
                  "board": "waveshare_rp2350_usb_a", "state": "idle",
                  "host_started": False, "dropped_logs": 0}
        status.update(status_overrides or {})

        def simulator():
            try:
                pending = b""
                for reply in ([status],) if status_only else ([status], events):
                    deadline = time.monotonic() + 2
                    while b"\n" not in pending:
                        if not select.select([master], [], [], max(0, deadline - time.monotonic()))[0]:
                            return
                        pending += os.read(master, 100)
                    line, _, pending = pending.partition(b"\n")
                    commands.append(line.decode())
                    data = b"".join(e if isinstance(e, bytes) else json.dumps(e).encode() + b"\n"
                                    for e in reply)
                    if commands == ["status"]:
                        data = initial_bytes + data
                    # Exercise split JSON frames and multiple events in one read.
                    os.write(master, data[:7])
                    os.write(master, data[7:])
            except BaseException as exc:
                errors.append(exc)

        worker = threading.Thread(target=simulator)
        worker.start()
        log = io.StringIO()
        try:
            try:
                result = probe.capture(os.ttyname(slave), 0, log, timeout=0.2,
                                       report=lambda _: None, status_only=status_only)
            except probe.ProbeError as exc:
                result = exc
            return result, commands, log.getvalue()
        finally:
            worker.join(timeout=3)
            os.close(master)
            os.close(slave)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])

    def test_identification_and_timestamped_log(self):
        info = {"event": "identified", "chip": "CH552", "read_only": True, "version": "2.4.0"}
        result, commands, log = self.run_adapter([{"event": "armed"}, {"event": "host_start"}, info])
        self.assertEqual(result, info)
        self.assertEqual(commands, ["status", "arm 0"])
        records = [json.loads(line) for line in log.splitlines()]
        self.assertEqual(len(records), 4)
        self.assertIn("host_time", records[-1])

    def test_status_only_does_not_arm_used_adapter(self):
        result, commands, log = self.run_adapter([], {
            "state": "failed", "host_started": True, "boot_id": "12345678",
            "reset_brownout": True, "dropped_logs": 1,
        }, status_only=True)
        self.assertEqual(result["boot_id"], "12345678")
        self.assertTrue(result["reset_brownout"])
        self.assertEqual(commands, ["status"])
        self.assertEqual(len(log.splitlines()), 1)

    def test_status_only_still_rejects_wrong_adapter(self):
        result, commands, _ = self.run_adapter([], {"board": "other"}, status_only=True)
        self.assertIsInstance(result, probe.ProbeError)
        self.assertEqual(commands, ["status"])

    def test_status_resynchronizes_initial_fragment_and_records_it(self):
        fragment = b'on":"unexpected_usb_identity"}\n'
        result, commands, log = self.run_adapter([], status_only=True, initial_bytes=fragment)
        self.assertEqual(result["event"], "status")
        self.assertEqual(commands, ["status"])
        records = [json.loads(line) for line in log.splitlines()]
        self.assertEqual(records[0]["host_event"], "discarded_initial_fragment")
        self.assertEqual(bytes.fromhex(records[0]["hex"]), fragment.rstrip(b"\n"))
        self.assertEqual(records[1]["adapter"], result)

    def test_rejects_repeated_initial_corruption(self):
        result, commands, _ = self.run_adapter([], status_only=True,
                                               initial_bytes=b'fragment\nstill invalid\n')
        self.assertIsInstance(result, probe.ProbeError)
        self.assertIn("invalid JSON", str(result))
        self.assertEqual(commands, ["status"])

    def test_rejects_corruption_after_valid_frame(self):
        result, commands, _ = self.run_adapter([b'invalid JSON\n'])
        self.assertIsInstance(result, probe.ProbeError)
        self.assertIn("invalid JSON", str(result))
        self.assertEqual(commands, ["status", "arm 0"])

    def test_rejects_wrong_port_or_used_adapter_before_arm(self):
        for overrides in ({"read_only": False}, {"board": "other"}, {"protocol": 2},
                          {"host_started": True}, {"state": "armed"}, {"dropped_logs": 1}):
            with self.subTest(overrides=overrides):
                result, commands, _ = self.run_adapter([], overrides)
                self.assertIsInstance(result, probe.ProbeError)
                self.assertEqual(commands, ["status"])

    def test_failure_and_no_false_success(self):
        sequences = [
            [{"event": "armed"}, {"event": "failed", "reason": "invalid_config_reply"}],
            [{"event": "identified", "chip": "CH552", "read_only": True}],
            [{"event": "host_start"}],
            [{"event": "armed"}, {"event": "ready"}],
            [{"event": "armed"}],
        ]
        for events in sequences:
            with self.subTest(events=events):
                result, commands, _ = self.run_adapter(events)
                self.assertIsInstance(result, probe.ProbeError)
                self.assertEqual(commands, ["status", "arm 0"])


if __name__ == "__main__":
    unittest.main()
