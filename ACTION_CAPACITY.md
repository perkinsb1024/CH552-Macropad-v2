# Intro
Counts below use [configuration format v7](protocol/config-v7.md), which supports 7 layers on a 3-key macropad and 5 layers on a 6-key macropad.

Each count is the total number of assignable physical-input action slots across all configured layers, with no timed actions configured. Encoder wheel actions count clockwise and counterclockwise separately. Chords are simultaneous presses of two physical keys; the encoder press cannot currently be assigned as part of a chord.

With the exception of [Optimal Layout](#optimal-layout-for-maximum-assignable-action-slots) these calculations assume all chords are layer-specific; global chords are not included.
Maximums assume no text strings and that all chords are layer-specific chords - global chords reduce storage required, but also reduce maximum distinct actions. Assignments used to switch layers count toward these totals. If you use layer-specific actions to transition layers, you will need at least `LAYER_COUNT` actions to reach all layers, but you can optimize this by using a global chord with a `Relative Layer: +1` action to increase the maximum assignable action slots.

The 128-byte image uses a 9-byte header, 15 bytes per 3-key layer or 22 bytes per 6-key layer (including LED settings), 3 bytes per chord, and 5 bytes per timed action. There are 3 possible chords per 3-key layer and 15 per 6-key layer.

`Maximum chords = min(key pairs × layers, floor((128 − 9 − layer bytes × layers) / 3))`

Timers are optional and do not reserve storage when absent, so all numeric tables below remain unchanged from v5/v6. Each configured timer subtracts 5 bytes from the shared chord/text budget and provides two separate action records (expiry and next input). These are excluded from the physical-input totals. With timers and strings, subtract `5 × timer count + string-pool bytes` from the formula numerator above.

Text actions also need string-pool storage: each distinct string uses one byte per character plus a terminating byte. That storage counts against the maximum chord count. Unassigned keys and encoder actions still occupy their fixed layer slots.

# Optimal Layout for Maximum Assignable Action Slots
To achieve the maximum number of assignable action slots, use the maximum number of layers and a single, global chord with a `Relative Layer: +1` action to switch layers. With that setup, you'll get:

| | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Layers | 7 | 5 |
| Total action slots | 46 | 48 |
| Required layer-switching actions (global chord) | 1 | 1 |
| Remaining usable action slots | 45 | 47 |

# Complete Calculations for Each Layer Count

Each table compares the two macropads at the same layer count. Chord counts are maximums; storage and free space are in bytes at those maximums. N/A means the layer count is unsupported.

## 1 Layer

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 3 | 6 |
| Encoder press | 1 | 1 |
| Encoder wheel | 2 | 2 |
| Chords | 3 | 15 |
| **Total** | **9** | **24** |
| Storage used | 33/128 | 76/128 |
| Free space | 95 | 52 |

## 2 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 6 | 12 |
| Encoder press | 2 | 2 |
| Encoder wheel | 4 | 4 |
| Chords | 6 | 25 |
| **Total** | **18** | **43** |
| Storage used | 57/128 | 128/128 |
| Free space | 71 | 0 |

## 3 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 9 | 18 |
| Encoder press | 3 | 3 |
| Encoder wheel | 6 | 6 |
| Chords | 9 | 17 |
| **Total** | **27** | **44** |
| Storage used | 81/128 | 126/128 |
| Free space | 47 | 2 |

## 4 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 12 | 24 |
| Encoder press | 4 | 4 |
| Encoder wheel | 8 | 8 |
| Chords | 12 | 10 |
| **Total** | **36** | **46** |
| Storage used | 105/128 | 127/128 |
| Free space | 23 | 1 |

## 5 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 15 | 30 |
| Encoder press | 5 | 5 |
| Encoder wheel | 10 | 10 |
| Chords | 14 | 3 |
| **Total** | **44** | **48** |
| Storage used | 126/128 | 128/128 |
| Free space | 2 | 0 |

## 6 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 18 | N/A |
| Encoder press | 6 | N/A |
| Encoder wheel | 12 | N/A |
| Chords | 9 | N/A |
| **Total** | **45** | N/A |
| Storage used | 126/128 | N/A |
| Free space | 2 | N/A |

## 7 Layers

| Action / storage | 3-Key Macropad | 6-Key Macropad |
| --- | ---: | ---: |
| Keys | 21 | N/A |
| Encoder press | 7 | N/A |
| Encoder wheel | 14 | N/A |
| Chords | 4 | N/A |
| **Total** | **46** | N/A |
| Storage used | 126/128 | N/A |
| Free space | 2 | N/A |
