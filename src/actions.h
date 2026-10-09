#ifndef MACROPAD_ACTIONS_H
#define MACROPAD_ACTIONS_H

#include <stdint.h>
#include "config.h"

#define ACTION_BIT FW_BIT
// Main loop publishes input time before encoder dispatch when acceleration is
// enabled. Button dispatch and output polling also synchronize this clock.
extern __idata uint16_t actionsInputNow;

// Low byte of millis() >> 9: 512 ms ticks, polled at least every 131 seconds.
#if CONFIG_TIMED_MAX
void actionsTimedReset(uint8_t tick);
void actionsTimedPoll(uint8_t tick);
ACTION_BIT actionsTimedInput(void); // True consumes this physical event.
#else
#define actionsTimedReset(tick) ((void)(tick))
#define actionsTimedPoll(tick) ((void)(tick))
#define actionsTimedInput() (0)
#endif
void actionsInit(void);
void actionsPress(uint8_t input, uint16_t now);
void actionsRelease(uint8_t input);
void actionsRotate(uint8_t clockwise);
void actionsPoll(uint16_t now);
void actionsClear(void);
uint8_t actionsLayer(void);
// Consume explicit layer selections, including selections of the current layer.
uint8_t actionsTakeLayerSelection(void);
uint8_t actionsDropped(uint8_t rotation);

#endif
