# Alternative Candidate Measurements

Six/three ordering throughout. Deltas are measured against the named parent. `RAM FAIL` rows are unsuccessful diagnostic links; their stack figures are not usable reserves. All nonbaseline candidates exceed the real 14336-byte flash limit.

| Candidate | Parent | Flash Six/Three | Delta Six/Three | Stack Six/Three | XSEG Six/Three | Layout | Change |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `baseline` | `-` | 14205/14201 | +0/+0 | 102/105 | 404/395 | Pass | Unchanged active firmware. |
| `wrapper-external` | `baseline` | 14689/14685 | +484/+484 | 98/101 | 420/405 | Pass | Previous small wrapper, exclude chord actions and remove the unnecessary chord-owner timestamp. |
| `wrapper-internal` | `wrapper-external` | 14665/14661 | -24/-24 | 82/91 | 404/395 | Pass | Place pending timestamps and release parameter in internal RAM. |
| `wrapper-internal-fixed` | `wrapper-internal` | 14645/14641 | -20/-20 | 82/91 | 404/395 | Pass | Fixed 200ms threshold; per-binding selectors are ignored in this diagnostic format. |
| `sparse-internal` | `baseline` | 14903/14899 | +698/+698 | 83/95 | 404/395 | RAM FAIL | Ten-byte header, three-byte hold records, independent deadlines and cached ordinary taps. Initial internal layout fails. |
| `sparse-narrow` | `sparse-internal` | 14871/14867 | -32/-32 | 76/88 | 404/395 | Pass | Byte-bound metadata subtotals, indirect validator temporaries and lookup argument restore a valid layout. |
| `sparse-fixed` | `sparse-narrow` | 14839/14835 | -32/-32 | 76/88 | 404/395 | Pass | Fixed 200ms threshold instead of eight profile-wide threshold choices. |
| `sparse-single` | `sparse-narrow` | 14885/14881 | +14/+14 | 94/97 | 404/395 | Pass | One pending dual-role input; chord matching before interruption promotion; ordinary chord state remains separate. |
| `sparse-single-fixed` | `sparse-single` | 14855/14851 | -30/-30 | 94/97 | 404/395 | Pass | Fixed 200ms threshold for the single-pending comparison. |
| `sparse-tag` | `sparse-narrow` | 14849/14845 | -22/-22 | 83/92 | 404/395 | Pass | Internal runtime marker replaces the per-input hold-reference array; resolve normal tap through saved assignment ID. |
| `sparse-tag-fixed` | `sparse-tag` | 14819/14815 | -30/-30 | 83/92 | 404/395 | Pass | Fixed 200ms threshold for the runtime-marker comparison. |
| `wrapper-internal-fixed-raw` | `wrapper-internal-fixed` | 14621/14617 | -24/-24 | 75/84 | 397/388 | Pass | Move raw input levels into internal RAM. |
| `wrapper-internal-fixed-temps` | `wrapper-internal-fixed` | 14669/14665 | +24/+24 | 91/100 | 402/393 | RAM FAIL | Try internal telemetry temporaries; compiler spills fail direct RAM allocation. |
| `wrapper-internal-fixed-maxram` | `wrapper-internal-fixed` | 14643/14639 | -2/-2 | 81/90 | 392/383 | RAM FAIL | Raw levels, telemetry temporaries/layer and error clock in internal RAM; layout fails. |
| `wrapper-internal-fixed-clocks` | `wrapper-internal-fixed` | 14613/14609 | -32/-32 | 70/79 | 392/383 | Pass | Move debounce clock array into internal RAM, release parameter back to xdata to retain 70-byte floor. |
| `wrapper-internal-fixed-live` | `wrapper-internal-fixed` | 14627/14623 | -18/-18 | 70/79 | 392/383 | Pass | Move telemetry counters into internal RAM and mouse snapshot to xdata; meets floor but smaller saving. |
| `sparse-tag-fixed-maxram` | `sparse-tag-fixed` | 14817/14813 | -2/-2 | 71/80 | 392/383 | Pass | The same raw/telemetry/error-clock relocation fits this overlay layout, but saves only two flash bytes. |
| `sparse-fixed-merged` | `sparse-fixed` | 14795/14791 | -44/-44 | 76/88 | 404/395 | Pass | Merge hold lookup into configBinding return value; reuse computed layer/input context and parameter storage. |
| `sparse-tag-fixed-merged` | `sparse-tag-fixed` | 14809/14805 | -10/-10 | 83/92 | 404/395 | Pass | Merge lookup into ordinary binding read for the runtime-marker variant. |
| `sparse-single-fixed-merged` | `sparse-single-fixed` | 14817/14813 | -38/-38 | 94/97 | 404/395 | Pass | Merge lookup into ordinary binding read for the single-pending variant. |
| `wrapper-internal-fixed-bound` | `wrapper-internal-fixed` | 14621/14617 | -24/-24 | 82/91 | 404/395 | Pass | Central physical-record bound rejects chord/nested wrappers; remove separate context handling and body F checks. |
| `wrapper-internal-fixed-bound-clocks` | `wrapper-internal-fixed-bound` | 14589/14585 | -32/-32 | 70/79 | 392/383 | Pass | Combine centralized validation with both timestamp arrays in internal RAM. |
| `wrapper-single` | `wrapper-internal-fixed-bound` | 14795/14791 | +174/+174 | 96/99 | 404/395 | Pass | Reuse existing chord pending slot/timestamp; preserve matching chords, layer changes and encoder overlap. Extra control paths outweigh state savings. |
| `wrapper-single-raw` | `wrapper-single` | 14771/14767 | -24/-24 | 89/92 | 397/388 | Pass | Move raw levels into internal RAM. |
| `sparse-fixed-merged-linear` | `sparse-fixed-merged` | 14771/14767 | -24/-24 | 76/88 | 404/395 | Pass | Linear layer/input ordinal replaces bit fields; one identifier range check replaces layer/input checks. |
| `wrapper-internal-bound-clocks` | `wrapper-internal-fixed-bound-clocks` | 14611/14607 | +22/+22 | 70/79 | 392/383 | Pass | Restore per-binding configurable 32-512ms thresholds. |
| `wrapper-single-raw-clocks` | `wrapper-single-raw` | 14739/14735 | -32/-32 | 77/80 | 385/376 | Pass | Move debounce clocks into internal RAM, release parameter back to xdata. |
| `sparse-fixed-merged-linear-raw-release` | `sparse-fixed-merged-linear` | 14751/14747 | -20/-20 | 71/83 | 399/390 | Pass | Move raw levels into internal RAM and release parameter to xdata, leaving 71-byte six-key stack. |
| `sparse-fixed-merged-linear-tail` | `sparse-fixed-merged-linear` | 14777/14773 | +6/+6 | 76/88 | 404/395 | Pass | Place hold records at image end; cheaper lookup but extra macro boundary/terminator validation. Net growth. |
| `sparse-fixed-merged-linear-tail-raw-release` | `sparse-fixed-merged-linear-tail` | 14757/14753 | -20/-20 | 71/83 | 399/390 | Pass | Apply raw-level/release-argument placement to the tail-table alternative. |
| `sparse-single-fixed-merged-linear-raw-clocks` | `sparse-single-fixed-merged` | 14737/14733 | -80/-80 | 75/78 | 385/376 | Pass | Combine linear IDs and raw/debounce-clock relocation while retaining chord-first single-pending behavior. |
| `wrapper-internal-fixed-bound-clocks-combined` | `wrapper-internal-fixed-bound-clocks` | 14673/14669 | +84/+84 | 70/79 | 392/383 | Pass | Compose optional-input HID layer command and adapt header/test contexts. |
| `wrapper-internal-bound-clocks-combined` | `wrapper-internal-bound-clocks` | 14695/14691 | +84/+84 | 70/79 | 392/383 | Pass | Compose HID with configurable thresholds. |
| `sparse-fixed-merged-linear-raw-release-combined` | `sparse-fixed-merged-linear-raw-release` | 14835/14831 | +84/+84 | 71/83 | 399/390 | Pass | Compose HID with independent sparse holds and ten-byte profile test fixtures. |
| `sparse-single-fixed-merged-linear-raw-clocks-combined` | `sparse-single-fixed-merged-linear-raw-clocks` | 14821/14817 | +84/+84 | 75/78 | 385/376 | Pass | Compose HID with the nonpreferred single-pending sparse prototype. |
