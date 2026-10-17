# Live View Telemetry Experiment

Branch: `experiment/v17-instant-auto-sleep-and-live-view-updates`.
Baseline: `780fcc7`. Saved configuration remains format 16. **Enter Auto-Sleep**
is deferred. Existing firmware features, release files and frozen editors are preserved.

## Initial Prototype

The initial prototype appends input and accepted-binding counters to the existing
status prefix and adds read-only runtime/timer snapshots. Counters survive layer
and action resets, wrap modulo 256, and never clear on a telemetry read. Physical
encoder detents are counted before wake consumption. Accepted binding dispatch is
reported separately from physical input; it does not assert host application receipt.
A full queue rejects the binding without recording a successful dispatch.

Native baseline: six keys 14,286 flash bytes, 91-byte stack reserve; three-key
baseline recorded at 14,282 bytes and 94 bytes. First diagnostic prototype:
14,874/14,870 bytes and 88/91-byte stack reserves (six/three). This prototype
exceeds the real 14,336-byte limit; its 16KiB diagnostic builds are measurements,
not flashable application builds. Fitting and stack preservation remain in progress.

Initial complete host regressions pass with preview enabled. Build artifacts,
source candidates and logs are in `/private/tmp/macropad-live-v17/`.
