# Transient Fault Hypotheses and Source Audit

## Purpose and Evidence Standard

Broaden the [investigation](INVESTIGATION_PLAN.md) beyond the user's initial
memory-corruption and stack-overflow suggestions. Treat both incidents as
potentially related, without requiring every candidate to explain both before
it can be examined. A proposed shared cause must eventually account for both
the onset and recovery of each incident, including any additional conditions
it needs. Candidate mechanisms are not diagnoses.

The six-key diagnostic remained at or below 35 bytes used out of 77 during
extensive testing. Captured flash and active bytes matched at a later test.
Those results reduce the likelihood of ordinary stack exhaustion in exercised
paths. They do not establish internal runtime state or power/USB conditions
during the original incidents. The invalid-config LED observation itself is
established and is not an evidence gap.

## Three Different Ways to Reach an Unexpected State

1. Correct instructions take an unintended branch because an input, timestamp,
   flag, or validation result is wrong. No corrupted program address is needed.
2. A restart enters startup code, which samples inputs and validates the saved
   profile again. No corrupted return address is needed here either.
3. A damaged return address, stack pointer, register, or instruction stream
   actually redirects execution. Stack overflow is only one possible source.

An LED transfer or rendering fault can additionally produce an error-like
display without either error path executing. This is a distinct hypothesis,
not a reinterpretation of the reported pattern.

## Constraints Established by the Current Code

- [Startup](CH552_Universal_Macropad.ino) calls `enterBootloader()` if a single
  raw read of the encoder button is pressed. This check has no debounce or
  three-second requirement. During ordinary operation, entry requires the
  permission flag, debounced pressed state, and elapsed hold time.
- `enterBootloader()` intentionally transmits all-red feedback before calling
  address `0x3800`. All-red feedback does not independently confirm that the
  subsequent bootloader call completed.
- In [protocol_firmware.c](src/protocol_firmware.c), `activeConfigValid` is
  assigned from startup validation and set true after a successful commit.
  There is no intended ordinary-input or USB-reset operation that clears it.
- USB reset, configuration selection, and relevant endpoint recovery request
  runtime reapplication. Reapplication does not reread flash, revalidate the
  image, or repair the validity flag. Thus USB reconfiguration alone neither
  explains the initial flag becoming false nor its later restoration.
- The normal preview-enabled firmware clears the LED buffer when applying an
  invalid state. Merely clearing the validity flag during operation would
  leave other previously displayed LED channels until some additional path
  changes them. A complete error display therefore contains more information
  than the value of one flag alone.
- The supplied original profile has no timed actions or LED-control macros
  that intentionally generate these indications. Later coverage profiles do
  contain LED effects; keep those workloads distinct.
- The current status payload reports cached saved-flash validity. It does not
  report `activeConfigValid` separately: invalid active state substitutes layer
  zero, which is ambiguous with valid operation on the first layer.

## Concrete Interrupt Parameter Corruption Found

Source and linked assembly expose an interrupt-safety defect independent of
stack exhaustion. SDCC overlays non-reentrant function parameters in shared
internal RAM. Some functions called from the USB interrupt use the same bytes
as foreground functions, without saving/restoring those bytes.

| Internal Address | Foreground Use | USB Interrupt Use |
| --- | --- | --- |
| `0x7C` | `queueAction` second action byte; `pairIndex` second key; `ledStep` delta | `USB_setIdle` rate; `USB_getReport` output selector |
| `0x7D` | `queueAction` rotation flag; `pairIndex` key count; `ledStep` cycle count | `USB_getReport` output-buffer pointer low byte |
| `0x7E` | No further foreground parameter in these examples | `USB_getReport` output-buffer pointer high byte |

These aliases appear in both production and diagnostic builds of both variants
retained at `/private/tmp/macropad-v12-stack-6xsnuen7`. The source pattern also
exists on finalized v11 `main`; its exact historical binary layout was not
checked in this audit. The `nooverlay` pragma around `USBInterrupt()` does not
protect separately compiled helper functions in the HID module.

A legal `SET_IDLE` request can interrupt `queueAction` while its second
action byte is live. The handler stores the requested idle rate into `0x7C`.
After the ISR returns, `queueAction` reads `0x7C` and stores that changed byte
into the event FIFO. `GET_REPORT` similarly writes `0x7C–0x7E`. Foreground
calls run with interrupts enabled at these accesses. Saving CPU registers does
not preserve these parameter bytes.

Verification checked the linked addresses, actual HEX instructions, and ISR
save list for all four retained production/diagnostic binaries. A focused
instruction-fragment replay showed a queued argument of 56 being replaced by
zero through the linked `SET_IDLE` store and subsequent queue read. This was
not a whole-device simulation or a reproduction of either LED incident.

The overlap can corrupt actions, chord calculations, and relative LED settings
with normal stack usage. It needs the relevant USB class request at an
unfortunate time; ordinary USB IN completion alone does not use these helpers.
Such host requests do not require an open configurator, but no capture shows
that one occurred during either incident. Moreover, this overlap does not
directly overwrite `activeConfigValid` or demonstrate a bootloader entry.
With the original profile and no input or playback pending, the demonstrated
foreground overlap paths are not established as active during the idle failure;
an earlier latent effect would itself require evidence.
It is a confirmed unsafe memory-sharing mechanism, not a confirmed shared
cause of the reported failures. The compiler's requirements are described in
the [SDCC manual, sections 3.7–3.8](https://sdcc.sourceforge.net/doc/sdccman.pdf).

## Other Feasible Explanations

| Mechanism | How It Could Produce Unexpected Behavior | Evidence or Limitation |
| --- | --- | --- |
| Incorrect state transition or time comparison | Stale state, a newer timestamp compared with an older loop time, or incorrect cleanup can satisfy a condition unexpectedly. | Audit exact assignments and generated code. Clock wrap alone is not an explanation: modular elapsed-time subtraction is intentional. Reapply sets bootloader permission false for valid profiles, so a stale time comparison alone does not establish bootloader entry. |
| Out-of-bounds write or wrong pointer/address space | A bad index, length, or pointer can overwrite a flag, register-bank byte, or return address without filling the stack. | No responsible write identified. Audit internal indirect writes, action/configuration indices, and page-zero addressing. Internal flags can change while saved and active image bytes still match. |
| Interrupt register or shared-state corruption | An ISR can damage foreground state through unsaved registers, reused scratch storage, non-reentrant calls, or a non-atomic update. | Parameter overlay is one demonstrated example. The inspected USB wrapper saves its CPU registers and the timer uses a separate bank; those facts reduce some simple register-clobber explanations but do not prove all paths safe. |
| USB DMA/buffer error | Hardware transfers can overwrite external RAM if buffer addresses, sizes, or endpoint mode are wrong. | Normal buffers are separate from the active image and internal stack. DMA is not a direct write to internal validity bits. A specific bad register/length and a chain from the overwritten region to the symptom are still required. |
| Supply, ground, or reset disturbance | A supply dip can restart the chip or move it outside its operating conditions; a reset reruns startup input sampling and profile validation. | Firmware runs at 24MHz; WCH specifies this clock only above 4.4V VCC. No supply or reset trace was captured. A normal clean restart with a released button and valid profile should recover normally; this candidate needs a false startup sample/read or another abnormal condition to explain the indications. Monitor removal is a clue to test, not proof. |
| Transient startup read or validator failure | A restart followed by a bad DataFlash read or corrupted validation state can cache an invalid result even if persistent flash is intact. | Startup is the intended path that can set active validity false. No specific read/validator defect found. USB initializes after the profile read, so the identified USB overlay race does not directly explain startup validation. Another restart can rerun validation; an ordinary bus reset cannot. |
| Incorrect LED buffer/rendering or electrical transfer | The firmware may display the pattern through damaged LED state or a bad LED transfer without entering the presumed error routine. | Exact correspondence to the normal error indication and absence of matching effects in the original profile make a coincidental rendering artifact less compelling. Capture validity flags and control behavior to distinguish it; preserve the reported pattern as fact. |
| Genuine unexpected control-flow transfer | A bad store into a live return address, unbalanced inline-assembly stack use, ABI mismatch, or incorrect interrupt return can redirect the PC with little stack usage. | No such defect found in this audit. The added fill/readout has instruction-level checks; existing assembly/library code still needs path-specific review. Actual code-Flash damage or a compiler defect is possible but currently has no supporting evidence. |
| Persistent saved-profile damage or unwanted host writes | An interrupted save could leave invalid flash, or a host could intentionally send a valid write sequence. | Saves require a complete staged image, CRC and validation. Ordinary HID polling is not a profile save or bootloader command. Recovery without a new save makes permanent flash damage less consistent; there is no evidence of a write during the idle incident. |

Power/reset details and the 24MHz supply restriction come from WCH's
[CH552 datasheet, sections 7 and 8](https://cdn-learn.adafruit.com/assets/assets/000/129/847/original/CH552DS1.PDF?1715004485=).
Inferring that an unmeasured electrical disturbance caused either incident
would go beyond that specification. The chip exposes reset-source bits in
`PCON`; `RESET_KEEP` survives resets other than power-on. Bootloader transitions
affect interpretation, so any diagnostic must capture these early and document
their limits. No reset-source diagnostic is present in the current test build.

## Revised Priorities

### Follow-Up Topology and Interpretation

The confirmed topology is recorded in the
[investigation plan](INVESTIGATION_PLAN.md#confirmed-connection-topology).
The macropad uses its own MacBook port through an adapter and cable; both
monitors use separate ports. This removes a shared external monitor hub/dock
from the actual setup. It does not establish whether internal USB controllers,
power management or grounding are independent. Recovery near monitor removal
raises the value of controlled host/monitor comparisons, but is not evidence
that a particular USB or power event occurred on the pad's connection.

An absent browser session does not stop the operating system's HID traffic or
USB interrupt handling. The identified overlap still specifically requires
`SET_IDLE` or `GET_REPORT` while a vulnerable foreground parameter is live.
Routine polling alone does not establish that interleaving, and no observed
traffic connects it to the untouched-idle incident.

Dedicated non-overlaid storage can remove this particular overlap. The three
shared addresses are not an established three-byte total implementation cost:
`USB_setIdle` has one parameter byte and `USB_getReport` has three, currently
sharing storage. Ordinary separate non-overlaid allocation would reserve four
parameter bytes; deliberately shared ISR-only scratch could use three if its
lifetime and lack of nesting were verified. Linker movement, other locals and
stack capacity require measurement. Protect every interrupt-reachable helper
and examine functions shared with foreground execution; fixing these two helpers
does not automatically eliminate all interrupt-safety defects. SDCC documents
`#pragma nooverlay` on non-reentrant interrupt callees, rather than only on the
interrupt entry function.

Startup debounce is a reasonable hardening candidate, with lower diagnostic
priority until a restart is demonstrated. Neither physical unplugging nor a
complete loss of power is necessary for a processor restart. Conversely,
startup validation cannot explain onset during proven uninterrupted execution.
Self-recovery without a save makes persistent flash damage less compelling;
a transient cached startup failure would still need a later restart or another
identified mechanism to explain recovery. Ordinary USB reapply does not repair
the validity flag.

An inline USB voltage/current meter can screen for sustained low VBUS or a
visible change around monitor connection changes. Its capture rate and location
matter: a stable display cannot exclude short transients, ground disturbances,
or voltage drop after the meter. Prefer measurement near the pad, preserve USB
data connectivity, and record meter placement because insertion changes the
connection. Chip VCC/V33 measurements with suitable time resolution would be
more direct. The documented 24MHz VCC requirement applies at the chip, not at
the computer-side connector.

The subsequent near-pad meter observation was 5.17–5.21V and 0.04–0.15A
across LEDs off to bright white, with USB data still working; see the
[measurement record](INVESTIGATION_PLAN.md#inline-power-meter-observation).
This lowers sustained low VBUS/cable drop as a priority in that measured setup.
The user then unplugged a monitor with no observed voltage fluctuation, LED
change or behavior change. This lowers a reliably repeatable disconnect effect
under those conditions; it does not establish causality for the original
recovery. The meter captures maxima but not minima, and its graph updates
approximately once per second, so the observation cannot exclude brief dips.
Retain electrical/reset candidates with that narrower evidence limit,
alongside USB/software state mechanisms.

### Initial Bounds Review and Sanitizer Check

The follow-up review inspected configuration validation/accessors, protocol
packet/staging copies, action FIFO and held-input indices, macro/string cursors,
timer arrays, LED writes and USB endpoint/report copies. No additional
out-of-bounds write responsible for the incidents was identified. Examples of
existing protections include the protocol's 23-byte payload and 128-byte image
range checks, eight-slot masked FIFO indices, input-index checks, timer-count
validation and endpoint-zero accumulation limits of 2 or 32 bytes.

Several runtime paths rely on the initially validated image and intact runtime
indices, rather than independently checking every access. Therefore this review
is not proof against accesses after state corruption. Desktop tools also erase
the target's address-space qualifiers and do not model SDCC overlays, hardware
DMA or actual interrupt preemption. Generated-code and interleaving analysis
remain necessary.

Running the existing host suites with AddressSanitizer and UndefinedBehaviorSanitizer
found a separate C-language defect at
`CH552_Universal_Macropad.ino:197`: the LED-effect restore command evaluates
`(-1) << 1` before clearing the phase count. The original incident profile has
no LED-effect action. The retained six-key production assembly implements the
arithmetic and then explicitly clears the phase count for restore; no link to
either incident or memory overwrite was demonstrated. Record this as a source
defect to correct, not a diagnosis. No firmware correction was made in this
follow-up review.

The initial sanitizer run stopped at that undefined shift after the config,
actions, protocol, USB, macro and timer suites passed. Repeating all existing
host suites with address/undefined sanitizers enabled but the `shift-base`
category disabled passed, including both input variants and six layout tests.
No out-of-bounds access was reported in those exercised paths. Disabling that
category excludes other invalid shift-base operations from the second run;
this is not a clean full-UBSan result or exhaustive static analysis.

### Investigation Order

1. Capture whether a recurrence involves an application restart, a USB bus
   reset, or neither, together with both validity flags, actual image bytes,
   and the bootloader decision inputs. Current status cannot distinguish all
   these cases. Additional instrumentation needs its own size assessment and
   confirmation for any further feature cuts.
2. Assess a minimal correction for the confirmed parameter overlap and measure
   flash/RAM/stack cost. Use controlled USB class requests to verify the fix
   independently of whether either original incident can be reproduced.
3. Compare the confirmed setup with one/both monitors disconnected, keeping
   the pad's port, adapter, cable and profile fixed. Record laptop power/charging
   state and VBUS; measure VCC/V33 and reset behavior if equipment is available.
   Treat changes in power and changes in USB traffic as separate variables.
4. Audit writes and state transitions with explicit targets and interleavings,
   including internal flag-byte writes, ISR parameter storage, USB reset and
   reapply, startup reads, and assembly conventions. Continue idle observation
   alongside controlled tests; broad input stress alone misses these conditions.

Stack overflow remains on the list with reduced priority. Do not promote the
newly identified overlap, a USB event, or an electrical explanation to the
shared diagnosis without demonstrating the missing links to both incidents.
