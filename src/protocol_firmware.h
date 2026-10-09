#ifndef MACROPAD_PROTOCOL_FIRMWARE_H
#define MACROPAD_PROTOCOL_FIRMWARE_H

#include <stdint.h>
#include "firmware_types.h"

// Set to 0 to omit UI color preview. Temporary LED effects remain available.
#ifndef ENABLE_COLOR_PREVIEW
#define ENABLE_COLOR_PREVIEW 1
#endif

#define PROTOCOL_BIT FW_BIT
extern PROTOCOL_BIT activeConfigValid;
#if INVESTIGATION_DIAGNOSTICS
extern volatile __pdata uint8_t protocolState; // 3 requests main-loop bootloader entry.
#endif

#if ENABLE_COLOR_PREVIEW
// Zero cancels; otherwise layer-style color/brightness/indicator bits.
void firmwarePreviewColor(uint8_t options);
#endif
void protocolInit(void);
void protocolReset(void);
FW_BIT protocolReceive(const __xdata uint8_t *packet);
void protocolPoll(uint16_t now);

#endif
