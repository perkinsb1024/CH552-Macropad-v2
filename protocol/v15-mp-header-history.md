# Earlier V15 MP Header

This historical header specification records the unpublished MP/v15 layout
before the B-header implementation. Source: `a50b2e4`, whose format reference
still describes the earlier layout. It is retained for source-image imports;
current firmware uses the complete [Format v15 Reference](config-v15.md).
Action, layer, chord, timer, string and macro record sizes and offsets are unchanged.

## Header and Rainbow Settings

The nine-byte header is:

| Byte | Field | Encoding |
| --- | --- | --- |
| 0–1 | Marker | ASCII `MP` |
| 2 | Format version | `15` |
| 3 | Layers, startup layer, number of timed actions | Bits 0–2: layer count minus one<br>Bits 3–5: startup layer<br>Bits 6–7: low two bits of the number of timed actions |
| 4 | **String**-pool length and number of timed actions | Bits 0–6: used pool bytes<br>Bit 7: high bit of the number of timed actions |
| 5 | Hardware and chords | Bit 0: physical variant (`0` = six keys, `1` = three keys)<br>Bits 1–6: chord count<br>Bit 7: transparent black key LEDs (`0` = opaque, `1` = transparent) |
| 6–7 | CRC | CRC16-CCITT-FALSE, low byte first |
| 8 | **Chord Window** and rainbow settings | Bits 0–3: chord duration in 5ms units<br>Bits 4–5: rainbow phase spacing (`00` = **0°**, `01` = **30°**, `10` = **60°**, `11` = 150°)<br>Bits 6–7: rainbow speed (`00` = **Extra Fast**, `01` = **Fast**, `10` = **Slow**, `11` = **Extra Slow**) |

The number of configured timed actions is `(byte3 >> 6) | ((byte4 >> 7) << 2)`
and must be 0–4. This is a saved configuration value; elapsed timer state is
maintained in RAM and does not update DataFlash.
Layer and startup-layer indices are zero-based. The startup layer must exist.
The chord window is 0–75ms in 5ms units; zero disables chord recognition.
A second press must arrive strictly before the window expires to activate a
mapped chord.

**Rainbow** phase settings use hue increments `0`, `21`, `42`, and `109` in a
256-step cycle. Three-key positions are `0, 1, 2`; six-key positions are
`0, 1, 2, 5, 4, 3`, preserving the physical perimeter order
`1 → 2 → 3 → 6 → 5 → 4`. Each LED's hue is the shared hue plus its position
times the selected increment, modulo 256. A **0°** setting makes all LEDs identical.
The 150° “Scattered Colors” preset starts at approximately 153° (109 hue steps)
and adds independent forward drift: LEDs 1–6 gain one extra hue step every
4, 32, 8, 64, 16, and 128 rainbow frames respectively. This alternates
fast/slow/fast on the top row and slow/fast/slow on the bottom row. Three-key
boards use intervals of 4, 16, and 8 frames (fast/slow/fast). Drift applies only to this preset; other spacing options
keep fixed relative phases. Drift follows the selected animation speed, advances
with rainbow frames, and resets with the base hue on configuration application or
USB reset. Color previews use the saved spacing preset, including its drift.
This is deterministic motion rather than random sampling.

The frame interval is independent of phase spacing:

| Speed Bits | Setting | Hue Step Interval | Full 256-Step Cycle |
| --- | --- | --- | --- |
| `00` | **Extra Fast** | 4ms | 1.024 s |
| `01` | **Fast** (default) | 6ms | 1.536 s |
| `10` | **Slow** | 10ms | 2.560 s |
| `11` | **Extra Slow** | 18ms | 4.608 s |

Spacing applies to every layer's rainbow indication, including timed and blinking
indications. Solid colors and pressed-key overrides retain their existing behavior.
Hardware color previews use the saved profile's phase spacing and speed; save an edited
setting before previewing it. Bits 0–3 still control chords independently.

## CRC

| CRC16-CCITT-FALSE Setting | Value |
| --- | --- |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input/output reflection | None |
| Final XOR | `0x0000` |
| Covered bytes, in order | 0–5, then 8–127 (skip the stored CRC at 6–7) |

