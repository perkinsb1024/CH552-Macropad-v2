#ifndef MACROPAD_ACTIONS_H
#define MACROPAD_ACTIONS_H

#include <stdint.h>

void actionsInit(void);
void actionsPress(uint8_t input, uint16_t now);
void actionsRelease(uint8_t input);
void actionsRotate(uint8_t clockwise);
void actionsPoll(uint16_t now);
void actionsClear(void);
uint8_t actionsLayer(void);
uint8_t actionsDropped(uint8_t rotation);

#endif
