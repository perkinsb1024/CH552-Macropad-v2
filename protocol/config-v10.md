# Macropad configuration image, version 10

Version 10 makes timed actions optionally layer-specific and changes their
interval resolution from 131.072 seconds to 4.096 seconds. The maximum duration
remains 8,388.608 seconds. All actions and other fields use the
[v9 encoding](config-v9.md), except the version byte and timed records specified
here. The image remains 128 bytes, with the same nine-byte header, CRC, palette
version 3 and HID transport version 1.

## Header and record placement

Header byte 2 is `10`. GET_INFO advertises format 10. Firmware validates and
accepts only v10; older DataFlash remains readable and unchanged, but inputs and
timers are inactive until a valid v10 image is explicitly saved. There is no
on-device migration or automatic erase.

Header bytes 3–5 retain their v9 meanings. Timer count is
`(byte3 >> 6) | ((byte4 >> 7) << 2)` and must be 0–4. Layer count is 1–5 on the
six-key pad and 1–7 on the three-key pad. The image contains the header, all
layers, sorted three-byte chord records, timers in editor order and the shared
string pool, followed by zero padding.

The used size is `9 + layerSize * layers + 3 * chords + 6 * timers + poolUsed`.
Layer size remains 22 bytes for six keys and 15 for three keys. The sum must not
exceed 128 bytes. The CRC algorithm and excluded CRC bytes 6–7 are unchanged.

## Six-byte timed records

| Offset | Meaning |
| --- | --- |
| 0 | Low eight bits of interval minus one |
| 1–2 | Expiry action, ordinary two-byte encoding |
| 3–4 | Next-input action, ordinary two-byte encoding; **None** is allowed |
| 5 bits 0–2 | Scope: 0 means **All layers**; 1–7 means zero-based layer index plus one |
| 5 bits 3–5 | High three bits of interval minus one |
| 5 bit 6 | Consume the first physical input after firing |
| 5 bit 7 | Restart interval on physical input |

The interval is `(byte0 | ((byte5 & 0x38) << 5)) + 1`: 1–2,048 ticks.
One tick is 4.096 seconds. Scope must be zero or no greater than the layer count.
Every metadata bit is defined. Expiry and next-input actions must be compatible
with rotation: no action requiring physical release may be stored in either
slot. All existing v9 action codes, text addressing and parameter validation
remain unchanged.

## Runtime behavior

Global timers count regardless of the effective layer. A scoped timer counts
only on its assigned effective layer. Every actual effective-layer transition
resets all scoped timers' interval age and fractional phase, including momentary
and one-shot transitions. Selecting the already-effective layer does not reset
them; global phases are unaffected by layer changes.

Timers repeat. Key presses, encoder button presses and completed encoder detents
reset timers whose input-restart flag is set, including inactive scoped timers.
Releases, held repeats, partial encoder motion and timer-generated actions do
not constitute physical input.

Expiry arms one next-input action; repeated expiries coalesce into one pending
action. Layer transitions preserve that pending state. On the next physical
input, all armed timers run their next-input actions in record order, even if
their assigned layers are inactive. If any requests consumption, the normal
binding is skipped. Consumption works with **None** too. Otherwise the normal
binding is resolved after the follow-ups, so their layer changes can affect it.
Timer actions and a consumed input leave an armed one-shot layer return intact.
Encoder-hold bootloader detection remains available for consumed presses.

Each timer retains an independent fractional byte. A carry of 256 fine ticks
advances its interval age; each fine tick is 16 ms. Start/reset alignment error
is less than approximately 16 ms early, separately from poll/queue delays and
oscillator drift. The byte fine clock wraps every 4.096 seconds; poll gaps must
remain below that duration. Existing queue limits and drop policies still apply.

## JSON, drafts and migration

JSON version 10 uses the existing `timedActions` list with `ticks`, boolean
`resetOnInput`, boolean `consumeInput`, `action` and `resumeAction`. Optional
`layer` is a zero-based layer index; omit it for a global timer. `ticks` must be
1–2,048. The editor provides **Run on**, **All layers** or a specific layer, and
an interval slider in 4.096-second steps with a duration label including hours
for long intervals. Layer reordering remaps
timer assignments. Removing an assigned layer preserves the timer and both
actions, marks its assignment invalid, and requires explicit reassignment before
saving.

The editor reads binary formats 2–10 and JSON versions 1–10. V7–v9 timer ticks
are multiplied by 32 exactly, preserving their durations, both flags and both
actions; migrated timers remain global. Earlier action migration rules remain
source-version-specific, so old text records cannot become consumer holds.

Each migrated timer needs one additional storage byte. If a valid legacy image
no longer fits, the editor preserves the complete profile, reports the precise
storage excess and blocks encoding/device saving. The user can export JSON and
explicitly reduce text, chords, timers or layers to make room. No data is
automatically dropped. Oversized JSON imports and drafts remain editable too.

V10 drafts use `universal-macropad:format-v10:` and recover v9 and older drafts
without overwriting the originals. Legacy timer conversion occurs once according
to the source version; current drafts/JSON are not scaled again. The active
editor refuses connections to older firmware and links to its frozen editor,
including the newly archived v9 configurator and live view. Firmware upgrades
require an explicit **Save to device** after migration to reactivate inputs.
