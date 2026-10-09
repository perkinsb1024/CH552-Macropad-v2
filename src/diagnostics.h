#ifndef MACROPAD_DIAGNOSTICS_H
#define MACROPAD_DIAGNOSTICS_H

#include "config.h"

#define DIAGNOSTIC_MAGIC 0xD7
#define DIAGNOSTIC_COMPLETE 0xA5

// Stable schema-1 reason and site IDs; tools/investigation/parse_dataflash.py
// decodes these independently of the linked memory layout.
#define DIAG_INVALID_CONFIG 1
#define DIAG_INVALID_ACTIVE 2
#define DIAG_BOOT_STARTUP 3
#define DIAG_BOOT_HOLD 4
#define DIAG_LAYER 5
#define DIAG_ACTION_QUEUE 6
#define DIAG_MACRO 7
#define DIAG_TRANSPORT 8
#define DIAG_SAVE 9
#define DIAG_INTEGRITY 10
#define DIAG_TIMER 11

#define DIAG_SITE_STARTUP 1
#define DIAG_SITE_APPLY 2
#define DIAG_SITE_LOOP 3
#define DIAG_SITE_BOOT_STARTUP 4
#define DIAG_SITE_BOOT_HOLD 5
#define DIAG_SITE_BOOT_OTHER 6
#define DIAG_SITE_ACTION_QUEUE 7
#define DIAG_SITE_ACTION_POLL 8
#define DIAG_SITE_LAYER 9
#define DIAG_SITE_MACRO 10
#define DIAG_SITE_PROTOCOL 11
#define DIAG_SITE_USB 12
#define DIAG_SITE_SAVE 13
#define DIAG_SITE_TIMER 14

#if DATAFLASH_DIAGNOSTICS
extern __xdata uint8_t stagedConfig[CONFIG_SIZE];
extern __xdata uint8_t configFailure, configFailureOffset;
extern FW_BIT diagnosticRecovery;
extern __xdata uint16_t diagnosticDetail;
uint16_t diagnosticCrc(const __xdata uint8_t *image);
void diagnosticCapture(void);
void diagnosticSnapshotInputs(void);
void diagnosticSnapshotUsb(void);
void diagnosticBootloader(void);
void diagnosticCheckActions(void);
#ifdef __SDCC
void logDiagnostics(uint16_t header) __naked;
#else
void logDiagnostics(uint16_t header);
#endif

// No C parameter overlay or extra frame before the assembly entry snapshot.
// Sites are foreground-only; a trap never returns on hardware. Keep the
// 16-bit detail in xdata to avoid SDCC narrowing nested shifts prematurely.
#define DIAG_TRAP(reason, site, detail) do { \
  diagnosticDetail = (detail); \
  logDiagnostics(((uint16_t)(site) << 8) | (reason)); \
} while (0)
#define DIAG_ASSERT(test, reason, site, detail) do { \
  if (!(test)) { DIAG_TRAP(reason, site, detail); } \
} while (0)
#else
#define DIAG_TRAP(reason, site, detail) ((void)0)
#define DIAG_ASSERT(test, reason, site, detail) ((void)0)
#endif
#endif
