"""Use the project builder even when PlatformIO has an older cached platform."""

from pathlib import Path

Import("env")

# PlatformIO copies file:// platforms into its cache. A cached builder may omit
# dependencies on src/*.c, leaving old firmware marked up to date after edits.
project = Path(env.subst("$PROJECT_DIR"))
env.Replace(BUILD_SCRIPT=str(project / "pio-platform" / "builder" / "main.py"))
