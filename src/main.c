/*
  main.cpp - Main loop for Arduino sketches
  Copyright (c) 2005-2013 Arduino Team.  All right reserved.

  This library is free software; you can redistribute it and/or
  modify it under the terms of the GNU Lesser General Public
  License as published by the Free Software Foundation; either
  version 2.1 of the License, or (at your option) any later version.

  This library is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
  Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public
  License along with this library; if not, write to the Free Software
  Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
*/

// Adapted from CH55xDuino 0.0.25: this board uses only USB and Timer0 interrupts.
#include <Arduino.h>

void USBInterrupt(void);
void DeviceUSBInterrupt(void) __interrupt(INT_NO_USB) {
  USBInterrupt();
}

// Timer0 uses register bank 1, matching the CH55xDuino wiring implementation.
__idata __at (0x08) volatile uint32_t timer0_overflow_count = 0;
__idata __at (0x0C) volatile uint8_t timer0_overflow_count_5th_byte = 0;
void Timer0Interrupt(void) __interrupt(INT_NO_TMR0) __using(1);

void main(void) {
  init();
  setup();
  for (;;) {
    loop();
  }
}

unsigned char __sdcc_external_startup(void) __nonbanked {
  // --no-xinit-opt omits both XINIT copying and implicit external-RAM clearing.
  // Retain the latter: it zeros static storage and selects P2=0 for __pdata.
  __asm
    .globl __mcs51_genXRAMCLEAR
  __endasm;
  return 0;
}
