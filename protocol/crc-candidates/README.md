# CRC Measurement Artifacts

See [DataFlash Header and CRC Investigation](../dataflash-header-crc-investigation.md)
for the complete interpretation, algorithm parameters, layouts and validation.

Firmware patches apply to source revision `a14798a4450c85d88d96f9e5cad598da552de0b6`.
Test patches apply after the corresponding firmware patch and adapt checksum
coverage without suppressing production behavior checks. The baseline has no
firmware patch. The integrity probe is `../crc-integrity-probe.c`; the driver
copies it into each isolated tree after applying test adaptations.

`results.json` preserves twenty native measurements and forty successful
host/integrity validation invocations. `source-and-log-checksums.json` identifies
firmware sources, temporary native outputs and final passing logs. Full temporary
artifacts remain in `/private/tmp/macropad-crc-investigation/`.

Candidates deliberately retain version 15 only for controlled measurement.
Their CRC definitions are incompatible with production v15; they are not release
inputs. The active firmware, configurator and release files are unchanged.

To repeat the investigation, run `python3 protocol/build-crc-probes.py --host`
from the repository root. To apply patches manually, extract the stated revision
into an isolated directory and use `git apply` on the corresponding firmware and
test patches there. The host suites require the read-only `webUploader/upstream`
include dependency; the driver links it from this checkout.
