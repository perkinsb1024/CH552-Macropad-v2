#ifndef MACROPAD_ACTIONS_H
#define MACROPAD_ACTIONS_H

#include <stdint.h>
#include "firmware_types.h"

#define ACTION_BIT FW_BIT
// Main loop publishes input time before encoder dispatch when acceleration is
// enabled. Button dispatch and output polling also synchronize this clock.
extern __idata uint16_t actionsInputNow;

// Low byte of millis() >> 4: 16ms ticks, polled at least every 4.096 seconds.
void actionsTimedReset(uint8_t tick);
void actionsTimedPoll(uint8_t tick);
ACTION_BIT actionsTimedInput(void); // True consumes this physical event.
void actionsInit(void);
void actionsPress(uint8_t input, uint16_t now);
void actionsRelease(uint8_t input, __xdata uint16_t now);
void actionsRotate(uint8_t clockwise);
void actionsPoll(uint16_t now);
void actionsResolveInputs(uint16_t now);
void actionsClear(void);
uint8_t actionsLayer(void);
// Target is validated by the protocol; bit 7 services normal input timers.
void actionsSetLayer(uint8_t options);
// Consume indication requests from explicit layer selections or auto-sleep wake.
uint8_t actionsTakeLayerSelection(void);
uint8_t actionsDropped(uint8_t rotation);

#endif
