#include "diagnostics.h"
#if DATAFLASH_DIAGNOSTICS
#include "storage.h"
#include "protocol_firmware.h"
#ifdef __SDCC
#include <Arduino.h>
#define DIAG_CPU_FEATURE 0x40
#else
#define DIAG_CPU_FEATURE 0
uint32_t millis(void);
extern volatile uint8_t EA;
#endif

// All scratch storage is external RAM, preserving the internal stack reserve.
FW_BIT diagnosticRecovery;
__xdata uint16_t diagnosticDetail;
// Export these two addresses for verification of the linked assembly shim.
__pdata uint8_t diagnosticReason, diagnosticSite;
static __pdata uint8_t cursor;
#if (!DIAGNOSTIC_REDUCED && CONFIG_TIMED_MAX) || (defined(__SDCC) && (!DIAGNOSTIC_REDUCED || ENABLE_STACK_TEST))
static __idata uint8_t index;
#endif
#ifdef __SDCC
#if !DIAGNOSTIC_REDUCED
static __idata uint8_t count;
#endif
#endif
static __xdata uint16_t crc, activeCrc, savedCrc;
#ifndef __SDCC
static __xdata uint32_t uptime;
#endif
#if !DIAGNOSTIC_REDUCED
static __xdata uint8_t saveContext[8];
#endif

extern PROTOCOL_BIT flashValid;
extern volatile PROTOCOL_BIT resetPending;
extern volatile __pdata uint8_t protocolState;
extern __xdata uint8_t uploadState;
extern __pdata uint8_t inputDown, pendingInput, pendingLayer;
extern __pdata uint16_t pendingSince;
extern __data uint8_t baseLayer, previousLayer, effectiveLayer, oneShotReturnLayer;
extern __data uint8_t currentFirst, phase, macroNext, macroStart;
extern __pdata uint8_t currentSecond, stringIndex, tempFirst, tempSecond, tempMouse;
extern __data uint8_t tempOn;
extern __pdata uint8_t tempReady, layerSelectionPending, consumerReleasePending;
extern __idata uint8_t persistentMouse;
extern __data uint8_t consumerOwner, eventUsed;
extern __pdata uint8_t eventHead, eventTail, droppedButtons, droppedRotation;
extern __pdata uint8_t eventData[8][2];
extern __pdata uint16_t deadline;
#if CONFIG_MACRO_REPEAT
extern __idata uint8_t macroRepeat;
#endif
#if CONFIG_TIMED_MAX
extern __pdata uint8_t timedClock, timedAge[CONFIG_TIMED_MAX];
extern __idata uint8_t timedHigh[CONFIG_TIMED_MAX], timedFraction[CONFIG_TIMED_MAX];
extern __idata uint8_t timedPending[CONFIG_TIMED_MAX];
#endif
extern __xdata uint8_t storageFailureOffset, storageFailureExpected, storageFailureActual;
extern FW_BIT configCrcDiagnostic;

#if !DIAGNOSTIC_REDUCED
static uint16_t crcByte(uint16_t value, __xdata uint8_t byte) {
  uint8_t bit;
  value ^= (uint16_t)byte << 8;
  for (bit = 0; bit < 8; bit++) {
    if (value & 0x8000) value = (value << 1) ^ 0x1021;
    else value <<= 1;
  }
  return value;
}
#endif

uint16_t diagnosticCrc(const __xdata uint8_t *image) {
  uint16_t value;
  configCrcDiagnostic = 1;
  value = configCrc(image);
  configCrcDiagnostic = 0;
  return value;
}

// Interrupts are already disabled by the entry shim. Each storage operation
// verifies once and never recurses or retries indefinitely.
static FW_BIT diagnosticWrite(void) {
  uint8_t i;
  // diagnosticCapture checked the reservation while holding interrupts off.
  if (!storageWriteDiagnostic(0, DIAGNOSTIC_MAGIC) ||
      !storageWriteDiagnostic(4, 0)) return 0;
  for (i = 1; i < CONFIG_SIZE; i++) {
    if (i != 4 && !storageWriteDiagnostic(i, stagedConfig[i])) return 0;
  }
  // Each body byte was already read back by storageWriteDiagnostic().
  if (!storageWriteDiagnostic(4, DIAGNOSTIC_COMPLETE)) return 0;
#if !DIAGNOSTIC_REDUCED
  crc = 0xFFFF;
  for (i = 0; i < CONFIG_SIZE; i++) {
    if (i != 14 && i != 15) crc = crcByte(crc, storageRead(i));
  }
  return crc == ((uint16_t)stagedConfig[15] << 8 | stagedConfig[14]);
#else
  return 1; // Every written byte, including completion, passed readback.
#endif
}

#ifdef __SDCC
void logDiagnostics(uint16_t header) __naked {
  header;
  __asm
    mov r6,dpl
    mov r7,dph
    // Snapshot PSW before writing ACC changes parity. Store IE before CLR EA.
    mov dptr,#(_stagedConfig + 21)
    mov a,psw
    movx @dptr,a
    inc dptr
    mov a,ie
    clr _EA
    movx @dptr,a
    inc dptr
    mov a,ip
    movx @dptr,a
    inc dptr
    mov a,pcon
    movx @dptr,a
    mov dptr,#(_stagedConfig + 20)
    mov a,sp
    movx @dptr,a
#if DIAGNOSTIC_REDUCED
    // Compact raw evidence replaces the detailed action and LED sections.
    // Copy before any C logger calls can reuse foreground temporaries.
    mov r0,#0x50
    mov dptr,#(_stagedConfig + 60)
    mov r1,#44
  00090$:
    mov a,@r0
    movx @dptr,a
    inc r0
    inc dptr
    djnz r1,00090$
    mov r0,#_eventData
    mov dptr,#(_stagedConfig + 112)
    mov r1,#16
  00091$:
    movx a,@r0
    movx @dptr,a
    inc r0
    inc dptr
    djnz r1,00091$
#endif
    mov r0,#_diagnosticReason
    mov a,r6
    movx @r0,a
    mov r0,#_diagnosticSite
    mov a,r7
    movx @r0,a
    // LJMP adds no frame; the saved SP includes the caller's LCALL return.
    ljmp _diagnosticCapture
  __endasm;
}
#else
void logDiagnostics(uint16_t header) {
  uint8_t i;
  EA = 0;
  diagnosticReason = header;
  diagnosticSite = header >> 8;
  for (i = 20; i < 32; i++) stagedConfig[i] = 0xFF;
  stagedConfig[27] = 0;
#if DIAGNOSTIC_REDUCED
  for (i = 60; i < 104; i++) stagedConfig[i] = 0xFF;
  for (i = 0; i < 16; i++) stagedConfig[112 + i] = eventData[i / 2][i & 1];
#endif
  diagnosticCapture();
}
#endif

void diagnosticCapture(void) {
  if (storageRead(0) == DIAGNOSTIC_MAGIC) {
    diagnosticBootloader();
    return; // Only host test handoffs can return.
  }
  // CH55xDuino preserves EA; no delay or timer wait. Its return is copied
  // directly to the dump to avoid a four-byte shift loop.
#ifdef __SDCC
  __asm
    lcall _millis
    mov r2,dpl
    mov r3,dph
    mov r4,b
    mov r5,a
    mov dptr,#(_stagedConfig + 16)
    mov a,r2
    movx @dptr,a
    inc dptr
    mov a,r3
    movx @dptr,a
    inc dptr
    mov a,r4
    movx @dptr,a
    inc dptr
    mov a,r5
    movx @dptr,a
  __endasm;
#else
  uptime = millis();
  for (cursor = 0; cursor < 4; cursor++) {
    stagedConfig[16 + cursor] = uptime;
    uptime >>= 8;
  }
#endif
#if !DIAGNOSTIC_REDUCED
  // Capture upload evidence before stagedConfig is reused.
  for (cursor = 0; cursor < 8; cursor++) {
    saveContext[cursor] = diagnosticReason == DIAG_SAVE &&
      storageFailureOffset < CONFIG_SIZE && cursor < CONFIG_SIZE - storageFailureOffset ?
      stagedConfig[storageFailureOffset + cursor] : 0xFF;
  }
#endif
  stagedConfig[0] = DIAGNOSTIC_MAGIC;
  stagedConfig[1] = 0x44; stagedConfig[2] = 0x46; stagedConfig[3] = 0xA6;
  stagedConfig[4] = DIAGNOSTIC_COMPLETE; stagedConfig[5] = 1;
  stagedConfig[6] = PHYSICAL_VARIANT;
  stagedConfig[7] = DIAG_CPU_FEATURE | (DIAGNOSTIC_REDUCED ? 0x90 : 0xB0) | (CONFIG_MACRO_REPEAT ? 2 : 0) |
    (CONFIG_SCROLL_ACCELERATION ? 4 : 0) | (ENABLE_COLOR_PREVIEW ? 8 : 0);
  stagedConfig[8] = (uint8_t)INVESTIGATION_BUILD_ID;
  stagedConfig[9] = (uint16_t)INVESTIGATION_BUILD_ID >> 8;
  stagedConfig[10] = diagnosticReason; stagedConfig[11] = diagnosticSite;
  stagedConfig[12] = diagnosticDetail; stagedConfig[13] = diagnosticDetail >> 8;
#ifdef __SDCC
  __asm
    .globl __start__stack
    mov dptr,#(_stagedConfig + 25)
    mov a,#__start__stack
    movx @dptr,a
  __endasm;
  stagedConfig[26] = 0xFF;
  stagedConfig[27] = 0;
  for (cursor = 28; cursor < 32; cursor++) stagedConfig[cursor] = 0xFF;
#if !DIAGNOSTIC_REDUCED
  if (stagedConfig[20] >= stagedConfig[25]) {
    count = stagedConfig[20] - stagedConfig[25];
    count = count >= 3 ? 4 : count + 1;
    index = stagedConfig[20] - count + 1;
    stagedConfig[27] = count;
    for (cursor = 0; cursor < count; cursor++) {
      stagedConfig[28 + cursor] = *((__idata uint8_t *)(index + cursor));
    }
  }
#endif
#if ENABLE_STACK_TEST
  stagedConfig[7] |= 1;
  index = 255;
  while (index >= stagedConfig[25] && *((__idata uint8_t *)index) == 0xA5) index--;
  stagedConfig[26] = index;
#endif
#endif
  for (cursor = 0; cursor < 9; cursor++) stagedConfig[32 + cursor] = activeConfig[cursor];
  stagedConfig[41] = (DIAGNOSTIC_REDUCED ? 128 : 0) |
    (flashValid ? 1 : 0) | (activeConfigValid ? 2 : 0) | (resetPending ? 4 : 0)
#if !DIAGNOSTIC_REDUCED
    |
    (layerSelectionPending ? 8 : 0) | (consumerReleasePending ? 32 : 0) | (tempReady ? 64 : 0);
#else
    ;
#endif
#if DIAGNOSTIC_REDUCED
  stagedConfig[42] = stagedConfig[43] = 0xFF;
#else
  stagedConfig[42] = configFailure; stagedConfig[43] = configFailureOffset;
#endif
  stagedConfig[50] = inputDown;
#if !DIAGNOSTIC_REDUCED
  stagedConfig[60] = pendingInput; stagedConfig[61] = pendingLayer;
  stagedConfig[62] = pendingSince; stagedConfig[63] = pendingSince >> 8;
  stagedConfig[64] = baseLayer; stagedConfig[65] = effectiveLayer;
  stagedConfig[66] = previousLayer; stagedConfig[67] = oneShotReturnLayer;
  stagedConfig[68] = currentFirst; stagedConfig[69] = currentSecond; stagedConfig[70] = phase;
  stagedConfig[71] = macroNext; stagedConfig[72] = macroStart;
#if CONFIG_MACRO_REPEAT
  stagedConfig[73] = macroRepeat;
#else
  stagedConfig[73] = 0xFF;
#endif
  stagedConfig[74] = stringIndex;
  stagedConfig[75] = deadline; stagedConfig[76] = deadline >> 8;
  stagedConfig[77] = tempFirst; stagedConfig[78] = tempSecond;
  stagedConfig[79] = tempOn; stagedConfig[80] = tempMouse;
  stagedConfig[81] = persistentMouse;
  stagedConfig[82] = eventHead; stagedConfig[83] = eventTail; stagedConfig[84] = eventUsed;
  stagedConfig[85] = droppedButtons; stagedConfig[86] = droppedRotation;
  stagedConfig[87] = consumerOwner;
  for (cursor = 0; cursor < 8; cursor++) {
    stagedConfig[88 + cursor * 2] = eventData[cursor][0];
    stagedConfig[89 + cursor * 2] = eventData[cursor][1];
  }
#endif
  stagedConfig[110] = protocolState; stagedConfig[111] = uploadState;
  diagnosticSnapshotUsb();
  diagnosticSnapshotInputs();
#if !DIAGNOSTIC_REDUCED
  if (stagedConfig[10] == DIAG_INVALID_CONFIG) {
    for (cursor = 0; cursor < 8; cursor++) stagedConfig[120 + cursor] = storageRead(cursor);
  } else if (stagedConfig[10] == DIAG_SAVE) {
    stagedConfig[120] = storageFailureActual;
    for (cursor = 1; cursor < 8; cursor++) stagedConfig[120 + cursor] = saveContext[cursor - 1];
#if CONFIG_TIMED_MAX
  } else if (stagedConfig[10] == DIAG_TIMER) {
    index = stagedConfig[12];
    for (cursor = 120; cursor < 128; cursor++) stagedConfig[cursor] = 0xFF;
    stagedConfig[120] = index;
    stagedConfig[121] = timedClock;
    if (index < CONFIG_TIMED_MAX) {
      stagedConfig[122] = timedAge[index]; stagedConfig[123] = timedHigh[index];
      stagedConfig[124] = timedFraction[index]; stagedConfig[125] = timedPending[index];
      // No config accessor when the configured timer count is suspect.
    }
#endif
  }
  else if (stagedConfig[10] == DIAG_ACTION_QUEUE || stagedConfig[10] == DIAG_MACRO ||
             stagedConfig[10] == DIAG_TRANSPORT) {
    stagedConfig[120] = currentFirst; stagedConfig[121] = currentSecond;
    stagedConfig[122] = stagedConfig[123] = 0xFF;
    for (cursor = 0; cursor < 4; cursor++) {
      stagedConfig[124 + cursor] = eventTail < 8 ?
        eventData[(eventTail + cursor / 2) & 7][cursor & 1] : 0xFF;
    }
  }
#else
  // Validation detail is omitted; on save failure byte 43 stores readback.
  if (stagedConfig[10] == DIAG_SAVE) stagedConfig[43] = storageFailureActual;
#endif
  // CRC calculations happen after the volatile snapshot. Saved CRC streams
  // original flash without using another 128-byte RAM image.
  activeCrc = configCrc(activeConfig);
#if !DIAGNOSTIC_REDUCED
  savedCrc = 0xFFFF;
  for (cursor = 0; cursor < CONFIG_SIZE; cursor++) {
    if (cursor != 6 && cursor != 7) savedCrc = crcByte(savedCrc, storageRead(cursor));
  }
#else
  savedCrc = 0xFFFF;
#endif
  stagedConfig[44] = activeCrc; stagedConfig[45] = activeCrc >> 8;
  stagedConfig[46] = savedCrc; stagedConfig[47] = savedCrc >> 8;
  crc = diagnosticCrc(stagedConfig);
  stagedConfig[14] = crc; stagedConfig[15] = crc >> 8;
  diagnosticWrite();
  diagnosticBootloader();
}
#endif
