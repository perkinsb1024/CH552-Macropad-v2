#!/usr/bin/env python3
"""Fetch pinned SDK sources into this experiment's ignored .deps directory."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
DEPENDENCIES = (
    ("pico-sdk", "https://github.com/raspberrypi/pico-sdk.git",
     "079c6f39023649b154152db30f1d781e884879bc"),
    ("Pico-PIO-USB", "https://github.com/sekigon-gonnoc/Pico-PIO-USB.git",
     "5a37a66dc5d3fbe0ef3cdbeda923a757440f984f"),
)


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def main():
    for name, url, revision in DEPENDENCIES:
        path = ROOT / ".deps" / name
        if not path.exists():
            path.mkdir(parents=True)
            run("git", "init", str(path))
            run("git", "remote", "add", "origin", url, cwd=path)
            run("git", "fetch", "--depth", "1", "origin", revision, cwd=path)
            run("git", "checkout", "--detach", "FETCH_HEAD", cwd=path)
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()
        if actual != revision:
            raise SystemExit(f"{path}: expected {revision}, found {actual}; preserved existing checkout")
    run("git", "submodule", "update", "--init", "lib/tinyusb", cwd=ROOT / ".deps" / "pico-sdk")
    print("Dependencies ready. See usage.md for CMake and toolchain setup.")


if __name__ == "__main__":
    main()
