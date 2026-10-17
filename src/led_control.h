#ifndef MACROPAD_LED_CONTROL_H
#define MACROPAD_LED_CONTROL_H
#include <stdint.h>
// Runtime-only LED commands; saved profile validation rejects both.
#define LED_SLEEP_CAPTURE 0x0E
#define LED_SLEEP_RESTORE 0x0F
// Called by validated bindings and synthesized runtime actions. Never queues HID output.
void firmwareLedAction(uint8_t command, uint8_t value);
#endif
