# Two-Byte Candidate Hypotheses

These proposals began as hypotheses, not recovered bootloader commands.
The 21 listed candidates were subsequently tested in normal factory mode; all
completed full transfers and none produced an observed bootloader transition.
Payloads exclude report ID `03`; remaining payload bytes would be zero.

## Evidence and Priority

The executable uses `AA A1` to save LED configuration and `AA AA` to save key
configuration. This makes `AA` the strongest evidence-backed prefix for exploring
an unrecognized second-byte operation. Numerical gaps do not prove handlers exist.

| Priority | Candidate Payload Prefixes | Rationale |
| --- | --- | --- |
| First | `AA A0`, `AA A2` through `AA A9`, `AA AB`, `AA AC` | Values near the two known save operations. Tests whether the apparent subcommand space has another operation. |
| Second | `AA 55`, `AA 5A`, `AA FF` | Speculative confirmation/magic-value patterns; no direct evidence for this device. |
| Lower | `A1 00`, `A1 04`, `A1 FF` | Boundary-value hypotheses. Executable evidence says byte 1 is a layer argument, not a subcommand; the executable substitutes layer 1 for zero. |
| Speculative | `55 AA`, `5A A5`, `F0 5A`, `FF AA` | Pattern guesses under otherwise unknown prefixes. No recovered handler or executable path supports them. |

A full second-byte sweep under `AA` tests the subcommand space without assuming
adjacent values matter. The user subsequently authorized including the two known
saves, so `second --prefix AA --include-known` now runs all 256 second-byte values.
Targeted `probe` packets with `--include-known` can select individual candidates.

Do not prioritize `B0` or `01`–`12` on the available evidence: their trailing
bytes describe LED/key/control configuration. Changing them is more likely to
exercise configuration writes than a separate operation. These proposals
were tested separately from the first-byte Mac validation.
