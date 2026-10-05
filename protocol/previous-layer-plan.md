# Previous-layer investigation

Baseline: `7a7d066`, finalized local v7 with four timed actions and temporary LED
effects. Preserve it on `experiment/timed-alerts-v7-64`; use a separate
`experiment/previous-layer` branch for the prototype and measurements.

1. Reuse **Set layer** (action A) parameter `0xFF`, outside both variants' real indices.
   Keep auxiliary 0 persistent and auxiliary 1 one-shot. Reject all other invalid
   indices and keep **Momentary layer** limited to actual layers. No new action or
   record bytes, timer bytes, or configuration version are required.
2. Remember the preceding persistent base layer in one internal RAM byte; compare indirect and direct allocation. Initialize it to startup layer, so previous at startup is harmless.
   Real persistent absolute/relative changes update history; selecting the same
   persistent layer does not. Previous swaps history with the selected layer.
   Momentary overlays and one-shot visits/automatic returns do not update history.
   For persistent timer actions during a one-shot visit, remember the underlying
   persistent layer rather than the transient visit. Preserve existing one-shot
   consumption and held-layer priority.
3. Test startup, repeated toggling, same-layer no-ops, relative changes, held
   momentary layers, one-shot previous, one-shot return, timer expiry/resume,
   invalid sentinels, and both hardware variants' validators.
4. Build both variants against 14,336 bytes using temporary outputs. Compare
   flash, paged/external RAM and stack with baseline (six: 14,165/121 stack;
   three: 14,161/124 stack). Check whether tighter history handling or a different
   sentinel materially affects cost if needed. Remove no existing features.
5. Record measured costs and remaining UI/codec/JSON work. Keep the prototype
   committed on its experiment branch. Do not push or generate release builds.
