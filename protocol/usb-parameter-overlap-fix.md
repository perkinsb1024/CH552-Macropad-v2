# USB Interrupt Parameter Overlap Fix

The fix prevents USB control-request handlers from overwriting live foreground
function parameters. It costs 26 flash bytes and four external-RAM bytes on
both hardware variants, while increasing available stack capacity by one byte.
Configuration format 12 and the HID wire protocol are unchanged.

## Defect and Correction

SDCC overlays parameters of non-reentrant functions in shared internal RAM.
In the measured baseline, `USB_setIdle`'s rate and `USB_getReport`'s output
selector occupy `0x7C`; the latter's two-byte buffer pointer occupies
`0x7D–0x7E`. Foreground functions including `queueAction`, `pairIndex`, and
`ledStep` reuse this overlay. A USB interrupt handling `SET_IDLE` or
`GET_REPORT` can therefore overwrite a parameter before the foreground
function finishes using it. Saving CPU registers does not preserve these
shared parameter bytes.

The `#pragma nooverlay` around `USBInterrupt` alone does not protect separately
compiled helper functions in the HID module. The correction:

- Gives the rate, output selector, and pointer storage four dedicated
  `__xdata` bytes through `USB_ISR_PARAM`, with matching declarations and
  definitions. The buffer pointer's target also remains `__xdata`.
- Applies `#pragma nooverlay` to `USB_setIdle`, `USB_getIdle`, and
  `USB_getReport`, restoring the prior compiler settings afterward.
- Checks the linked map during target builds to ensure the four parameter
  bytes fit in ordinary external RAM and do not overlap each other.

The fix is enabled unconditionally for SDCC builds. Host builds retain their
ordinary parameter declarations. It adds no interrupt masking or parameter
pushes. It addresses this confirmed corruption path; it does not establish
the cause of the original temporary-invalid-configuration incidents or prove
all interrupt interactions safe.

## Measurement Basis

Baseline: commit `ea6cd7a295dcdaecdd0d79428e377abbc15b4c75`, including the
[function call optimizations](function-call-optimization-findings.md). The
saved baseline firmware sources, sketch, and `platformio.ini` were verified
against that commit. After measurements use the same production configuration
with only this firmware fix added; no diagnostic instrumentation or feature
reductions are included.

Build settings: CH55xDuino 0.0.25, bundled SDCC build.13407_4, small memory model,
`--opt-code-size`, 24MHz, 148 USB DMA bytes, and the 14,336-byte application
flash limit. Both variants were built into temporary directories using
`pio-platform/build_firmware.py`; checked-in release files were preserved.

All measurements below are bytes. Stack capacity is linker-reserved space,
not measured runtime stack usage.

| Resource | Six-Key Before | Six-Key After | Three-Key Before | Three-Key After | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Flash | 14,286 | 14,312 | 14,282 | 14,308 | +26 |
| Free Application Flash | 50 | 24 | 54 | 28 | −26 |
| Ordinary External RAM | 369 | 373 | 360 | 364 | +4 |
| Internal RAM Overlay | 3 | 2 | 3 | 2 | −1 |
| Stack Capacity | 77 | 78 | 80 | 81 | +1 |
| Paged RAM | 95 | 95 | 95 | 95 | 0 |

## Verification and Evidence

Both target builds, all ten host C suites, and seven memory-layout tests passed.
The new layout regression checks reject internal-RAM parameter storage,
missing allocations, overlapping allocations, and a pointer whose second
storage byte exceeds the external-RAM allocation.

The linked-code verifier from investigation commit `17308e6` was reused for
both before and after builds. It checks linked instruction bytes against the
HEX files and replays parameter stores and foreground reads across all 65,536
argument/idle-rate combinations, plus both `GET_REPORT` output selectors.
The baseline fragments reproduce the overwrite; the corrected fragments
preserve foreground parameters. Corrected USB handler, HID helper, and protocol
modules contain no remaining overlaid parameter or local allocations.

No hardware flashing or hardware testing was performed for this change.

Artifacts were retained at `/private/tmp/macropad-usb-overlap-9z9_t28b`, including
both source snapshots, build logs, map/memory files, linked listings, HEX files,
verification results, and `measurements.json`. This location is temporary.
The corrected HEX SHA-256 hashes are:

| Variant | SHA-256 |
| --- | --- |
| Six-Key | `9ed173566614a9685de03a947c05231a39f5a6baf3f72d35e01175ae78a57203` |
| Three-Key | `b1200c83382ff0d14e6667bfe0f198994564ef34537b3cdb0c15aebdd026a678` |
