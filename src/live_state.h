#ifndef MACROPAD_LIVE_STATE_H
#define MACROPAD_LIVE_STATE_H
#include <stdint.h>
// Main-loop-only writers share the existing protocol reply; no new packet buffer.
extern __xdata uint8_t protocolReply[32];
#define liveReply (protocolReply + 9)
extern __xdata uint8_t liveBindings[13];
void firmwareWriteLive(void);
void firmwareWriteInputs(void);
void actionsWriteLive(void);
void actionsWriteTimers(void);
#endif
