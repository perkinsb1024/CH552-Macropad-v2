# Native Measurement Ledger

Six-/three-key values are separate rows. All sizes are bytes. Every real 14336-byte link and native layout check passes.

| Candidate | Board | Flash | Delta from Baseline | Free Flash | Stack | PSEG | XSEG | Total External RAM |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 6 | 14205 | +0 | 131 | 102 | 108 | 404 | 794 |
| baseline | 3 | 14201 | +0 | 135 | 105 | 108 | 395 | 785 |
| no-chords | 6 | 13277 | -928 | 1059 | 113 | 98 | 404 | 784 |
| no-chords | 3 | 13273 | -928 | 1063 | 116 | 98 | 395 | 775 |
| selectable-chords | 6 | 14221 | +16 | 115 | 101 | 108 | 404 | 794 |
| selectable-chords | 3 | 14217 | +16 | 119 | 104 | 108 | 395 | 785 |
| independent | 6 | 13753 | -452 | 583 | 110 | 98 | 420 | 800 |
| independent | 3 | 13749 | -452 | 587 | 113 | 98 | 405 | 785 |
| shared | 6 | 13759 | -446 | 577 | 110 | 98 | 420 | 800 |
| shared | 3 | 13755 | -446 | 581 | 113 | 98 | 405 | 785 |
| header-count | 6 | 13715 | -490 | 621 | 110 | 98 | 420 | 800 |
| header-count | 3 | 13711 | -490 | 625 | 113 | 98 | 405 | 785 |
| unified-chords | 6 | 14221 | +16 | 115 | 101 | 108 | 404 | 794 |
| unified-chords | 3 | 14217 | +16 | 119 | 104 | 108 | 395 | 785 |
