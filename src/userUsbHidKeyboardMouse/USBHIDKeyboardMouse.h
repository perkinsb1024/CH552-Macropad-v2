#ifndef __USB_HID_KEYBOARD_MOUSE_H__
#define __USB_HID_KEYBOARD_MOUSE_H__

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void USBInit(void);
uint8_t USB_EP1_sendConfig(const __xdata uint8_t *reply);
void USB_EP1_receiveReady(void);
void USB_setKeyboardLedStatus(uint8_t leds);
void USB_EP1_reset(void);
void USB_discardReports(void);
uint8_t USB_reportGeneration(void);

uint8_t USB_queueKeyboard(const __xdata uint8_t *keys);
uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel);
uint8_t USB_queueConsumer(uint16_t usage);
uint8_t USB_reportsPending(void);
void USB_reportPoll(void);
uint8_t USB_asciiUsage(uint8_t c);

#ifdef __cplusplus
} // extern "C"
#endif

#endif
