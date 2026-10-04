The key difference is **where the next step starts**. Both versions set the indicator and key feedback to the same resulting brightness.

| | Earlier version | New version |
| --- | --- | --- |
| Starting point | The brighter of the two current brightness settings | A remembered position in the Off → Dim → Bright cycle |
| Another LED action changes brightness | The next step follows those new settings | The remembered position stays unchanged |
| Startup | Follows configured brightness settings | Counter starts at Bright; startup lighting still follows the configuration |

**If this button is your only brightness control, they normally behave identically.** Differences appear when presets, timers, other brightness actions, or restores intervene.

For example, using a **+1** action:

| What happens beforehand | Earlier version’s next result | New version’s next result |
| --- | --- | --- |
| After startup, another action sets both Off | **Dim**, because it starts from Off | **Off**, because the counter still starts at Bright |
| A relative press selects Off, then another action forces both Bright | **Off**, because Bright wraps to Off | **Dim**, because the counter still remembers Off |
| Two relative presses select Dim, then another action makes only key feedback Bright | **Both Off**, because the brighter setting is Bright | **Both Bright**, because the counter remembers Dim |

The first row is a “weird” case for the new version: **the first press appears to do nothing**. The following presses select Dim and Bright, so you can still reach either with at most two more presses.

There are some other surprises to watch for:

- **Earlier version:** it follows brightness *settings*, rather than the light you currently see. A Dim layer indicator with Bright key feedback counts as Bright—even when no key is pressed. Consequently, +1 selects Off rather than making the visible Dim indicator brighter.
- **New version:** identical current lighting can produce different next results depending on the remembered position. Its behavior depends on the history of relative-both actions.
- **New version:** **Restore all configured LED settings does not reset the counter.** It restores the lighting while leaving the cycle position alone. Startup, configuration saves, and USB resets reset both.
- **Both versions:** brightness does not enable a disabled indicator, and temporary effects can obscure the normal lighting. Selecting Bright therefore doesn’t always produce visibly bright LEDs.

Your two-more-presses reasoning holds for **±1 and ±2**. Steps divisible by three don’t advance the cycle.

The memory tradeoff is small but real: the new version saves **22 flash bytes per variant**, reducing the added cost from **58 to 36 bytes**, and uses **one internal RAM byte**. That reduces linker stack capacity by one byte; external RAM is unchanged.

The earlier version is easier to predict from the current settings. The new version is smaller and gives a consistent repeating cycle, but that cycle can become detached from the current lighting.