# Layer expansion experiment

Format 4 supports five layers on six-key hardware and seven on three-key hardware.
The same 128-byte saved image and 9-byte header remain in use. Each six-key layer
costs 22 bytes; each three-key layer costs 15 bytes. At the maximum layer count,
9 bytes or 14 bytes remain respectively for chords (3 bytes each) and strings
(including terminators). Layer count and startup layer use three bits each in
header byte 3. Chords use bits 4–6 for their layer, preserving bit 7 for global
scope. Absolute layer actions already had eight-bit target parameters.

Relative offsets expand to -6..+6. The previous arithmetic added 12 before
wrapping, which only works for layer counts dividing 12 (1–4). The new arithmetic
adds eight times the actual layer count, ensuring a nonnegative value for every
supported offset before repeated subtraction. No division helper is needed.

## Measured firmware cost

Built before and after with the same CH55xDuino 0.0.25 / SDCC build.13407_4
toolchain, 24 MHz clock, 148-byte USB RAM setting, and size optimization. Figures
come from the generated `firmware.mem` linker reports, not HEX file sizes.

| Hardware | Before flash | After flash | Increase | Free of 14,336 bytes | XRAM before/after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six keys | 14,126 | 14,134 | 8 | 202 | 626 / 626 |
| Three keys | 14,125 | 14,133 | 8 | 203 | 617 / 617 |

The config module has identical code size; all eight extra bytes are in the
action module's relative wraparound calculation. Internal RAM layout and the
141-byte available stack are unchanged. More layers allocate no additional RAM.

Format 4 prevents older firmware from accepting a widened image and silently
misinterpreting its header. Firmware does not migrate the saved image itself:
after upgrading, load the existing v2/v3 image with the current configurator and
save it as v4. Physical inputs remain inactive until that save. JSON imports and
v3 drafts are also supported; frozen v2/v3 configurators remain available for
older firmware. The HID transport version and packet layout remain unchanged;
GET_INFO reports the new format version and the hardware's layer limit.

Validation covers every startup layer at the hardware maximum, highest-layer
bindings, local/global chords and their precedence, exact storage capacity and
overflow, absolute/persistent/one-shot/momentary switches, and relative switching
for every start layer, layer count 1–7, and offset -6..+6. Indicator timing is
checked through the maximum layer number for both physical variants. Host tests
and firmware builds do not replace a physical USB-device test; no hardware was
flashed during this experiment.
