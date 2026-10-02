#ifndef __USB_HANDLER_H__
#define __USB_HANDLER_H__

// clang-format off
#include <stdint.h>
#include "include/ch5xx.h"
#include "include/ch5xx_usb.h"
#include "USBconstant.h"
// clang-format on

// clang-format off
extern __xdata __at (EP0_ADDR) uint8_t Ep0Buffer[];
extern __xdata __at (EP1_ADDR) uint8_t Ep1Buffer[];
// clang-format on

extern __data uint16_t SetupLen;
extern __data uint8_t SetupReq;
volatile extern __xdata uint8_t UsbConfig;

extern const __code uint8_t *__data pDescr;

#define UsbSetupBuf ((PUSB_SETUP_REQ)Ep0Buffer)

void USB_EP0_SETUP(void);
void USB_EP0_OUT(void);
void USB_EP0_IN(void);
void USB_EP1_OUT(void);
void USB_EP1_IN(void);

void USBInterrupt(void);
void USBDeviceCfg();
void USBDeviceIntCfg();
void USBDeviceEndPointCfg();

#endif
