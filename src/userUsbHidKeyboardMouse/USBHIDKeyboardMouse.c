// clang-format off
#include <stdint.h>
#include <stdbool.h>
#include "include/ch5xx.h"
#include "include/ch5xx_usb.h"
#include "USBconstant.h"
#include "USBhandler.h"
#include "USBHIDKeyboardMouse.h"
#include "../protocol_firmware.h"
// clang-format on

// clang-format off
extern __xdata __at (EP0_ADDR) uint8_t Ep0Buffer[];
extern __xdata __at (EP1_ADDR) uint8_t Ep1Buffer[];
// clang-format on

__xdata uint8_t keyboardLedStatus = 0;

volatile __xdata uint8_t UpPoint1_Busy =
    0; // Flag of whether upload pointer is busy

#define SHIFT 0x80
__code uint8_t _asciimap[128] = {
    0x00, // NUL
    0x00, // SOH
    0x00, // STX
    0x00, // ETX
    0x00, // EOT
    0x00, // ENQ
    0x00, // ACK
    0x00, // BEL
    0x2a, // BS	Backspace
    0x2b, // TAB	Tab
    0x28, // LF	Enter
    0x00, // VT
    0x00, // FF
    0x00, // CR
    0x00, // SO
    0x00, // SI
    0x00, // DEL
    0x00, // DC1
    0x00, // DC2
    0x00, // DC3
    0x00, // DC4
    0x00, // NAK
    0x00, // SYN
    0x00, // ETB
    0x00, // CAN
    0x00, // EM
    0x00, // SUB
    0x00, // ESC
    0x00, // FS
    0x00, // GS
    0x00, // RS
    0x00, // US

    0x2c,         //  ' '
    0x1e | SHIFT, // !
    0x34 | SHIFT, // "
    0x20 | SHIFT, // #
    0x21 | SHIFT, // $
    0x22 | SHIFT, // %
    0x24 | SHIFT, // &
    0x34,         // '
    0x26 | SHIFT, // (
    0x27 | SHIFT, // )
    0x25 | SHIFT, // *
    0x2e | SHIFT, // +
    0x36,         // ,
    0x2d,         // -
    0x37,         // .
    0x38,         // /
    0x27,         // 0
    0x1e,         // 1
    0x1f,         // 2
    0x20,         // 3
    0x21,         // 4
    0x22,         // 5
    0x23,         // 6
    0x24,         // 7
    0x25,         // 8
    0x26,         // 9
    0x33 | SHIFT, // :
    0x33,         // ;
    0x36 | SHIFT, // <
    0x2e,         // =
    0x37 | SHIFT, // >
    0x38 | SHIFT, // ?
    0x1f | SHIFT, // @
    0x04 | SHIFT, // A
    0x05 | SHIFT, // B
    0x06 | SHIFT, // C
    0x07 | SHIFT, // D
    0x08 | SHIFT, // E
    0x09 | SHIFT, // F
    0x0a | SHIFT, // G
    0x0b | SHIFT, // H
    0x0c | SHIFT, // I
    0x0d | SHIFT, // J
    0x0e | SHIFT, // K
    0x0f | SHIFT, // L
    0x10 | SHIFT, // M
    0x11 | SHIFT, // N
    0x12 | SHIFT, // O
    0x13 | SHIFT, // P
    0x14 | SHIFT, // Q
    0x15 | SHIFT, // R
    0x16 | SHIFT, // S
    0x17 | SHIFT, // T
    0x18 | SHIFT, // U
    0x19 | SHIFT, // V
    0x1a | SHIFT, // W
    0x1b | SHIFT, // X
    0x1c | SHIFT, // Y
    0x1d | SHIFT, // Z
    0x2f,         // [
    0x31,         // bslash
    0x30,         // ]
    0x23 | SHIFT, // ^
    0x2d | SHIFT, // _
    0x35,         // `
    0x04,         // a
    0x05,         // b
    0x06,         // c
    0x07,         // d
    0x08,         // e
    0x09,         // f
    0x0a,         // g
    0x0b,         // h
    0x0c,         // i
    0x0d,         // j
    0x0e,         // k
    0x0f,         // l
    0x10,         // m
    0x11,         // n
    0x12,         // o
    0x13,         // p
    0x14,         // q
    0x15,         // r
    0x16,         // s
    0x17,         // t
    0x18,         // u
    0x19,         // v
    0x1a,         // w
    0x1b,         // x
    0x1c,         // y
    0x1d,         // z
    0x2f | SHIFT, // {
    0x31 | SHIFT, // |
    0x30 | SHIFT, // }
    0x35 | SHIFT, // ~
    0             // DEL
};

// Keep short input reports ahead of configuration replies.
__xdata uint8_t reportQueue[8][9];
__xdata uint8_t reportLength[8];
__xdata uint8_t reportHead;
__xdata uint8_t reportTail;
__xdata uint8_t reportCount;
__xdata uint8_t reportGeneration;

void USBInit() {
  USBDeviceCfg();
  USBDeviceEndPointCfg();
  USBDeviceIntCfg();
  UEP0_T_LEN = 0;
  UEP1_T_LEN = 0;
}

void USB_EP1_IN() {
  UEP1_T_LEN = 0;
  UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_T_RES | UEP_T_RES_NAK;
  UpPoint1_Busy = 0;
}

void USB_EP1_OUT() {
  if (U_TOG_OK) {
    if (USB_RX_LEN == 2 && Ep1Buffer[0] == 1) {
      keyboardLedStatus = Ep1Buffer[1];
    } else if (USB_RX_LEN == 32 && Ep1Buffer[0] == 3) {
      if (protocolReceive(Ep1Buffer)) {
        UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_R_RES | UEP_R_RES_NAK;
      }
    }
  }
}

uint8_t USB_EP1_sendConfig(const __xdata uint8_t *reply) {
  __data uint8_t i;
  if (UsbConfig == 0 || UpPoint1_Busy || reportCount) {
    return 0;
  }
  for (i = 0; i < 32; i++) {
    Ep1Buffer[64 + i] = reply[i];
  }
  UEP1_T_LEN = 32;
  UpPoint1_Busy = 1;
  UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_T_RES | UEP_T_RES_ACK;
  return 1;
}

void USB_EP1_receiveReady(void) {
  UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_R_RES | UEP_R_RES_ACK;
}

void USB_setKeyboardLedStatus(uint8_t leds) {
  keyboardLedStatus = leds;
}

void USB_EP1_reset(void) {
  UpPoint1_Busy = 0;
  reportGeneration++;
  USB_discardReports();
}

uint8_t USB_reportGeneration(void) {
  return reportGeneration;
}

void USB_discardReports(void) {
  reportCount = 0;
  reportHead = 0;
  reportTail = 0;
}

static uint8_t queueReport(uint8_t length) {
  if (reportCount == 8 || UsbConfig == 0) {
    return 0;
  }
  reportLength[reportHead] = length;
  reportHead = (reportHead + 1) & 7;
  reportCount++;
  return 1;
}

uint8_t USB_queueKeyboard(const __xdata uint8_t *keys) {
  uint8_t i;
  if (reportCount == 8 || UsbConfig == 0) {
    return 0;
  }
  reportQueue[reportHead][0] = 1;
  for (i = 0; i < 8; i++) {
    reportQueue[reportHead][i + 1] = keys[i];
  }
  return queueReport(9);
}

uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
  if (reportCount == 8 || UsbConfig == 0) {
    return 0;
  }
  reportQueue[reportHead][0] = 2;
  reportQueue[reportHead][1] = buttons;
  reportQueue[reportHead][2] = x;
  reportQueue[reportHead][3] = y;
  reportQueue[reportHead][4] = wheel;
  return queueReport(5);
}

uint8_t USB_queueConsumer(uint16_t usage) {
  if (reportCount == 8 || UsbConfig == 0) {
    return 0;
  }
  reportQueue[reportHead][0] = 5;
  reportQueue[reportHead][1] = usage;
  reportQueue[reportHead][2] = usage >> 8;
  return queueReport(3);
}

uint8_t USB_reportsPending(void) {
  return reportCount || UpPoint1_Busy;
}

void USB_reportPoll(void) {
  uint8_t i;
  if (UsbConfig == 0 || UpPoint1_Busy || reportCount == 0) {
    return;
  }
  for (i = 0; i < reportLength[reportTail]; i++) {
    Ep1Buffer[64 + i] = reportQueue[reportTail][i];
  }
  UEP1_T_LEN = reportLength[reportTail];
  reportTail = (reportTail + 1) & 7;
  reportCount--;
  UpPoint1_Busy = 1;
  UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_T_RES | UEP_T_RES_ACK;
}

uint8_t USB_asciiUsage(uint8_t c) {
  if (c >= 128) {
    return 0;
  }
  return _asciimap[c];
}
