#ifndef __USB_HID_KEYBOARD_MOUSE_H__
#define __USB_HID_KEYBOARD_MOUSE_H__

#include <stdint.h>
#include "../firmware_types.h"

#ifdef __SDCC
#define USB_CRITICAL __critical
#else
#define USB_CRITICAL
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
FW_BIT USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) USB_CRITICAL;
FW_BIT USB_queueConsumer(uint16_t usage) USB_CRITICAL;
FW_BIT USB_reportsPending(void);
void USB_reportPoll(uint16_t now) USB_CRITICAL;
uint8_t USB_asciiUsage(uint8_t c);
extern volatile __xdata uint8_t USB_idleRate;
uint8_t USB_getReport(uint8_t report, uint8_t output, __xdata uint8_t *data);
void USB_setIdle(uint8_t report, uint8_t rate);
uint8_t USB_getIdle(uint8_t report);

#ifdef __cplusplus
} // extern "C"
#endif

#endif
