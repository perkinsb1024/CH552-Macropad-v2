# Mac HID Investigation Results

## Setup and Scope

Tests performed on October 11, 2026 (local Pacific time; log timestamps are UTC)
with the factory pad directly connected to the Mac. VID/PID `1189:8890`, USB
location `0x01100000`. Interface 1's report descriptor exactly matched the
RP2350 capture: report ID `03`, 64-byte vendor payload, interrupt OUT endpoint
`02` with 64-byte maximum packets.

HIDAPI exposed keyboard/mouse collections but no vendor interface 1 collection.
Direct PyUSB/libusb access successfully claimed interface 1 without detaching
keyboard drivers. No forced USB resets or controlled power cycles occurred
between probes. All packets included report ID `03` and zero padding to 64
payload bytes. Transfer success establishes USB-level completion only.

## Targeted Retry Results

| Run Directory Under `output/` | Transport | Packets | Result |
| --- | --- | --- | --- |
| `20261011-202249-088030` | Interrupt OUT | `2A`, `2B`, `2C` | All three completed 65-byte writes; factory identity remained after each 1000ms observation. |
| `20261011-202344-610560` | Control SET_REPORT | `2B` | I/O error, errno 5; delivery uncertain. Stopped after one attempt rather than the planned three. Factory identity remained through 3000ms observation. |
| `20261011-202414-985266` | Interrupt OUT | `2B` three times | All three completed 65-byte writes; factory identity remained after each 3000ms observation. |
| `20261011-202434-807222` | Control SET_REPORT | `2A` | Same I/O error, errno 5; delivery uncertain. Factory identity remained through 1000ms observation. |

The RP2350's missing `2B 00 ...` delivery is now covered by four successful Mac
interrupt transfers. The repeated control-transfer failure was not unique to
`2B`. These checks did not identify a command-specific reason to prioritize a
second-byte sweep under `2B`.

## Software Validation

Eight native Python tests passed: candidate coverage/known-prefix exclusions,
packet framing, USB registry identity parsing, descriptor mismatch preventing
writes, both USB transfer methods, durable intent logging before transmission,
complete targeted sessions, bounded timeout stopping without retry, and stopping
on disappearance or WCH identity without claiming protocol confirmation.

The tool logs WCH VID/PID as a lead only; CH552 bootloader protocol confirmation
is not implemented. Raw logs and summaries retain this distinction.

## Complete First-Byte Mac Sweep

Run `output/mac-first-byte/` completed all 235 intended candidates exactly once,
with all 235 full 65-byte interrupt transfers successful. Every post-probe USB
observation was factory identity; no bootloader transition was observed. The
run lasted approximately 292 seconds from baseline to final summary. `2B` also
succeeded in this sweep, giving five successful Mac interrupt transfers across
all runs.

An independent saved-log audit verified the exact ascending candidate list,
known-prefix exclusions, report-ID prefix, zero padding, transfer lengths,
observation count, and agreement with the final summary. `validation.json`
records source/dependency hashes and the raw event-log checksum.

Combined with the earlier RP2350 run, this closes the missing zero-tail delivery
for `2B`. It does not establish a negative result for commands needing nonzero
arguments, known prefixes, another report type, or a subsequent reset/power cycle.
See `two-byte-candidates.md` for untested proposals; no two-byte candidates were
sent in this phase.

## Two-Byte Follow-Up

The user authorized testing the proposed two-byte packets and including known
`AA` save commands. `output/two-byte-proposals/` completed all 21 proposed
prefixes, each as a full 65-byte interrupt transfer. All post-probe observations
remained factory identity. No bootloader transition was observed. The original
proposal list is retained in `two-byte-candidates.md`.

## Startup Timing Lead

The user reports that on connection Key 1 lights blue, followed by Keys 2–6
rapidly lighting blue in sequence, then all LEDs turn off; this takes about
1000ms. Tested button/encoder combinations during boot did not alter it. The
observation suggests testing connection timing but does not establish a command
acceptance window or bootloader mechanism.

`startup` mode was added to send one validated packet upon fresh libusb device
visibility after an observed disconnect. It preloads dependencies and saves the
exact packet intent before waiting, avoiding process startup, log-flush, and
ordinary baseline delays after detection. It measures detection-to-write time,
not time since electrical power-on. Twelve software tests passed, including
waiting for absence/reconnection, timeout/multiple-device handling, and sending
exactly one packet only after reconnect with intent recorded first.

## Complete AA Second-Byte Sweep

`output/aa-second-byte/` completed `AA 00` through `AA FF` in ascending order,
including known saves `AA A1` and `AA AA` as authorized. All 256 interrupt
transfers completed 65 bytes and every post-probe observation remained factory
identity. No bootloader transition was observed. The run took approximately
320 seconds from baseline to completion.

An independent saved-log audit verified exact coverage, packet framing/zero
padding, transfer lengths, observation count, and final summary agreement for
both the 21-candidate proposal run and the complete AA sweep. The startup-window
hypothesis is separate from these normal-running observations.

## Startup AA 55 Trial

`output/startup-aa55/` observed a disconnect and reconnect, validated the factory
interface, and sent exactly one `AA 55 00 ...` packet. The 65-byte transfer
completed. Transmission started 3.496ms after the first libusb visibility;
completion occurred 19.486ms after visibility. This is not measured from physical
power-on. The target still advertised `1189:8890` during 3000ms of post-transfer
observation; no WCH identity appeared.

The user reports a changed LED state after this trial: Key 1 remained blue,
while Key 2 turned green and stayed green. This is distinct from the previously
reported normal blue sequence ending with all LEDs off. It is a device-side
behavioral lead despite the unchanged VID/PID. It does not establish bootloader
entry, an acknowledgement meaning, or causation by this packet alone: prior AA
subcommands, including configuration saves, were sent before the power cycle.
The state should be preserved for read-only inspection before further commands.

Read-only USB inspection after the startup trial still matched the original
interface 1 report descriptor exactly. The changed LEDs did not coincide with
a changed VID/PID or vendor report descriptor. No further test packet was sent
before the user requested DataFlash inspection.

A fresh RP2350 read-only reader capture is pending in
`output/post-sweep-dataflash/`. The existing stock capture contains all 128 bytes
as `FF`, UID `30f5b5bd`, CRC32 `652d544c`. Factory settings storage has not been
established, so unchanged DataFlash would not rule out saved configuration in
another flash region. No DataFlash/settings-read command was found among the
recovered executable paths. The checked existing reader UF2 matches its build
manifest SHA256 `a3aa4d48a33abbd40dcc298b38d7ea57f5401a444534251955361fdd3dfe0289`.

## Post-Sweep DataFlash Comparison

The fresh capture in `output/post-sweep-dataflash/` is complete, with confirmed
CH552 bootloader 2.5.0 identity and the same UID `30f5b5bd`. All 128 returned
DataFlash bytes match the original capture exactly and remain `FF`; CRC32 is
`652d544c`. The three AB replies independently reconstruct `DATA.BIN`, have
zero status, and contain exactly 58, 58, and 12 bytes at offsets 0, 58, and 116.
All logged USB transfers succeeded. The transmitted bulk commands were only
A1, A7, and the three bounded AB reads. `comparison.json` records the audit.

There is no observed DataFlash change after the command experiments. The user
also reports that power-cycling after the startup AA 55 trial restored the prior
LED behavior. This supports a temporary-state interpretation but does not
establish the factory's configuration-storage location or rule out other flash
changes.

One raw metadata difference remains unresolved: `global_configuration_raw`
changed from `0xfdfd52ff` to `0xfffd52ff` (XOR `0x02000000`, bit 25). Its decoded
code-protection and bootloader flags are unchanged. The
[referenced CH55x register definitions](https://github.com/ch32-rs/wchisp/blob/main/devices/0x11-CH55x.yaml)
do not assign a meaning to bit 25. Do not attribute it to a saved configuration,
reserved-bit variability, or a particular command without further evidence.
The response header's second byte also varies (`B7` in the baseline, `BB` now),
while parsed lengths/status and returned payloads remain valid.

The previously pending DataFlash comparison is now complete.

## Startup AA 55 Repeat

`output/startup-aa55-repeat-1/` sent the same single zero-padded `AA 55` packet
after observed disconnect/reconnect. It completed all 65 bytes, starting 2.496ms
after first libusb visibility and completing at 11.485ms. The target retained
factory identity through the 3000ms observation window. The user reports the
usual blue/flash sequence on this trial, rather than Key 1 blue and Key 2 green
remaining lit. The LED anomaly therefore did not reproduce in this repeat.

The first anomalous trial followed the full AA sweep, including configuration
saves; the repeat followed read-only bootloader/DataFlash capture and reconnection.
Neither trial has an electrical power-on timestamp. Possible timing/state
dependence remains unresolved; the first LED observation cannot be assigned to
AA 55 alone from these two trials.

During setup, `ioreg` returned successful empty output with no USB device
connected. The CLI now treats that as an empty device list rather than reporting
an invalid plist. Thirteen software tests passed, including this case. The
startup timing/transmission logic was unchanged for the repeat.

## User-Run Startup Trials

Seven timestamped user runs were found, each transmitting exactly one AA 55
packet successfully. The user tentatively associates the second run,
`output/20261011-205855-667314/` (armed at `2026-10-12T03:58:55.717112+00:00`),
with Key 1 and Key 2 both remaining green. That run started transmission 3.410ms
after libusb visibility, completed at 17.388ms, and retained factory identity
through observation. The association is tentative, not an instrumented LED record.

Detection-to-write times for the seven user runs, in order, were 3.939, 3.410,
2.653, 3.332, 8.148, 6.112, and 4.405ms. The user reports one persistent-LED
occurrence among these attempts; other individual LED observations were not
separately recorded. Runs 5 and 6 (`20261011-205935-086819` and
`20261011-205950-040300`) instead ended with an empty USB device list, about
2.925 and 2.702 seconds after the respective transfer log. Manual unplugging
versus device-driven disappearance is unresolved. No WCH identity was observed.

The tentative green/green trial (3.410ms) has similar detection-relative timing
to the first blue/green trial (3.496ms). However, other transfers at 3.332ms and
3.939ms surround it, and these timestamps are not measured from power-on. These
samples do not establish a simple earlier/later threshold, a special acceptance
window, or a specific LED acknowledgement meaning.

## Rapid Burst Throughput

The normal-running measurement `output/burst-rate-1s/` completed 62 full reports
within 1000ms. The next report started near the deadline and returned an I/O
error at 1006.227ms; its delivery is uncertain, so this is not a negative test
for that candidate. The observed successful spacing was approximately 16ms.
The post-burst USB snapshot still showed factory identity.

A 25ms remaining-time guard was then added to avoid starting a healthy report
without adequate remaining time. `output/burst-rate-1s-guarded/` completed 62
reports in 988.075ms, covering `00` and `13`–`4F`, with no failed or incomplete
write. One post-burst identity check after a 500ms settling delay found factory
identity. The remaining 173 planned candidates were not sent in this run.

At this measured rate, all 235 first-byte candidates would require roughly
3800ms. Four fresh-connection ranges (`00`–`4D`, `4E`–`89`, `8A`–`C8`,
`C9`–`FF`) contain 60, 60, 60, and 55 eligible packets, respectively. This is a
proposed way to cover the first-byte space within multiple 1000ms windows;
electrical power-on timing and application processing remain unmeasured.

The new `startup-burst` path preloads packets/dependencies and records intent
before reconnect. It validates the newly visible interface and sends consecutively,
without per-packet observation/log flushing. Timing is buffered in RAM; one
post-burst registry check follows. Seventeen software tests passed, including
deadline/reserve handling, stopping on incomplete delivery, preserving interrupted
intent, durable batch intent before writes, and exactly one post-burst identity
check. Fresh-connection burst hardware testing has not yet been performed.
The transport uses the descriptor's interval, per the
[libusb interrupt-transfer reference](https://libusb.sourceforge.io/api-1.0/group__libusb__syncio.html).

## User-Run Startup Bursts and Persistent LED Change

Five saved startup bursts completed: `20261011-211637-586438` and
`20261011-212214-085694` each cover `00` and `13`–`4D`; subsequent runs
`20261011-212258-753203`, `20261011-212324-887105`, and
`20261011-212350-805947` cover the remaining planned ranges. An intervening
cancelled run sent no packets. Completion times from first libusb visibility
were 961.955, 970.549, 956.157, 960.509, and 881.281ms. Every post-burst identity
check found the factory device, about 1436–1528ms after visibility.

A raw-log audit verified report ID `03`, 65-byte reports, one candidate byte
followed by 63 zero payload bytes, full transfer completion, and summary
agreement. Combined coverage is 235 distinct candidates, not all 256:
known prefixes `01`–`12`, `A1`, `AA`, and `B0` were excluded. No known
configuration/save prefix was transmitted in these recorded startup bursts.

The user reports a persistent startup LED change after the first startup sweep:
the initial Key 1 pause disappeared; Keys 1–6 now flash in rapid sequence and
turn off in approximately 50ms. This repeats on every reconnection, including
without arming the script. Timing is a visual estimate without synchronized
power-on, LED, and USB capture. Unlike the earlier intermittent AA 55 color
effects, this behavior persists across power cycles.

This is a persistent behavioral lead, not an established configuration write
or bootloader signal. A particular undocumented handler, cumulative earlier
probes, and firmware bugs remain possible explanations without established
causation. If the first-sweep attribution is correct, the associated range is
`00` and `13`–`4D`; those prefixes were also previously sent during normal
operation. The burst cannot isolate a responsible packet.

A fresh read-only capture compared with `post-sweep-dataflash/` could check
DataFlash and bootloader metadata for changes. Unchanged DataFlash would not
establish unchanged factory settings, whose storage location is unknown.
Preserve this state before further configuration saves or reset commands.
If the approximately 50ms sequence corresponds to a command window, USB
enumeration may consume that window before Mac access; the LED sequence alone
does not establish such a window.

## DataFlash Capture After Persistent Startup Change

The new read-only capture in `output/post-sweep-dataflash/9_27_PM/` differs
from the immediately preceding capture: 126 of 128 DataFlash bytes changed.
Previously every byte was `FF`; now offsets 0–125 contain nine apparent
14-byte records, with selectors `01`, `02`, `03`, `04`, `05`, `06`, `0D`,
`0E`, and `0F`. Each record has the form
`<selector> 01 01 00 00 06 00 00 00 00 00 00 00 00`.
Offsets 126–127 remain `FF`. CRC32 changed from `652d544c` to `b536b8c6`.
This is structured data compatible with a settings-related interpretation,
but the record fields and the responsible command have not been established.

The capture retains UID `30f5b5bd`, bootloader version `2.5.0`, and global
configuration `0xfffd52ff`. `A1.BIN`, `A7.BIN`, `USBDEV.BIN`, and `USBCFG.BIN`
are byte-identical to the preceding capture. All trace transfers succeeded;
the only transmitted bulk commands were the same A1/A7/three AB reads.
The zero-status AB replies independently reconstruct all 128 bytes of
`DATA.BIN`, and the reported CRC32 matches. The independent audit is saved
as `9_27_PM/comparison.json`.

This establishes a DataFlash change between the two captures, supporting a
lasting device-state change rather than solely transient LED state. It does
not establish which intervening command caused it or whether it explains
the shortened startup LEDs. The earlier capture followed known AA saves
and still contained only `FF`; the later startup bursts excluded known saves.
Possible deferred writes, undocumented commands, or initialization behavior
remain unresolved. Prior statements about unchanged DataFlash describe the
earlier capture only; the new capture supplies the first non-erased records.

## Encoder Response Without an Active USB Host

The user initially reported a repeatable behavior when the pad was plugged into the
unarmed, blue-LED RP2350 reader: Key 1 stays blue indefinitely and key presses
do not change it. Rotating the encoder in either direction triggers the
Keys 1–6 LED sweep, after which the LEDs turn off.

In the reader source, the idle state leaves D+/D− as inputs with internal
pulls disabled. The downstream PIO USB host is initialized only after arming
and the 2000ms delay. Thus the unarmed reader supplies power without active
downstream USB enumeration or application commands; the board's physical D+
pull-up remains part of the electrical setup. This assumes the loaded UF2 is
the inspected reader and has remained unarmed since reset.

This observation weakens the interpretation of the initial Key 1 pause as a
fixed bootloader-command window. A USB-related wait or an encoder-triggered
firmware state transition could explain the sequence, but neither is proven.
An encoder-triggered sweep without host traffic demonstrates that the sweep
does not require a Mac HID command. It does not explain the newly populated
DataFlash or establish that the changed Mac startup behavior has the same cause.

The user subsequently could no longer reproduce the Key 1 waiting behavior.
Treat the earlier observation as intermittent, with the relevant conditions
unresolved. The enumeration-wait explanation is unsupported and should not
guide command timing as an established mechanism. The independently validated
DataFlash change remains confirmed; this follow-up does not establish whether
the shortened startup sequence also changed again.

## Partial Connector Insertion Tests

After unplugging and reconnecting the RP2350 itself, the user again reproduced
Key 1 staying blue until encoder rotation. The RP2350's state since power-up
or the associated electrical conditions remain possible factors.

The user then observed the following with USB-C cable insertion:

- Half insertion into a computer-connected cable reproduced Key 1 staying
  blue until encoder rotation. The Mac scanner reported no USB devices.
- Full insertion into that cable triggered the Keys 1–6 LED sweep.
- Full insertion into a charger-connected cable did not reproduce persistent
  Key 1 blue.
- Half insertion into the charger-connected cable did reproduce it.

This associates the behavior with partial connector engagement across both
computer and charger connections. Full charger insertion demonstrates that
the sweep can occur without computer enumeration, so an enumeration-only wait
does not explain all observations. Partial insertion does not establish which
VBUS, ground, data, or USB-C contacts are engaged, nor a stable supply voltage;
power/contact conditions and data-line levels remain unmeasured. These are
possible explanations, not a decoded firmware mechanism.

The absence of a visible USB device during half insertion establishes only
that enumeration was not observed. It does not distinguish factory execution
from bootloader execution. Encoder-responsive LEDs are consistent with
application behavior, but no firmware image is available to assign the state.
These tests do not identify a bootloader entry route or invalidate the confirmed
DataFlash change.
