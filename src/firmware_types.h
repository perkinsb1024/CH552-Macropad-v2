#ifndef MACROPAD_FIRMWARE_TYPES_H
#define MACROPAD_FIRMWARE_TYPES_H

#include <stdint.h>

// Native 8051 bit storage/return convention; ordinary bytes for host tests.
#ifdef __SDCC
#define FW_BIT __bit
#else
#define FW_BIT uint8_t
#endif

#endif
