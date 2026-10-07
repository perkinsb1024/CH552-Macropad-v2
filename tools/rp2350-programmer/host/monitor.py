#!/usr/bin/env python3
"""Capture standalone-programmer diagnostics; BOOT starts the operation on-board."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

from probe import SerialConsole, ProbeError


def capture(port, log, timeout=120, report=print):
    console = SerialConsole(port)
    deadline = time.monotonic() + timeout
    try:
        console.send("status")
        validated = False
        while True:
            event = console.receive(min(deadline, time.monotonic() + 5) if not validated else deadline)
            if console.discarded_initial_fragment is not None:
                log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                      "host_event": "discarded_initial_fragment",
                                      "hex": console.discarded_initial_fragment.hex()}) + "\n")
                console.discarded_initial_fragment = None
            log.write(json.dumps({"host_time": datetime.now(timezone.utc).isoformat(),
                                  "adapter": event}) + "\n")
            log.flush()
            report(json.dumps(event, sort_keys=True))
            name = event["event"]
            if name == "status":
                if (event.get("protocol") != 2 or event.get("read_only") is not False or
                        event.get("mode") != "standalone_programmer" or
                        event.get("board") != "waveshare_rp2350_usb_a"):
                    raise ProbeError("Selected port is not the standalone RP2350 programmer")
                validated = True
                if event.get("state") == "failed":
                    raise ProbeError(event.get("last_error") or "Programming failed")
                if event.get("state") == "done" and event.get("phase") == "done":
                    return event
                if event.get("state") == "idle":
                    if event.get("storage_pending"):
                        report("Firmware drive is saving; wait for blinking green.")
                    elif event.get("image_status") in ("missing", "invalid"):
                        report("Load one valid macropad HEX: " + event.get("image_error", ""))
                    else:
                        report("Press BOOT on the RP2350, then plug the macropad in during cyan.")
            elif validated and name == "program_completed":
                if (event.get("state") != "done" or event.get("verified_bytes") != 0x3800 or
                        event.get("reboot_sent") is not True):
                    raise ProbeError("Incomplete programming-success event")
                return event
            elif validated and name == "failed":
                raise ProbeError(event.get("reason", "Programming failed"))
            elif validated and name in ("ready", "startup"):
                raise ProbeError("Adapter restarted during monitoring")
    finally:
        console.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--timeout", type=float, default=120, help="Capture deadline in seconds (default 120)")
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()
    if not 0 < args.timeout <= 3600:
        parser.error("--timeout must be greater than zero and at most 3600")
    path = args.log or (Path(__file__).resolve().parents[1] / "logs" /
                       (datetime.now(timezone.utc).strftime("standalone-%Y%m%dT%H%M%S-%fZ") + ".jsonl"))
    print("Standalone programmer monitor. The adapter can also run from a power brick.")
    print("Capture:", path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as log:
            capture(args.port, log, args.timeout)
        print("\n🟢 SUCCESS: Application flash compared successfully; reboot command sent.", flush=True)
        return 0
    except (OSError, ProbeError) as exc:
        print("\n🔴 FAILED:", str(exc), file=sys.stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print("\nMonitor stopped; the RP2350 continues independently. Follow its LED status.", flush=True)
        return 130


if __name__ == "__main__":
    sys.exit(main())
