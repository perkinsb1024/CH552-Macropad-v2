# Candidate Measurements

All values are measured bytes. Failed production-limit links are retained as diagnostics.

| Candidate | Flash Six/Three | Added Flash Six/Three | Stack Six/Three | Real-Limit Links |
| --- | --- | --- | --- | --- |
| `baseline` | 14205 / 14201 | 0 / 0 | 102 / 105 | Pass / Pass |
| `basic` | 14277 / 14273 | 72 / 72 | 102 / 105 | Pass / Pass |
| `initial-wake` | 14359 / 14355 | 154 / 154 | 101 / 104 | Fail / Fail |
| `narrow-wake` | 14339 / 14335 | 134 / 134 | 101 / 104 | Fail / Pass |
| `packed-wake` | 14337 / 14333 | 132 / 132 | 102 / 105 | Fail / Pass |
| `packed-first-wake` | 14341 / 14337 | 136 / 136 | 102 / 105 | Fail / Fail |
| `shared-basic` | 14273 / 14269 | 68 / 68 | 102 / 105 | Pass / Pass |
| `shared-wake` | 14331 / 14327 | 126 / 126 | 102 / 105 | Pass / Pass |
| `shared-reset-wake` | 14317 / 14313 | 112 / 112 | 102 / 105 | Pass / Pass |
| `input` | 14283 / 14279 | 78 / 78 | 102 / 105 | Pass / Pass |
| `optional-input` | 14291 / 14287 | 86 / 86 | 102 / 105 | Pass / Pass |
| `input-early` | 14287 / 14283 | 82 / 82 | 102 / 105 | Pass / Pass |
| `optional-input-early` | 14295 / 14291 | 90 / 90 | 102 / 105 | Pass / Pass |
| `opt-all` | 14321 / 14317 | 116 / 116 | 102 / 105 | Pass / Pass |
| `opt-final` | 14315 / 14311 | 110 / 110 | 102 / 105 | Pass / Pass |
| `input-inline` | 14283 / 14279 | 78 / 78 | 102 / 105 | Pass / Pass |
| `optional-input-inline` | 14293 / 14289 | 88 / 88 | 102 / 105 | Pass / Pass |
| `input-mask` | 14287 / 14283 | 82 / 82 | 102 / 105 | Pass / Pass |
| `optional-input-mask` | 14295 / 14291 | 90 / 90 | 102 / 105 | Pass / Pass |
| `input-both` | 14289 / 14285 | 84 / 84 | 102 / 105 | Pass / Pass |
| `optional-input-both` | 14299 / 14295 | 94 / 94 | 102 / 105 | Pass / Pass |
| `input-clean` | 14281 / 14277 | 76 / 76 | 102 / 105 | Pass / Pass |
| `optional-input-clean` | 14289 / 14285 | 84 / 84 | 102 / 105 | Pass / Pass |

`opt-index`, `opt-early`, `opt-slot` and `opt-bit` were prepared as
separate source probes but were not linked individually. Their combined
effects are measured in `opt-all` / `opt-final`; no isolated savings are claimed.
