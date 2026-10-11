# Modified Consumer Hold Investigation

The later [V14 Hold Implementation Findings](v14-hold-implementation.md) record
the implemented, fitted result. Type allocations below describe earlier
prototypes; use the provisional [V14 reference](config-v14.md) for the fitted
firmware encoding.


Investigated 2026-10-11 against main commit
`934fa05b9ea3977bb49d5658bda00d44d23caca2`. Firmware, the active configurator,
archives and checked-in releases are unchanged. The firmware prototype and its
additional tests exist only in a temporary source tree.

## Finding

A self-contained **Media / system hold with modifiers** can occupy exactly two
bytes, retaining all four modifier bits and nonzero eight-bit Consumer Page
usages. The most focused encoding change is to combine **Set layer** and
**Layer while held** into one action type, freeing type `0xA` for the new hold.
The separate configurator controls can retain their existing labels and behavior.

The tested prototype adds 28 flash bytes on both hardware variants, with no
additional allocated RAM or reduction in stack capacity. Current main has only
8/10 flash bytes free, so the prototype needs another 20/18 bytes of savings
before it fits the real application limit. This investigation establishes
encoding and firmware feasibility; it does not establish a production-ready fit
or host hardware behavior.

## Encoding Proposal

All sixteen low-nibble action types are allocated in v13. Its modified consumer
tap already uses all remaining bits: four modifier bits and eight usage bits.
There is no spare hold flag in that record. Adding modifiers to a full twelve-bit
consumer usage would need 20 bits with the existing four-bit type convention.

The proposed new format uses the following records:

| Action | First Byte | Second Byte |
| --- | --- | --- |
| **Set layer**, persistent | `09` | Existing layer index or `FF` for the previous layer |
| **Set layer**, one-shot | `19` | Existing layer index or `FF` for the previous layer |
| **Layer while held** | `29` | Existing layer index; `FF` rejects |
| **Media / system with modifiers**, tap | `04 \| (modifiers << 4)` | Usage `01`–`FF` |
| **Media / system hold with modifiers** | `0A \| (modifiers << 4)` | Usage `01`–`FF` |
| Existing unmodified **Consumer tap** | `07 \| ((usage >> 8) << 4)` | Usage low byte |
| Existing unmodified **Consumer hold** | `08 \| ((usage >> 8) << 4)` | Usage low byte |

Modifier masks retain their existing interpretation: **Ctrl** = 1, **Shift** = 2,
**Alt** = 4 and **GUI** = 8. All sixteen masks are accepted, including zero.
Examples are `6A 6F` for Shift + Alt with brightness up held, and `6A 70` for
brightness down. Existing `64 6F` and `64 70` remain taps. Volume usages `E9`/`EA`
also fit; modified usages above `FF` do not. Existing unmodified usages through
`FFF` are preserved. These actions continue to use the Consumer Page; the proposal
does not add a separate HID System Control usage page.

The new hold is valid on physical keys, encoder press and chords. It rejects on
encoder rotation, both timed-action fields and macro steps. Layer auxiliary
values above 2 reject, and layer mode 2 retains the physical hold restrictions.

## Firmware Work

Most lifecycle support already exists in `src/actions.c`: the shared consumer
lane tracks its winning physical input, pending usage, temporary modifiers and
release retries. `buttonFirst`/`buttonSecond` preserve the original binding for
release and report-generation reassertion.

The prototype changes these paths:

- `src/config.h`: assign the new hold type and encode momentary layers as full
  byte `29`, rather than a separate low-nibble type.
- `src/config.c`: validate the new eight-bit usage and binding restrictions;
  recognize layer auxiliary mode 2 with the existing layer bounds.
- `flushOutputs`: interpret both modified consumer types' auxiliary nibble as
  modifiers, rather than the high usage nibble. Existing keyboard merging queues
  changed modifiers before the consumer press.
- `runAction`: give modified holds physical consumer ownership. Preserve or
  schedule the previous consumer release before applying replacement modifiers,
  including ordinary tap to modified hold and ordinary hold to modified hold.
- `releaseAction`: retain a briefly pressed modified hold until its press report
  is accepted, then use the existing release retry path.
- Layer dispatch and `updateLayer`: identify momentary layers by full byte `29`.

Both consumer hold types have bit 3 set, while tap types 4/7 do not, so the
existing compact hold-owner assignment can remain. No new report descriptor,
USB report buffer, queue or persistent state byte is necessary.

The proposed semantics retain the existing latest-wins consumer policy. A newer
consumer action releases a modified hold's consumer output and modifier
contribution; its still-depressed trigger does not restore either afterward.
Releasing an older superseded trigger cannot release the newer winner. Modifiers
contributed by other physical keyboard holds or temporary keyboard taps remain.

A modified hold retains its binding across effective-layer changes until
physical release, just like existing consumer and keyboard holds. Either chord
member releases it. Configuration/action reset clears it through the existing
consumer-release-before-keyboard-cleanup path; report-generation changes reassert
the winner. Host interpretation and repetition still require hardware checking.
Other simultaneous keyboard, mouse or consumer output can inherit these modifiers
while active because the host receives one combined keyboard modifier state.

## Combining Actions Instead

Two separate physical inputs already work: assign a modifier-only **Key hold**
to one input and **Media / system hold** to another. The keyboard merger keeps
the modifiers active while the consumer usage is held. This uses four action
bytes across two bindings and requires no format change.

Two existing actions cannot currently be combined on one input. A binding has
one record, and **Execute macro** rejects both **Key hold** and **Consumer hold**.
Normal macros have no physical release lifecycle. Simply allowing those steps
would leave their release, ownership and cancellation behavior undefined.

A special compound hold could be implemented using a two-byte reference to a
stored pair: modifier-only **Key hold**, then twelve-bit **Consumer hold**.
Using the existing zero-terminated macro-tail layout would require two reference
bytes plus four step bytes plus a terminator: seven configuration bytes per
unique compound binding, with possible sharing. A fixed pair pool could omit
the terminator for six bytes, but needs a new pool layout and validation rules.
Both keep individual records at two bytes and can support modified twelve-bit
usages. Neither keeps the complete binding at two bytes.

That approach additionally requires a new compound invocation lifecycle tied to
its physical input, decoding both components during press/reassertion, explicit
modifier ownership, and cleanup after supersession and release. End-of-run macro
holds would instead release when playback ends, not when the input is released.
The existing consumer lane gives the dedicated two-byte action a narrower
implementation than either general macro holds or a compound-action pool.

Combining absolute and relative layer actions using an auxiliary mode bit was
subsequently measured; see the follow-up below. Another unmeasured option is to
combine **Key tap** and **Key hold** using parameter bit 7 as hold, since current supported keyboard
usages are below `80`. The latter changes keyboard decoding and every hold path.
Restricting usages or modifier combinations, or adding a usage-index lookup table,
could also create room for a hold flag but introduces feature limits or table cost.

## Measured Resources and Validation

Build settings: CH55xDuino 0.0.25, SDCC build.13407_4, small memory model, size
optimization, 24MHz and 148 USB DMA bytes. The real application limit is 14,336
bytes. Baselines link at that limit. Prototype measurement builds use a temporary
16,384-byte linker limit to inspect the over-budget images; this does not make
them deployable with the current bootloader layout.

| Source | Six-Key Flash | Three-Key Flash | Change vs. Main | Free / Over Budget, Six / Three |
| --- | ---: | ---: | ---: | --- |
| Main baseline | 14,328 | 14,326 | 0 / 0 | 8 / 10 free |
| Layer consolidation only | 14,328 | 14,326 | 0 / 0 | 8 / 10 free |
| Consolidation plus modified hold | 14,356 | 14,354 | +28 / +28 | 20 / 18 over |

All three sources reserve 81/84 stack bytes on six/three keys. Paged external RAM
remains 105 bytes at `094`–`0FC`. Ordinary XSEG remains 365/356 bytes; the absolute
128-byte configuration and USB DMA allocations also remain unchanged. Native
memory-layout and startup checks pass. These are linked allocations, not runtime
stack high-water measurements.

The layer-only prototype passes the host suites. The complete prototype passes
with and without color preview, including both geometries for the additional
modified-hold suite and existing USB, macro, timer and input suites. The new
suite validates every modifier/usage combination, usage-zero rejection, encoder
press acceptance and rotation/timer/macro rejection. Runtime cases cover all
modifier masks, short presses with rejection at each report boundary, overlapping
physical keys/modifiers, layer retention, chord release, report-generation
reassertion, reset cleanup, and modified/unmodified tap/hold replacement.

The initial 26-byte implementation was revised because it could discard an
ordinary tap's pending release when a modified hold arrived. Preserving that
release costs another two bytes in these builds and is included in the final
28-byte measurement. Existing suites needed only updates to their expectations
for the changed layer encoding and the newly assigned type.

Temporary artifacts are under
`/private/tmp/macropad-modified-hold-investigation/`: `baseline`, `combined-layer`
and `modified-hold` source trees, `build-<source>-0/1` outputs, host/build logs and
`prototype.patch`. The patch includes the firmware changes and additional tests.
No web prototype, hardware flashing, release generation or commit was performed.

## Configurator and Format Transition Work

Production implementation should use a new configuration version, provisionally
14. Relabeling old images would interpret old `0A layer` momentary bindings as
consumer holds or reject them when their parameter is zero. Migration must decode
old actions by their source version and re-encode momentary layers as `29 layer`,
then recompute CRC. Record sizes and offsets remain unchanged for v13-to-new-format
binary conversion. The HID transport version can remain 1.

The configurator needs changes in the action model/constants/descriptors,
validation, encoder/decoder, JSON import/export and drafts, inspector controls and
action labels. A new hold action can share the modified tap's usage picker and
four modifier controls, with `needsRelease` enforced at every binding site.
The layer controls retain their named semantics while sharing an encoded type.
Codec/firmware agreement, migration and UI restrictions need web regression tests.

Before switching the active editor, freeze the finalized v13 production build
under `webapp/public/versions/format-v13/`, following
[the archive instructions](../webapp/archives/README.md), with provenance,
checksums, archive index and routing. Existing archives remain unchanged. Write
a standalone specification for the new format and run `npm run build` after
web changes, including archive checksum verification.

The recommended implementation path is layer-type consolidation plus the
dedicated eight-bit modified hold, followed by measured flash savings sufficient
for both variants and host hardware validation. A compound reference is an
alternative if modified usages above `FF` are a requirement and the extra
configuration storage is acceptable.

## Three-Way Layer Consolidation Follow-Up

The proposed combination of **Set layer**, **Momentary layer** and **Relative
layer** into one low-nibble type is feasible without losing existing semantics
or increasing record size. With type `9`, assign auxiliary bits 0–1 to the mode,
bit 2 to relative addressing, and reserve bit 3 as zero:

| Addressing | Persistent, Mode `00` | One-Shot, Mode `01` | Hold, Mode `10` |
| --- | --- | --- | --- |
| Absolute | `09` | `19` | `29` |
| Relative | `49` | `59` | `69` |

The parameter is an absolute layer index or a signed relative offset, retaining
the existing -6 through +6 range. Absolute persistent/one-shot `FF` still means
the previous layer; relative `FF` means -1. Absolute hold rejects `FF`. Mode `11`
and auxiliary bit 3 reject. Both hold modes reject macro, rotation and timer
bindings. The format leaves types `A` and `B` available, compared with only `A`
for the initial two-way consolidation. A configurator can continue to present
separate named controls despite their common encoded type.

Two temporary variants were built from the same source checkpoint and with the
same compiler/settings as the earlier investigation:

| Layer Encoding | Six-Key Flash | Three-Key Flash | Change vs. Two-Way Consolidation |
| --- | ---: | ---: | ---: |
| Combine absolute set and hold only | 14,328 | 14,326 | 0 / 0 |
| Combine all three, preserve existing five modes | 14,336 | 14,334 | +8 / +8 |
| Combine all three, also implement relative hold | 14,350 | 14,348 | +22 / +22 |

The existing-five-mode variant reserves `69` as invalid; it frees both types
without introducing new behavior. Dispatch moves the existing relative arithmetic
from a separate switch case into a flag-controlled branch in the common layer
case. Validation checks the same flag to choose offset or index/sentinel rules.
That straightforward implementation adds eight bytes rather than saving flash.
It links at the real 14,336-byte limit on both variants, leaving zero/two bytes
free. These are measurements of this implementation, not a minimum possible cost.

Relative hold is a new behavior; existing **Relative layer** supports only
persistent and one-shot operation. The additional prototype resolves the offset
once at press time, then stores an absolute `29 target` in the existing per-input
binding cache. Layer recomputation uses that snapshot until release. Recomputing
the relative target during each layer update would risk drift or an unstable
target after base-layer changes. This implementation costs another fourteen
bytes beyond the five-mode variant, leaving it 14/12 bytes over the real limit.

The prototype resolves relative holds from the selected base layer, matching
existing physical relative actions, and preserves the pre-consumption base when
the press consumes a one-shot layer. Other held overlays do not change the base
used for this calculation. Resolving from the visible effective layer instead
would be another possible new-behavior definition and was not measured here.
Newest-held precedence, restoration of older momentary overlays, release onto
the current underlying base, and either-member chord release retain the existing
momentary semantics. Both prototypes preserve allocated RAM and 81/84 stack
bytes; target snapshotting reuses existing per-input storage.

Both prototypes pass host suites with color preview enabled and disabled.
Additional tests exhaust all auxiliary/parameter values on physical and rotation
bindings for both geometries, reject hold modes in timers/macros, and exercise
relative persistent/one-shot/hold results for every supported layer count,
startup layer and offset. Relative hold tests cover repeated polls, base changes
under an overlay, nested holds, one-shot consumption and chord release. Existing
relative tests were updated to exercise the newly shared full-byte codes; an old
one-shot test loop was changed to explicitly cover both absolute and relative
forms rather than relying on action-number spacing.

Temporary sources, builds, logs and patches are under
`/private/tmp/macropad-layer-consolidation/`, with `three-types` and `relative-hold`
sources and `build-<source>-0/1` outputs. `build-three-types-real-0/1` verifies the
five-mode variant at the real flash limit. These builds exclude the proposed
modified consumer hold, so their costs should not be added mechanically to its
28-byte cost: combined SDCC code layout needs its own measurement. Active
firmware and configurator code remain unchanged.
