#ifndef MACROPAD_LED_CONTROL_H
#define MACROPAD_LED_CONTROL_H
#include <stdint.h>
// Called only after validation and chord/one-shot resolution. Never queues HID output.
void firmwareLedAction(uint8_t command, uint8_t value);
#endif
