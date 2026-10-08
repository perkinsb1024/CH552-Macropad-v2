# V12 Mouse Implementation and Validation

## Firmware Checkpoint

Format 12 supports all eight mouse-button bits and persistent **Mouse down** /
**Mouse up** actions alongside **Mouse toggle**. Down/up use full first bytes
`15` / `25`; their selected bits modify the same global persistent mask.
The USB report remains five bytes, with eight button bits and two signed
four-bit scroll fields. The explicitly named `USB_queueMousePacked` API removes
the former button-8 / horizontal-axis collision.

Production fixed-pair macro branches were removed. Dynamic sequences, single-byte
terminators, image-boundary termination, repeats and pauses remain unchanged.
Macro persistent actions reuse direct dispatch rather than duplicating mode logic.
The USB queue no longer masks or repacks button bits. These changes preserve all
production features; no degradation was needed.

## Native Measurements

SDCC 4.2.2 build.13407_4, 24 MHz, 148 USB DMA bytes, and the real 14,336-byte
application limit. Builds use temporary outputs; release files remain v11.

| Hardware | Flash | Spare | Paged RAM | Ordinary XSEG | Absolute Image | Stack Capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,304 | 32 | 95 | 369 | 128 | 77 |
| Three keys | 14,300 | 36 | 95 | 360 | 128 | 80 |

Stack capacity is two bytes lower than the finalized v11 baseline (79/82),
and exceeds the requested minimum of 69 bytes. No persistent RAM or report-buffer
growth was needed.

## Automated Verification

Firmware host suites and layout checks cover both board geometries. New coverage
includes all 255 nonzero masks, reserved auxiliary values and zero-mask rejection,
all trigger contexts, repeated down/up, toggle interactions, physical holds,
temporary clicks, macro completion, cancellation, layer/reset cleanup, ordered
drag playback under backpressure, scroll signs/counts with button 8 held,
queue rejection, idle reports and **GET_REPORT**. USB generation changes reassert
all eight buttons, including `FF`, which can no longer serve as an invalid-mask
sentinel. Both ordinary and color-preview-disabled suites pass.

```sh
python3 tests/run_host_tests.py
python3 tests/run_host_tests.py --no-preview
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v12-six 24000000 148 14336 0
python3 pio-platform/build_firmware.py build . /private/tmp/macropad-v12-three 24000000 148 14336 1
```

## Hardware Validation

No v12 hardware or host-application compatibility testing has been performed.
Validate dragging, click/hold/toggle/down/up combinations, both scroll axes and
buttons 4–8 on available hosts. Ordinary application interfaces and browser events
may expose fewer buttons than the device advertises. Record observed results
separately from descriptor and report correctness.
