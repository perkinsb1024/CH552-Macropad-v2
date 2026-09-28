#ifndef MACROPAD_PROTOCOL_FIRMWARE_H
#define MACROPAD_PROTOCOL_FIRMWARE_H

#include <stdint.h>

void protocolInit(void);
void protocolReset(void);
uint8_t protocolReceive(const __xdata uint8_t *packet);
void protocolPoll(uint16_t now);

#endif
