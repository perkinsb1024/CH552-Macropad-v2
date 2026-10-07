#!/usr/bin/env python3
"""Read-only RP2350 probe console and timestamped capture; macOS/Linux, no packages."""

import argparse
import errno
from datetime import datetime, timezone
import glob
import json
import os
from pathlib import Path
import select
import sys
import time


class ProbeError(Exception):
    pass


class SerialConsole:
    """Explicitly selected POSIX serial port; bounded reads and complete writes."""

    def __init__(self, path):
        import termios
        import tty

        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self.pending = bytearray()
        self.first_line = True
        self.discarded_initial_fragment = None
        self.original = None
        try:
            self.original = termios.tcgetattr(self.fd)
            tty.setraw(self.fd, termios.TCSANOW)
            attrs = termios.tcgetattr(self.fd)
            attrs[4] = attrs[5] = termios.B115200
            attrs[2] |= termios.CLOCAL | termios.CREAD
            termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
            termios.tcflush(self.fd, termios.TCIFLUSH)
        except BaseException:
            self.close(restore=False)
            raise

    def close(self, restore=True):
        import termios

        if self.fd is not None:
            try:
                if restore and self.original is not None:
                    termios.tcsetattr(self.fd, termios.TCSANOW, self.original)
            except (OSError, termios.error):
                pass
            finally:
                os.close(self.fd)
                self.fd = None

    def send(self, command):
        data = memoryview((command + "\n").encode("ascii"))
        deadline = time.monotonic() + 2
        while data:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [self.fd], [], remaining)[1]:
                raise ProbeError("Timed out writing to adapter")
            try:
                count = os.write(self.fd, data)
            except BlockingIOError:
                continue
            if not count:
                raise ProbeError("Adapter closed during write")
            data = data[count:]

    def receive(self, deadline):
        if time.monotonic() >= deadline:
            raise ProbeError("Timed out waiting for adapter; unplug the pad before resetting the adapter")
        while b"\n" not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.fd], [], [], remaining)[0]:
                raise ProbeError("Timed out waiting for adapter; unplug the pad before resetting the adapter")
            try:
                chunk = os.read(self.fd, 4096)
            except BlockingIOError:
                continue
            if not chunk:
                raise ProbeError("Adapter disconnected")
            self.pending.extend(chunk)
            if len(self.pending) > 8192:
                raise ProbeError("Adapter output exceeded the framing limit")
        line, _, self.pending = self.pending.partition(b"\n")
        if len(line) > 4096:
            raise ProbeError("Adapter line exceeded the framing limit")
        first_line, self.first_line = self.first_line, False
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError) as exc:
            if first_line:
                # Opening/flushing CDC can cut an already-transmitting log line.
                # Discard only this first fragment, retaining the same deadline.
                self.discarded_initial_fragment = bytes(line)
                return self.receive(deadline)
            raise ProbeError("Adapter sent invalid JSON: " + repr(bytes(line[:100]))) from exc
        if not isinstance(event, dict) or not isinstance(event.get("event"), str):
            raise ProbeError("Adapter sent an invalid event")
        return event


def capture(port, delay_ms, log, timeout=25, report=print, status_only=False,
            reset=False):
    """Identify the adapter before arming; never send target packets or flashing commands."""
    console = SerialConsole(port)

    def receive(deadline):
        event = console.receive(deadline)
        if console.discarded_initial_fragment is not None:
            fragment = console.discarded_initial_fragment
            console.discarded_initial_fragment = None
            log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                  "host_event": "discarded_initial_fragment",
                                  "hex": fragment.hex()}) + "\n")
            report("Skipped an incomplete initial serial line; synchronized at the next newline.")
        log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                              "adapter": event}) + "\n")
        log.flush()
        report(json.dumps(event, sort_keys=True))
        return event

    def status(deadline):
        console.send("status")
        while True:
            event = receive(deadline)
            if event["event"] == "status":
                break
        if (event.get("protocol") != 1 or event.get("read_only") is not True or
                event.get("board") != "waveshare_rp2350_usb_a"):
            raise ProbeError("Selected serial port is not the expected read-only RP2350 adapter")
        return event

    try:
        event = status(time.monotonic() + 5)
        if reset:
            previous_boot = event.get("boot_id")
            report("Rebooting the RP2350; keep its USB-A port empty until prompted.")
            console.send("reset")
            log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                  "host_event": "reset_requested"}) + "\n")
            log.flush()
            # The existing firmware watchdog resets after 50ms. Require a real
            # CDC disconnect, so an ignored reset can never silently arm a probe.
            deadline = time.monotonic() + 5
            while True:
                try:
                    receive(deadline)
                except OSError as exc:
                    if exc.errno not in (errno.EIO, errno.ENXIO, errno.ENODEV):
                        raise
                    break
                except ProbeError as exc:
                    if str(exc) != "Adapter disconnected":
                        raise ProbeError("Reset did not disconnect the adapter: " + str(exc)) from exc
                    break
            # Do not issue a termios restore ioctl to a disconnected CDC device.
            console.close(restore=False)
            report("Waiting for the RP2350 serial port to return (up to 15s)...")
            deadline = time.monotonic() + 15
            time.sleep(1)  # Let USB teardown/re-enumeration settle before opening.
            attempt = 0
            while True:
                if time.monotonic() >= deadline:
                    raise ProbeError("RP2350 did not reconnect within 15s at " + port +
                                     "; use --list if its serial path changed")
                time.sleep(0.2)
                attempt += 1
                remaining = max(0, deadline - time.monotonic())
                report(f"Reconnect attempt {attempt}: opening {port} ({remaining:.0f}s remaining)...")
                log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                      "host_event": "reconnect_open", "attempt": attempt}) + "\n")
                log.flush()
                try:
                    console = SerialConsole(port)
                    report("Serial port opened; waiting for adapter status...")
                    log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                          "host_event": "reconnect_status", "attempt": attempt}) + "\n")
                    log.flush()
                    event = status(min(deadline, time.monotonic() + 2))
                    break
                except OSError as exc:
                    console.close(restore=False)
                    if exc.errno not in (errno.ENOENT, errno.EIO, errno.ENXIO,
                                         errno.ENODEV, errno.EBUSY):
                        raise
                    report("Serial port not ready: " + str(exc))
                except ProbeError as exc:
                    console.close(restore=False)
                    if not (str(exc).startswith("Timed out waiting for adapter") or
                            str(exc) == "Adapter disconnected"):
                        raise
                    report("Adapter status not ready; retrying...")
            if previous_boot is not None and event.get("boot_id") == previous_boot:
                raise ProbeError("Adapter reconnected with the same boot ID; reset was not confirmed")
            if (event.get("host_started") is not False or event.get("state") != "idle" or
                    event.get("dropped_logs") != 0):
                raise ProbeError("Adapter did not return to a clean idle state after reset")
            report("RP2350 reconnected; reset confirmed.")
        if status_only:
            return event
        if event.get("host_started") is not False or event.get("state") != "idle":
            raise ProbeError("Adapter already used/armed: unplug the pad, reset the adapter, then retry")
        if event.get("dropped_logs") != 0:
            raise ProbeError("Adapter has dropped logs; reset it with the pad unplugged before capturing")

        console.send("arm " + str(delay_ms))
        deadline = time.monotonic() + delay_ms / 1000 + timeout
        armed = started = False
        while True:
            event = receive(deadline)
            name = event["event"]
            if name == "armed":
                armed = True
                report("Plug the macropad into the powered RP2350's USB-A port now.")
            elif name == "host_start":
                if not armed:
                    raise ProbeError("Host started without this capture's arm acknowledgement")
                started = True
            elif name == "identified":
                if not started or event.get("read_only") is not True or event.get("chip") != "CH552":
                    raise ProbeError("Unexpected identification event")
                return event
            elif name in ("failed", "error", "cancelled"):
                raise ProbeError("Probe stopped: " + event.get("reason", name))
            elif name == "ready":
                raise ProbeError("Adapter restarted during the probe")
    finally:
        console.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="List serial paths without opening them")
    parser.add_argument("--status", action="store_true", help="Read adapter status only; do not arm or start the host")
    parser.add_argument("--reset", action="store_true",
                        help="Reboot the RP2350 and reconnect before probing (keep USB-A empty)")
    parser.add_argument("--port", help="RP2350 CDC port, e.g. /dev/cu.usbmodem...")
    parser.add_argument("--delay-ms", type=int, default=5000, help="Insertion window, 0..30000ms")
    parser.add_argument("--log", type=Path, help="New JSONL capture file (existing files are preserved)")
    args = parser.parse_args()
    if args.list:
        for path in sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*")):
            print(path)
        return 0
    if os.name != "posix":
        parser.error("This initial dependency-free console supports macOS and Linux")
    if not args.port:
        parser.error("Choose the RP2350 with --port; --list only lists paths")
    if not 0 <= args.delay_ms <= 30000:
        parser.error("--delay-ms must be between 0 and 30000")
    log_path = args.log or (Path(__file__).resolve().parents[1] / "logs" /
                           (datetime.now(timezone.utc).strftime("probe-%Y%m%dT%H%M%S-%fZ") + ".jsonl"))
    if args.status:
        print("RP2350 status only: reads adapter diagnostics without arming the host.")
    else:
        print("RP2350 proof of concept: identification only. Start with its USB-A port empty.")
    print("Capture:", log_path)
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("x", encoding="utf-8") as log:
            info = capture(args.port, args.delay_ms, log, status_only=args.status,
                           reset=args.reset)
        if args.status:
            print("\n🟢 SUCCESS: Adapter status captured; no probe was started.", flush=True)
            return 0
        print("\n🟢 SUCCESS: Identified CH552 bootloader", info.get("version"),
              "chip ID", info.get("chip_id"), flush=True)
        print("Unplug the pad and reconnect it normally to check the factory application.")
        return 0
    except (OSError, ProbeError) as exc:
        print("\n🔴 FAILED:", str(exc), file=sys.stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print("\n🔴 FAILED: Capture interrupted. Unplug the pad; the adapter may still be probing.",
              file=sys.stderr, flush=True)
        return 130


if __name__ == "__main__":
    sys.exit(main())
