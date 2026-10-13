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
