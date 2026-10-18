# Chord Optimization Measurements

All sizes are bytes, ordered six/three. Every row passes the real 14336-byte link and native layout checks. A negative parent delta saves flash. Tests cover the selected candidates, not every measured probe.

| Candidate | Parent | Flash | Parent Delta | Baseline Saving | Stack | PSEG | XSEG | Change |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline` | `-` | 14205/14201 | - | 0/0 | 102/105 | 108/108 | 404/395 | Unchanged firmware. |
| `global-byte` | `baseline` | 14205/14201 | +0/+0 | 0/0 | 102/105 | 108/108 | 404/395 | Narrow the global identifier comparison. |
| `lookup-countdown` | `baseline` | 14207/14203 | +2/+2 | -2/-2 | 103/106 | 108/108 | 404/395 | Replace the lookup induction variable with a countdown. |
| `lookup-single-read` | `baseline` | 14199/14195 | -6/-6 | 6/6 | 102/105 | 108/108 | 404/395 | Read each candidate identifier once. |
| `lookup-nibble` | `baseline` | 14207/14203 | +2/+2 | -2/-2 | 100/103 | 108/108 | 404/395 | Compare scope and pair nibbles separately. |
| `pair-inline` | `baseline` | 14179/14175 | -26/-26 | 26/26 | 102/105 | 108/108 | 404/395 | Inline bounded triangular pair arithmetic. |
| `pair-table` | `baseline` | 14212/14208 | +7/+7 | -7/-7 | 102/105 | 108/108 | 404/395 | Use row bases instead of triangular arithmetic. |
| `validator-scope` | `baseline` | 14215/14211 | +10/+10 | -10/-10 | 102/105 | 108/108 | 404/395 | Compare shifted layer limits instead of decoded scope. |
| `validator-order` | `baseline` | 14207/14203 | +2/+2 | -2/-2 | 102/105 | 108/108 | 404/395 | Use incremented IDs and a zero sentinel for ordering. |
| `shared-dispatch` | `baseline` | 14175/14171 | -30/-30 | 30/30 | 102/105 | 108/108 | 404/395 | Share chord and ordinary input dispatch. |
| `cached-mask` | `baseline` | 14173/14169 | -32/-32 | 32/32 | 102/105 | 108/108 | 404/395 | Compute an accepted input mask once. |
| `offset-pair` | `baseline` | 14209/14205 | +4/+4 | -4/-4 | 109/112 | 108/108 | 404/395 | Return an action offset through a pair-oriented API. |
| `mask-lookup` | `baseline` | 14158/14142 | -47/-59 | 47/59 | 108/111 | 108/108 | 404/395 | One mask-based scan serves participation and exact-pair queries. |
| `mask-direct` | `mask-lookup` | 14162/14146 | +4/+4 | 43/55 | 108/111 | 108/108 | 404/395 | Load chosen actions directly into button state. |
| `resolve-unguarded` | `baseline` | 14205/14201 | +0/+0 | 0/0 | 102/105 | 108/108 | 404/395 | Move the pending guard into the layer-update caller. |
| `partner-internal` | `baseline` | 14205/14201 | +0/+0 | 0/0 | 96/99 | 102/102 | 404/395 | Move partner state to indirect internal RAM. |
| `pending-internal` | `baseline` | 14199/14195 | -6/-6 | 6/6 | 98/101 | 104/104 | 404/395 | Move pending state to indirect internal RAM. |
| `local-combined` | `baseline` | 14113/14109 | -92/-92 | 92/92 | 108/111 | 108/108 | 404/395 | Combine local arithmetic, dispatch, mask and validator probes. |
| `mask-combined` | `baseline` | 14100/14084 | -105/-117 | 105/117 | 108/111 | 108/108 | 404/395 | Combine mask API, dispatch, cached mask and validator probes. |
| `mask-callee` | `mask-combined` | 14168/14152 | +68/+68 | 37/49 | 108/111 | 108/108 | 404/395 | Add callee-saves for the lookup. |
| `local-selected` | `baseline` | 14105/14101 | -100/-100 | 100/100 | 102/105 | 108/108 | 404/395 | Combine the beneficial local changes without the mask API. |
| `mask-selected` | `baseline` | 14090/14074 | -115/-127 | 115/127 | 108/111 | 108/108 | 404/395 | Combine mask lookup, shared dispatch and cached input mask. |
| `mask-narrow` | `mask-selected` | 14048/14032 | -42/-42 | 157/169 | 110/113 | 108/108 | 404/395 | Keep scope and ROM table indices byte-sized. |
| `mask-scope` | `mask-selected` | 14058/14042 | -32/-32 | 147/159 | 110/113 | 108/108 | 404/395 | Keep scope byte-sized without narrowing the ROM index. |
| `mask-xor` | `mask-selected` | 14088/14072 | -2/-2 | 117/129 | 108/111 | 108/108 | 404/395 | Compare excluded bits instead of equality with the query mask. |
| `mask-do` | `mask-selected` | 14090/14074 | +0/+0 | 115/127 | 108/111 | 108/108 | 404/395 | Early zero-count return and decrement loop. |
| `mask-physical` | `mask-selected` | 14096/14080 | +6/+6 | 109/121 | 109/112 | 108/108 | 404/395 | Cache physical-key status in a native bit. |
| `mask-time` | `mask-selected` | 14140/14124 | +50/+50 | 65/77 | 110/113 | 108/108 | 404/395 | Share exact 16-bit elapsed comparison in a helper. |
| `mask-time-bytes` | `mask-selected` | 14150/14134 | +60/+60 | 55/67 | 110/113 | 108/108 | 404/395 | Split high/low elapsed comparison inside a shared helper. |
| `mask-release` | `mask-selected` | 14094/14078 | +4/+4 | 111/123 | 108/111 | 108/108 | 404/395 | Capture the partner value in the release condition. |
| `mask-links` | `mask-selected` | 14090/14074 | +0/+0 | 115/127 | 108/111 | 108/108 | 404/395 | Reuse pending input plus one when linking partners. |
| `mask-narrow-time` | `mask-narrow` | 14098/14082 | +50/+50 | 107/119 | 112/115 | 108/108 | 404/395 | Combine narrowed lookup and exact timing helper. |
| `mask-narrow-physical` | `mask-narrow` | 14054/14038 | +6/+6 | 151/163 | 111/114 | 108/108 | 404/395 | Combine narrowed lookup and cached physical status. |
| `mask-final-probe` | `mask-selected` | 14082/14066 | -8/-8 | 123/135 | 113/116 | 108/108 | 404/395 | Compose narrow, bit, time, release, link and loop probes. |
| `mask-inverted` | `mask-narrow` | 14046/14030 | -2/-2 | 159/171 | 110/113 | 108/108 | 404/395 | Store complemented chord masks and test excluded bits directly. |
| `mask-release-byte` | `mask-narrow` | 14034/14018 | -14/-14 | 171/183 | 110/113 | 108/108 | 404/395 | Bound pending-input comparison to one byte. |
| `mask-release-local` | `mask-narrow` | 14044/14028 | -4/-4 | 161/173 | 110/113 | 107/107 | 404/395 | Replace obsolete paged release scratch with a local mask. |
| `mask-inverted-byte` | `mask-inverted` | 14032/14016 | -14/-14 | 173/185 | 110/113 | 108/108 | 404/395 | Add the bounded pending-input comparison. |
| `mask-compact` | `mask-inverted-byte` | 14030/14014 | -2/-2 | 175/187 | 110/113 | 107/107 | 404/395 | Add local release-mask storage. |
| `mask-compact-do` | `mask-compact` | 14028/14012 | -2/-2 | 177/189 | 110/113 | 107/107 | 404/395 | Add zero-count fast return and decrement loop. |
| `mask-compact-register` | `mask-compact` | 14094/14078 | +64/+64 | 111/123 | 110/113 | 107/107 | 404/395 | Add callee-saves for the palette-offset getter. |
| `mask-inline-time` | `mask-narrow` | 14076/14060 | +28/+28 | 129/141 | 112/115 | 108/108 | 404/395 | Inline exact split high/low elapsed comparisons. |
| `mask-compact-unguarded` | `mask-compact` | 14030/14014 | +0/+0 | 175/187 | 110/113 | 107/107 | 404/395 | Move the pending guard into the layer-update caller. |
| `compact-validator-byte` | `mask-compact-do` | 14028/14012 | +0/+0 | 177/189 | 110/113 | 107/107 | 404/395 | Store decoded validation scope in a byte. |
| `compact-validator-fold` | `mask-compact-do` | 14028/14012 | +0/+0 | 177/189 | 110/113 | 107/107 | 404/395 | Fold reserved-bit rejection into pair range checking. |
| `compact-validator-signed` | `mask-compact-do` | 14036/14020 | +8/+8 | 169/181 | 110/113 | 107/107 | 404/395 | Use signed minus-one ordering sentinel. |
| `compact-bit-table` | `mask-compact-do` | 14001/13985 | -27/-27 | 204/216 | 110/113 | 107/107 | 404/395 | Replace repeated bounded variable shifts with seven ROM bytes. |
| `compact-bit-helper` | `mask-compact-do` | 14032/14016 | +4/+4 | 173/185 | 110/113 | 107/107 | 404/395 | Factor shifts into a shared helper instead of a table. |
| `compact-order-init` | `mask-compact-do` | 14024/14008 | -4/-4 | 181/193 | 110/113 | 107/107 | 404/395 | Merge partner initialization with the existing input loop. |
| `final-table` | `compact-bit-table` | 13997/13981 | -4/-4 | 208/220 | 110/113 | 107/107 | 404/395 | Add merged partner initialization. |
| `data-input` | `compact-bit-table` | 13987/13971 | -14/-14 | 218/230 | 109/112 | 106/106 | 404/395 | Store the physical-down mask in direct internal RAM. |
| `data-pending` | `compact-bit-table` | 13969/13953 | -32/-32 | 236/248 | 106/109 | 103/103 | 404/395 | Store pending input/layer/timestamp in direct internal RAM. |
| `data-clock` | `compact-bit-table` | 13987/13971 | -14/-14 | 218/230 | 108/111 | 105/105 | 404/395 | Store only the pending timestamp in direct internal RAM. |
| `data-all` | `compact-bit-table` | 13955/13939 | -46/-46 | 250/262 | 105/108 | 102/102 | 404/395 | Move all five hot input/pending bytes to direct RAM. |
| `data-all-init` | `data-all` | 13951/13935 | -4/-4 | 254/266 | 105/108 | 102/102 | 404/395 | Add merged partner initialization. |
| `final` | `data-all-init` | 13951/13932 | +0/-3 | 254/269 | 105/108 | 102/102 | 404/395 | Clarify mask tables and omit unused native three-key input-bit entries. |
| `optimized-no-chords` | `-` | 13238/13231 | - | 967/970 | 112/115 | 96/96 | 404/395 | Diagnostic removal control with the same generic input optimizations; not adopted. |
