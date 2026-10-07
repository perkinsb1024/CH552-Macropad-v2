import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
probe_spec = importlib.util.spec_from_file_location("probe", ROOT / "host/probe.py")
probe = importlib.util.module_from_spec(probe_spec)
probe_spec.loader.exec_module(probe)
spec = importlib.util.spec_from_file_location("monitor", ROOT / "host/monitor.py")
monitor = importlib.util.module_from_spec(spec)
with patch.dict("sys.modules", {"probe": probe}):
    spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def run_monitor(self, events):
        commands = []

        class Console:
            discarded_initial_fragment = None
            closed = False

            def __init__(self, port):
                self.events = iter(events)

            def send(self, command):
                commands.append(command)

            def receive(self, deadline):
                return next(self.events)

            def close(self):
                self.closed = True

        console = Console("port")
        log = io.StringIO()
        with patch.object(monitor, "SerialConsole", return_value=console):
            try:
                result = monitor.capture("port", log, report=lambda _: None)
            except probe.ProbeError as exc:
                result = exc
        self.assertTrue(console.closed)
        self.assertEqual(commands, ["status"])
        return result, log.getvalue()

    def status(self, **overrides):
        return dict({"event": "status", "protocol": 2, "read_only": False,
                     "mode": "standalone_programmer", "board": "waveshare_rp2350_usb_a",
                     "state": "idle", "phase": "detect"}, **overrides)

    def test_identification_alone_is_not_programming_success(self):
        success = {"event": "program_completed", "state": "done", "verified_bytes": 0x3800,
                   "reboot_sent": True}
        result, log = self.run_monitor([self.status(), {"event": "identified"}, success])
        self.assertEqual(result, success)
        self.assertEqual(len([json.loads(line) for line in log.splitlines()]), 3)

    def test_late_attach_uses_latched_status(self):
        result, _ = self.run_monitor([self.status(state="done", phase="done")])
        self.assertEqual(result["state"], "done")
        result, _ = self.run_monitor([self.status(state="failed", last_error="verify_failed")])
        self.assertIn("verify_failed", str(result))

    def test_failure_and_incomplete_success_never_pass(self):
        for terminal in ({"event": "failed", "reason": "write_failed"},
                         {"event": "program_completed", "state": "done", "verified_bytes": 56,
                          "reboot_sent": True}, {"event": "ready"}, {"event": "startup"}):
            with self.subTest(terminal=terminal):
                result, _ = self.run_monitor([self.status(), terminal])
                self.assertIsInstance(result, probe.ProbeError)

    def test_read_only_probe_or_wrong_board_is_rejected(self):
        for overrides in ({"read_only": True}, {"protocol": 1}, {"board": "other"}):
            with self.subTest(overrides=overrides):
                result, _ = self.run_monitor([self.status(**overrides)])
                self.assertIsInstance(result, probe.ProbeError)


if __name__ == "__main__":
    unittest.main()
