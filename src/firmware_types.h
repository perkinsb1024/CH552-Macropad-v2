#ifndef MACROPAD_FIRMWARE_TYPES_H
#define MACROPAD_FIRMWARE_TYPES_H

#include <stdint.h>

// Investigation options default off; normal firmware behavior is unchanged.
#ifndef INVESTIGATION_DIAGNOSTICS
#define INVESTIGATION_DIAGNOSTICS 0
#endif
#ifndef INVESTIGATION_OVERLAP_FIX
#define INVESTIGATION_OVERLAP_FIX 0
#endif
#ifndef INVESTIGATION_BUILD_ID
#define INVESTIGATION_BUILD_ID 0
#endif

// Native 8051 bit storage/return convention; ordinary bytes for host tests.
#ifdef __SDCC
#define FW_BIT __bit
#else
#define FW_BIT uint8_t
#endif

#endif
