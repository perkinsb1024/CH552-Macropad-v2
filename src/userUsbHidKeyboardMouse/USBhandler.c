/*
 created by Deqing Sun for use with CH55xduino
 */

#include "USBhandler.h"

#include "USBconstant.h"
#include "../protocol_firmware.h"
#include "USBHIDKeyboardMouse.h"

// clang-format off
__xdata __at (EP0_ADDR) uint8_t Ep0Buffer[8];
__xdata __at (EP1_ADDR) uint8_t Ep1Buffer[128];       //on page 47 of data sheet, the receive buffer need to be min(possible packet size+2,64), IN and OUT buffer, must be even address
__xdata uint8_t Ep0Report[32];
// clang-format on

#if (EP1_ADDR + 128) > USER_USB_RAM
#error "This example needs more USB ram. Increase this setting in menu."
#endif

__data uint16_t SetupLen;
__data uint8_t SetupReq;
__data uint8_t ep0ReportExpected;
__data uint8_t ep0ReportReceived;
volatile __xdata uint8_t UsbConfig;

const __code uint8_t *__data pDescr;
__data _Bool descriptorInRam;

volatile uint8_t usbMsgFlags = 0; // uint8_t usbMsgFlags copied from VUSB

// Both SETUP and subsequent IN tokens advance the same descriptor transfer.
static uint8_t sendDescriptor(void) {
  __data uint8_t len = SetupLen >= DEFAULT_ENDP0_SIZE ? DEFAULT_ENDP0_SIZE : SetupLen;
  __data uint8_t i;
  for (i = 0; i < len; i++) {
    Ep0Buffer[i] = descriptorInRam ? *((const __xdata uint8_t *)pDescr) : *pDescr;
    pDescr++;
  }
  SetupLen -= len;
  return len;
}

void USB_EP0_SETUP() {
  __data uint8_t len = USB_RX_LEN;
  __data uint16_t descriptorLen = 0;
  ep0ReportExpected = 0;
  descriptorInRam = 0;
  if (len == (sizeof(USB_SETUP_REQ))) {
    SetupLen = ((uint16_t)UsbSetupBuf->wLengthH << 8) | (UsbSetupBuf->wLengthL);
    len = 0; // Default is success and upload 0 length
    SetupReq = UsbSetupBuf->bRequest;
    usbMsgFlags = 0;
    if ((UsbSetupBuf->bRequestType & USB_REQ_TYP_MASK) !=
        USB_REQ_TYP_STANDARD) // Not standard request
    {

      // here is the commnunication starts, refer to usbFunctionSetup of USBtiny
      // or usb_setup in usbtiny

      switch ((UsbSetupBuf->bRequestType & USB_REQ_TYP_MASK)) {
      case USB_REQ_TYP_VENDOR: {
        switch (SetupReq) {
        default:
          len = 0xFF; // command not supported
          break;
        }
        break;
      }
      case USB_REQ_TYP_CLASS: {
        if (UsbSetupBuf->wIndexL != 0 || UsbSetupBuf->wIndexH != 0) {
          len = 0xFF;
        } else if (SetupReq == 0x09 && UsbSetupBuf->bRequestType == 0x21 &&
                   UsbSetupBuf->wValueH == 2 &&
                   ((UsbSetupBuf->wValueL == 3 && SetupLen == 32) ||
                    (UsbSetupBuf->wValueL == 1 && SetupLen == 2))) {
          ep0ReportExpected = SetupLen;
          ep0ReportReceived = 0;
        } else if (SetupReq == 0x0A && UsbSetupBuf->bRequestType == 0x21 &&
                   SetupLen == 0 &&
                   (UsbSetupBuf->wValueL == 0 || UsbSetupBuf->wValueL == 1 ||
                    UsbSetupBuf->wValueL == 2 || UsbSetupBuf->wValueL == 5) && UsbConfig) {
          USB_setIdle(UsbSetupBuf->wValueL, UsbSetupBuf->wValueH);
        } else if (SetupReq == 0x02 && UsbSetupBuf->bRequestType == 0xA1 &&
                   (UsbSetupBuf->wValueL == 0 || UsbSetupBuf->wValueL == 1 ||
                    UsbSetupBuf->wValueL == 2 || UsbSetupBuf->wValueL == 5) &&
                   UsbSetupBuf->wValueH == 0 && SetupLen == 1 && UsbConfig) {
          Ep0Buffer[0] = USB_getIdle(UsbSetupBuf->wValueL);
          len = 1; // GET_IDLE
        } else if (SetupReq == 0x01 && UsbSetupBuf->bRequestType == 0xA1 &&
                   (UsbSetupBuf->wValueH == 1 || UsbSetupBuf->wValueH == 2) &&
                   UsbConfig) {
          descriptorLen = USB_getReport(UsbSetupBuf->wValueL,
                                        UsbSetupBuf->wValueH == 2, Ep0Report);
          if (descriptorLen) {
            pDescr = (const __code uint8_t *)Ep0Report;
            descriptorInRam = 1;
            SetupReq = USB_GET_DESCRIPTOR; // Use the same multi-packet IN transfer.
          } else {
            len = 0xFF;
          }
        } else {
          len = 0xFF;
        }
        break;
      }
      default:
        len = 0xFF; // command not supported
        break;
      }

    } else // Standard request
    {
      switch (SetupReq) // Request ccfType
      {
      case USB_GET_DESCRIPTOR:
        switch (UsbSetupBuf->wValueH) {
        case 1: // Device Descriptor
          pDescr = (__code uint8_t *)
              &DeviceDescriptor; // Put Device Descriptor into outgoing buffer
          descriptorLen = sizeof(USB_Descriptor_Device_t);
          break;
        case 2: // Configure Descriptor
          pDescr = (__code uint8_t *)&ConfigurationDescriptor;
          descriptorLen = sizeof(USB_Descriptor_Configuration_t);
          break;
        case 3:
          if (UsbSetupBuf->wValueL == 0) {
            pDescr = LanguageDescriptor;
          } else if (UsbSetupBuf->wValueL == 1) {
            pDescr = (__code uint8_t *)ManufacturerDescriptor;
          } else if (UsbSetupBuf->wValueL == 2) {
            pDescr = (__code uint8_t *)ProductDescriptor;
          } else if (UsbSetupBuf->wValueL == 3) {
            pDescr = (__code uint8_t *)SerialDescriptor;
          } else {
            len = 0xff;
            break;
          }
          descriptorLen = pDescr[0];
          break;
        case 0x21:
          pDescr = (const __code uint8_t *)&ConfigurationDescriptor.HID_KeyboardHID;
          descriptorLen = sizeof(USB_HID_Descriptor_HID_t);
          break;
        case 0x22:
          if (UsbSetupBuf->wValueL == 0) {
            pDescr = (__code uint8_t *)ReportDescriptor;
            descriptorLen = ConfigurationDescriptor.HID_KeyboardHID.HIDReportLength;
          } else {
            len = 0xff;
          }
          break;
        default:
          len = 0xff; // Unsupported descriptors or error
          break;
        }
        break;
      case USB_SET_ADDRESS:
        SetupLen = UsbSetupBuf->wValueL; // Save the assigned address
        break;
      case USB_GET_CONFIGURATION:
        Ep0Buffer[0] = UsbConfig;
        if (SetupLen >= 1) {
          len = 1;
        }
        break;
      case USB_SET_CONFIGURATION:
        if (UsbSetupBuf->bRequestType || UsbSetupBuf->wValueH ||
            UsbSetupBuf->wValueL > 1 || UsbSetupBuf->wIndexL ||
            UsbSetupBuf->wIndexH || SetupLen) {
          len = 0xFF;
        } else {
          UsbConfig = UsbSetupBuf->wValueL;
          USB_EP1_reset();
          protocolReset();
          UEP1_CTRL = bUEP_AUTO_TOG | UEP_T_RES_NAK | UEP_R_RES_ACK;
        }
        break;
      case USB_GET_INTERFACE:
      case USB_SET_INTERFACE:
        if (UsbSetupBuf->wIndexL || UsbSetupBuf->wIndexH ||
            UsbSetupBuf->wValueL || UsbSetupBuf->wValueH || !UsbConfig ||
            (SetupReq == USB_GET_INTERFACE ?
              UsbSetupBuf->bRequestType != 0x81 || SetupLen != 1 :
              UsbSetupBuf->bRequestType != 0x01 || SetupLen != 0)) {
          len = 0xFF;
        } else if (SetupReq == USB_GET_INTERFACE) {
          Ep0Buffer[0] = 0;
          len = 1;
        }
        break;
      case USB_CLEAR_FEATURE:
      case USB_SET_FEATURE:
        if (UsbSetupBuf->bRequestType != 0x02 || UsbSetupBuf->wValueL != 0 ||
            UsbSetupBuf->wValueH != 0 || UsbSetupBuf->wIndexH != 0 || SetupLen) {
          len = 0xFF;
        } else if (UsbSetupBuf->wIndexL == 0x81) {
          if (SetupReq == USB_SET_FEATURE) {
            UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_T_RES | UEP_T_RES_STALL;
          } else {
            UEP1_CTRL = UEP1_CTRL & ~(bUEP_T_TOG | MASK_UEP_T_RES) |
                        UEP_T_RES_NAK;
            USB_EP1_reset();
            protocolReset();
          }
        } else if (UsbSetupBuf->wIndexL == 0x01) {
          UEP1_CTRL = UEP1_CTRL & ~(bUEP_R_TOG | MASK_UEP_R_RES) |
                      (SetupReq == USB_SET_FEATURE ? UEP_R_RES_STALL : UEP_R_RES_ACK);
        } else {
          len = 0xFF;
        }
        break;
      case USB_GET_STATUS:
        descriptorLen = UsbSetupBuf->wIndexL;
        if (UsbSetupBuf->bRequestType == 0x82) {
          if (descriptorLen == 0x81) {
            descriptorLen = (UEP1_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL;
          } else if (descriptorLen == 1) {
            descriptorLen = (UEP1_CTRL & MASK_UEP_R_RES) == UEP_R_RES_STALL;
          } else if (descriptorLen == 0 || descriptorLen == 0x80) {
            descriptorLen = 0;
          } else {
            len = 0xFF;
            break;
          }
        } else if ((UsbSetupBuf->bRequestType != 0x80 &&
                    UsbSetupBuf->bRequestType != 0x81) || descriptorLen) {
          len = 0xFF;
          break;
        }
        if (UsbSetupBuf->wIndexH || UsbSetupBuf->wValueL || UsbSetupBuf->wValueH) {
          len = 0xFF;
          break;
        }
        Ep0Buffer[0] = descriptorLen;
        Ep0Buffer[1] = 0x00;
        if (SetupLen >= 2) {
          len = 2;
        } else {
          len = SetupLen;
        }
        break;
      default:
        len = 0xff; // Failed
        break;
      }
    }
  } else {
    len = 0xff; // Wrong packet length
  }
  if (len != 0xff && SetupReq == USB_GET_DESCRIPTOR) {
    if (SetupLen > descriptorLen) {
      SetupLen = descriptorLen; // Limit length
    }
    len = sendDescriptor();
  }
  if (len == 0xff) {
    SetupReq = 0xFF;
    UEP0_CTRL =
        bUEP_R_TOG | bUEP_T_TOG | UEP_R_RES_STALL | UEP_T_RES_STALL; // STALL
  } else if (len <=
             DEFAULT_ENDP0_SIZE) // Tx data to host or send 0-length packet
  {
    UEP0_T_LEN = len;
    UEP0_CTRL = bUEP_R_TOG | bUEP_T_TOG | UEP_R_RES_ACK |
                (ep0ReportExpected ? UEP_T_RES_NAK : UEP_T_RES_ACK);
  } else {
    UEP0_T_LEN = 0; // Tx data to host or send 0-length packet
    UEP0_CTRL = bUEP_R_TOG | bUEP_T_TOG | UEP_R_RES_ACK |
                (ep0ReportExpected ? UEP_T_RES_NAK : UEP_T_RES_ACK);
  }
}

void USB_EP0_IN() {
  switch (SetupReq) {
  case USB_GET_DESCRIPTOR: {
    UEP0_T_LEN = sendDescriptor();
    UEP0_CTRL ^= bUEP_T_TOG; // Switch between DATA0 and DATA1
  } break;
  case USB_SET_ADDRESS:
    USB_DEV_AD = USB_DEV_AD & bUDA_GP_BIT | SetupLen;
    UEP0_CTRL = UEP_R_RES_ACK | UEP_T_RES_NAK;
    break;
  default:
    UEP0_T_LEN = 0; // End of transaction
    UEP0_CTRL = UEP_R_RES_ACK | UEP_T_RES_NAK;
    break;
  }
}

void USB_EP0_OUT() {
  __data uint8_t i;
  if (!U_TOG_OK) {
    return;
  }
  if (SetupReq == 0x09 && ep0ReportExpected &&
      USB_RX_LEN <= DEFAULT_ENDP0_SIZE &&
      ep0ReportReceived + USB_RX_LEN <= ep0ReportExpected) {
    for (i = 0; i < USB_RX_LEN; i++) {
      Ep0Report[ep0ReportReceived + i] = Ep0Buffer[i];
    }
    ep0ReportReceived += USB_RX_LEN;
    if (ep0ReportReceived == ep0ReportExpected) {
      if (ep0ReportExpected == 32 && Ep0Report[0] == 3 &&
          protocolReceive(Ep0Report)) {
        UEP1_CTRL = UEP1_CTRL & ~MASK_UEP_R_RES | UEP_R_RES_NAK;
      } else if (ep0ReportExpected == 2 && Ep0Report[0] == 1) {
        USB_setKeyboardLedStatus(Ep0Report[1]);
      } else {
        UEP0_CTRL = bUEP_R_TOG | bUEP_T_TOG |
                    UEP_R_RES_STALL | UEP_T_RES_STALL;
        return;
      }
      ep0ReportExpected = 0;
      UEP0_T_LEN = 0;
      UEP0_CTRL = bUEP_T_TOG | UEP_R_RES_NAK | UEP_T_RES_ACK;
    } else if (USB_RX_LEN < DEFAULT_ENDP0_SIZE) {
      SetupReq = 0xFF;
      UEP0_CTRL = UEP_R_RES_STALL | UEP_T_RES_STALL;
    } else {
      UEP0_CTRL ^= bUEP_R_TOG;
      UEP0_CTRL = UEP0_CTRL & ~(MASK_UEP_R_RES | MASK_UEP_T_RES) |
                  UEP_R_RES_ACK | UEP_T_RES_NAK;
    }
  } else {
    UEP0_T_LEN = 0;
    if (ep0ReportExpected) {
      SetupReq = 0xFF;
      UEP0_CTRL = UEP_R_RES_STALL | UEP_T_RES_STALL;
    } else {
      UEP0_CTRL = UEP_R_RES_ACK | UEP_T_RES_NAK;
    }
  }
}

#pragma save
#pragma nooverlay
void USBInterrupt(void) { // inline not really working in multiple files in SDCC
  if (UIF_TRANSFER) {
    // Only endpoint 0 and the shared HID endpoint 1 are enabled.
    if ((USB_INT_ST & MASK_UIS_ENDP) == 0) {
      switch (USB_INT_ST & MASK_UIS_TOKEN) {
        case UIS_TOKEN_SETUP:
          USB_EP0_SETUP();
          break;
        case UIS_TOKEN_OUT:
          USB_EP0_OUT();
          break;
        case UIS_TOKEN_IN:
          USB_EP0_IN();
          break;
      }
    } else if ((USB_INT_ST & MASK_UIS_ENDP) == 1) {
      if ((USB_INT_ST & MASK_UIS_TOKEN) == UIS_TOKEN_OUT) {
        USB_EP1_OUT();
      } else if ((USB_INT_ST & MASK_UIS_TOKEN) == UIS_TOKEN_IN) {
        USB_EP1_IN();
      }
    }
    UIF_TRANSFER = 0;
  }

  // Device mode USB bus reset
  if (UIF_BUS_RST) {
    protocolReset();
    USB_EP1_reset();
    UEP0_CTRL = UEP_R_RES_ACK | UEP_T_RES_NAK;
    UEP1_CTRL = bUEP_AUTO_TOG | UEP_T_RES_NAK | UEP_R_RES_ACK;

    USB_DEV_AD = 0x00;
    UIF_SUSPEND = 0;
    UIF_TRANSFER = 0;
    UIF_BUS_RST = 0;

    UsbConfig = 0;

    // Clear interrupt flag
  }

  // USB bus suspend / wake up
  if (UIF_SUSPEND) {
    UIF_SUSPEND = 0;
    if (USB_MIS_ST & bUMS_SUSPEND) { // Suspend

      // while ( XBUS_AUX & bUART0_TX );                    // Wait for Tx
      // SAFE_MOD = 0x55;
      // SAFE_MOD = 0xAA;
      // WAKE_CTRL = bWAK_BY_USB | bWAK_RXD0_LO;    // Wake up by USB or RxD0
      // PCON |= PD; // Chip sleep SAFE_MOD = 0x55; SAFE_MOD = 0xAA; WAKE_CTRL =
      // 0x00;

    } else {             // Unexpected interrupt, not supposed to happen !
      USB_INT_FG = 0xFF; // Clear interrupt flag
    }
  }
}
#pragma restore

void USBDeviceCfg() {
  USB_CTRL = 0x00;            // Clear USB control register
  USB_CTRL &= ~bUC_HOST_MODE; // This bit is the device selection mode
  USB_CTRL |= bUC_DEV_PU_EN | bUC_INT_BUSY |
              bUC_DMA_EN; // USB device and internal pull-up enable,
                          // automatically return to NAK before interrupt flag
                          // is cleared during interrupt
  USB_DEV_AD = 0x00;      // Device address initialization
  //     USB_CTRL |= bUC_LOW_SPEED;
  //     UDEV_CTRL |= bUD_LOW_SPEED; //Run for 1.5M
  USB_CTRL &= ~bUC_LOW_SPEED;
  UDEV_CTRL &= ~bUD_LOW_SPEED; // Select full speed 12M mode, default mode
#if defined(CH551) || defined(CH552) || defined(CH549)
  UDEV_CTRL = bUD_PD_DIS; // Disable DP/DM pull-down resistor
#endif
#if defined(CH559)
  UDEV_CTRL = bUD_DP_PD_DIS; // Disable DP/DM pull-down resistor
#endif
  UDEV_CTRL |= bUD_PORT_EN; // Enable physical port
}

void USBDeviceIntCfg() {
  USB_INT_EN |= bUIE_SUSPEND;  // Enable device hang interrupt
  USB_INT_EN |= bUIE_TRANSFER; // Enable USB transfer completion interrupt
  USB_INT_EN |= bUIE_BUS_RST;  // Enable device mode USB bus reset interrupt
  USB_INT_FG |= 0x1F;          // Clear interrupt flag
  IE_USB = 1;                  // Enable USB interrupt
  EA = 1;                      // Enable global interrupts
}

void USBDeviceEndPointCfg() {
#if defined(CH559)
  // CH559 use differend endianness for these registers
  UEP0_DMA_H = ((uint16_t)Ep0Buffer >> 8); // Endpoint 0 data transfer address
  UEP0_DMA_L = ((uint16_t)Ep0Buffer >> 0); // Endpoint 0 data transfer address
  UEP1_DMA_H = ((uint16_t)Ep1Buffer >> 8); // Endpoint 1 data transfer address
  UEP1_DMA_L = ((uint16_t)Ep1Buffer >> 0); // Endpoint 1 data transfer address
#else
  UEP0_DMA = (uint16_t)Ep0Buffer; // Endpoint 0 data transfer address
  UEP1_DMA = (uint16_t)Ep1Buffer; // Endpoint 1 data transfer address
#endif

  UEP1_CTRL = bUEP_AUTO_TOG | UEP_T_RES_NAK |
              UEP_R_RES_ACK; // Endpoint 2 automatically flips the sync flag, IN
                             // transaction returns NAK, OUT returns ACK
  UEP4_1_MOD = 0XC0;         // endpoint1 TX RX enable
  UEP0_CTRL =
      UEP_R_RES_ACK | UEP_T_RES_NAK; // Manual flip, OUT transaction returns
                                     // ACK, IN transaction returns NAK
}
