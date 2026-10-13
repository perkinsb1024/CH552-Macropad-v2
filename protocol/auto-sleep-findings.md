# Auto-Sleep Investigation

Baseline: `0fb6132`, branch `experiment/v15-auto-sleep`.
The requested per-layer **Auto-Sleep** uses option bit 1, replacing the ignored
legacy encoder-hold flag. Physical presses and complete detents reset the timer;
releases, USB traffic and continuously held inputs do not. Sleep selects
**Both Off**; the next physical input selects **Both as Configured** and is
consumed through the existing input gate. Effective layer transitions restart
an awake interval, preserving an already pending wake.

## Initial Dedicated Timer

A three-byte paged countdown reuses the 16ms polling clock and measures 440 ticks
of 4.096 seconds: 30 minutes 2.240 seconds, with less than 16ms early quantization.
This first checkpoint preserves every feature but exceeds the real flash limit.
Temporary 16,384-byte links measure excess only; production limit is 14,336.

| Build | Six-Key Flash | Three-Key Flash | Stack Capacity |
| --- | ---: | ---: | --- |
| Baseline | 14,330 | 14,328 | 81 / 84 |
| Dedicated Countdown | 14,484 | 14,482 | 81 / 84 |

PSEG grows from 105 to 108 bytes and fills page zero through `0xFF`.
Ordinary XSEG stays 365/356 bytes. Host regressions pass, including both
geometries, inactive layers, restart phase, saturated sleep, wake consumption,
layer transitions, reset and simultaneous availability of all four user timers.
Native measurement links pass layout checks. Hardware validation is outstanding.
No firmware release files were generated.

## Fitted Shared-Timer Result

Firmware commit: `3e74977`.

The fitted implementation synthesizes a six-byte timer after the saved image
in aligned external RAM. Configuration uploads, reads, CRCs and DataFlash remain
128 bytes; the private runtime buffer is 134 bytes. Five runtime age/fraction
slots accommodate all four user timers plus auto-sleep. The built-in interval
is 440 ticks, or 30 minutes 2.240 seconds, with the same less-than 16ms early clock
quantization as user timers. Its flags always restart on physical input and
consume the wake input. It advances only while the effective layer opts in.
Layer transitions reset its interval while preserving a pending wake. Like the
user recipe, it repeats **Both Off** at each idle expiry and coalesces the
**Both as Configured** wake into one input. Other LED actions and preview/effects
retain their ordinary interactions with brightness presets.

| Build | Six-Key Flash | Three-Key Flash | Stack Capacity | Free Flash |
| --- | ---: | ---: | --- | --- |
| Final | 14,332 | 14,330 | 85 / 88 | 4 / 6 |

No features are removed or degraded. Net flash growth is 2 bytes per variant;
stack reserve increases 4 bytes per variant against the measured baseline.
PSEG 106, XSEG 365/356, absolute active/runtime buffer 134 and USB DMA 148 yield
753/744 allocated external bytes. PSEG ends 0xFD; XSEG ends 0x27E/0x261; active
buffer occupies 0x300–0x385. The stack figures describe capacity, not hardware
high-water usage. Both real 14336-byte links and layout/startup checks pass.

The fitting changes pack pending timer bits into the age-high byte, simplify
scope comparison and adjacent record loads, encode scroll signs before selecting
axis, remove a release-state ternary, and narrow validated protocol/text ranges.
All behavior-preserving candidates and rejected approaches are preserved in the
local optimization ledger and temporary source/patch files. Neither absolute
image alignment nor short pdata/xdata pointer assumptions are expanded beyond
the bounds checked by the native builder. The saved format bump is required:
older ignored layer bit 1 must be cleared by migration, never relabeled as v15.

Host suites pass with color preview enabled and disabled, including both
hardware variants, wake/consumed release for keys and encoder button, unbound
wake, both complete detent directions, partial-detent rejection, held/released
inputs, layer transitions, independent phase, repeated inactivity, simultaneous
four user timers and USB/configuration reset. Hardware validation is outstanding.
No firmware release generation or flashing was performed.

## Configurator and Documentation Validation

The active v15 editor adds **Auto-Sleep** under **Layer Options**, disabled by
default, with binary/JSON encoding, older-profile migration, namespaced draft
recovery, device comparisons, live view, and undo/redo. Migration explicitly
clears the former ignored flag for binary v2–v14 and disables the new property
for older JSON/drafts. All four user timer slots and the profile storage budget
remain unchanged. The v14 editor is frozen from outgoing source `0fb6132`;
663 source tests, its production build and checksums pass. Existing archives
remain byte-for-byte unchanged.

Validation on firmware revision `3e74977` with uncommitted configurator and
documentation changes: 671 configurator tests, 89 uploader tests, TypeScript,
complete production site build and all 13 archive checksum manifests pass through
`npm run verify:deploy`. Browser inspection verifies the visible checkbox,
unchanged storage use, and undo. Uploader routing preserves published v14 as the
bundled release and links to its frozen matching editor; a regression now checks
that an older bundled release always has that archive. No v15 release files,
push, deployment or hardware flashing were performed.
