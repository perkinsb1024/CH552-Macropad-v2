#ifndef MACROPAD_PROTOCOL_FIRMWARE_H
#define MACROPAD_PROTOCOL_FIRMWARE_H

#include <stdint.h>
#include "firmware_types.h"

// Set to 0 to omit LED color preview: saves 204 flash bytes and 1 xRAM byte
// on both variants (CH55xDuino 0.0.25 / SDCC build.13407_4).
// The code-size optimizations remain enabled in either mode.
#ifndef ENABLE_COLOR_PREVIEW
#define ENABLE_COLOR_PREVIEW 1
#endif

#define PROTOCOL_BIT FW_BIT
extern PROTOCOL_BIT activeConfigValid;

#if ENABLE_COLOR_PREVIEW
// Zero cancels; otherwise layer-style color/brightness/indicator bits.
void firmwarePreviewColor(uint8_t options);
#endif
void protocolInit(void);
void protocolReset(void);
FW_BIT protocolReceive(const __xdata uint8_t *packet);
void protocolPoll(uint16_t now);

#endif
