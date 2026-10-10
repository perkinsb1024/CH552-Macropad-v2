#ifndef __USB_HID_KEYBOARD_MOUSE_H__
#define __USB_HID_KEYBOARD_MOUSE_H__

#include <stdint.h>
#include "../firmware_types.h"

#ifdef __SDCC
#define USB_CRITICAL __critical
// ISR-only helper parameters must not share the foreground's internal-RAM
// overlay. Keep their storage in external RAM to preserve stack capacity.
#define USB_ISR_PARAM __xdata
#else
#define USB_CRITICAL
#define USB_ISR_PARAM
#endif

#ifdef __cplusplus
extern "C" {
#endif

void USBInit(void);
// Zero until the host configures the device, and during USB bus reset.
extern volatile __xdata uint8_t UsbConfig;
FW_BIT USB_EP1_sendConfig(const __xdata uint8_t *reply) USB_CRITICAL;
void USB_EP1_receiveReady(void) USB_CRITICAL;
void USB_setKeyboardLedStatus(uint8_t leds);
void USB_EP1_reset(void);
void USB_discardReports(void) USB_CRITICAL;
uint8_t USB_reportGeneration(void);

FW_BIT USB_queueKeyboard(const __xdata uint8_t *keys) USB_CRITICAL;
// Eight independent button bits. Scroll packs signed four-bit unit deltas:
// vertical in bits 0–3, horizontal AC Pan in bits 4–7 (each -1, 0 or +1).
FW_BIT USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) USB_CRITICAL;
FW_BIT USB_queueConsumer(uint16_t usage) USB_CRITICAL;
FW_BIT USB_reportsPending(void);
void USB_reportPoll(uint16_t now) USB_CRITICAL;
uint8_t USB_asciiUsage(uint8_t c);
extern volatile __xdata uint8_t USB_idleRate;
uint8_t USB_getReport(uint8_t report, USB_ISR_PARAM uint8_t output,
                      __xdata uint8_t * USB_ISR_PARAM data);
void USB_setIdle(uint8_t report, USB_ISR_PARAM uint8_t rate);
uint8_t USB_getIdle(uint8_t report);

#ifdef __cplusplus
} // extern "C"
#endif

#endif
