# Tap-Hold Candidate Measurements

All deltas are measured against the named parent, not estimates. Six/three values are ordered consistently. `RAM FAIL` means linker placement failed; its reported flash/stack figures are diagnostic and are not usable firmware measurements. Every nonbaseline candidate fails the real flash limit.

| Candidate | Parent | Flash Six/Three | Delta Six/Three | Stack Six/Three | XSEG Six/Three | Layout | Change |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `baseline` | `-` | 14205/14201 | +0/+0 | 102/105 | 404/395 | Pass | Unchanged active firmware. |
| `initial` | `baseline` | 14789/14785 | +584/+584 | 104/107 | 418/409 | RAM FAIL | First complete wrapper/block implementation; direct parameter and validator storage fails internal RAM allocation. |
| `ram` | `initial` | 14843/14839 | +54/+54 | 109/112 | 425/416 | RAM FAIL | Move new helper parameters to xdata; still fails internal RAM due to validator spills; reject. |
| `shared-clock` | `initial` | 14803/14799 | +14/+14 | 106/109 | 418/409 | RAM FAIL | Share a decision clock between release/poll; idata validator metadata; still fails internal RAM. |
| `narrow` | `shared-clock` | 14765/14761 | -38/-38 | 97/100 | 418/409 | Pass | Byte-cast alignment subtraction and bounded block arithmetic; simplify threshold shifts. First valid RAM layout. |
| `combined-loop` | `narrow` | 14727/14723 | -38/-38 | 97/100 | 418/409 | Pass | Validate alternating tap/hold records in one two-byte loop instead of two calls per four-byte record. |
| `fixed-clock` | `narrow` | 14741/14737 | -24/-24 | 97/100 | 418/409 | Pass | Diagnostic fixed 200ms threshold; changes new-feature behavior, not selected or validated. |
| `external-state` | `combined-loop` | 14769/14765 | +42/+42 | 109/112 | 423/414 | RAM FAIL | Move decision clock, validator metadata and branch parameter to xdata; spills defeat internal layout; reject. |
| `precheck` | `external-state` | 14799/14795 | +30/+30 | 109/112 | 423/414 | RAM FAIL | Resolve due decisions before physical scanning; parent layout still invalid. |
| `direct-state` | `combined-loop` | 14717/14713 | -10/-10 | 97/100 | 420/411 | Pass | Direct validator metadata with xdata release argument saves flash without adding internal storage. |
| `precheck-good` | `direct-state` | 14749/14745 | +32/+32 | 97/100 | 420/411 | Pass | Extract due-input resolution and call it before scanning and during output polling; correct same-frame layer dispatch. |
| `inline-expiry` | `precheck-good` | 14771/14767 | +22/+22 | 97/100 | 420/411 | Pass | Inline expiry predicate at both call sites; grows flash; reject. |
| `stack-safe` | `precheck-good` | 14799/14795 | +50/+50 | 100/103 | 425/416 | Pass | Structured reference checks and external helper state recover three stack bytes, still two below baseline. |
| `one-loop` | `precheck-good` | 14731/14727 | -18/-18 | 97/100 | 420/411 | Pass | Combine pair-body and macro-tail validation in one scan with separate contexts. |
| `stack-final` | `one-loop` | 14761/14757 | +30/+30 | 109/112 | 425/410 | RAM FAIL | Try external state plus local prefix cursor and four/seven timestamps; validator spills fail RAM layout; reject. |
| `byte-count` | `one-loop` | 14701/14697 | -30/-30 | 97/100 | 420/405 | Pass | Bound prefix end with byte arithmetic: original end<=128, optional span<=65, sum<=193; use four timestamps on three-key pad. |
| `split-clock` | `one-loop` | 14729/14725 | -2/-2 | 97/100 | 420/405 | Pass | Compare elapsed>>5 with selector; exact integer equivalence, no timing precision loss. Four/seven timestamps. |
| `dispatch-type` | `one-loop` | 14731/14727 | +0/+0 | 97/100 | 420/405 | Pass | Reuse decoded type in runAction; zero flash saving; no reason to retain. |
| `end-aligned` | `byte-count` | 14703/14699 | +2/+2 | 98/101 | 420/405 | Pass | Use block end for four-byte alignment and tap/hold parity; eliminate stored pair-start byte. |
| `end-aligned-stack` | `end-aligned` | 14739/14735 | +36/+36 | 102/105 | 424/409 | Pass | External decision clock, branch argument and single validator end restore full baseline stack. |
| `end-aligned-small` | `end-aligned` | 14701/14697 | -2/-2 | 98/101 | 420/405 | Pass | Retain exact elapsed>>5 comparison; save two flash bytes. |
| `final-combined` | `end-aligned-stack` | 14823/14819 | +84/+84 | 102/105 | 424/409 | Pass | Earlier composition probe with optional-input HID layer patch; superseded by complete-combined. |
| `complete-small` | `end-aligned-small` | 14701/14697 | +0/+0 | 98/101 | 420/405 | Pass | Recompute effective layer inside branch resolution before release cleanup; no flash-size change. |
| `complete-stack` | `end-aligned-stack` | 14739/14735 | +0/+0 | 102/105 | 424/409 | Pass | Same release-boundary correction, preserving baseline stack. |
| `complete-combined` | `complete-stack` | 14823/14819 | +84/+84 | 102/105 | 424/409 | Pass | Apply optional-input HID layer command, adapt conflicting header context and old test release calls. |
| `complete-small-combined` | `complete-small` | 14785/14781 | +84/+84 | 98/101 | 420/405 | Pass | Same HID composition using the smaller, four-byte-lower-stack variant. |
