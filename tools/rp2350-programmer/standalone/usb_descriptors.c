#include <string.h>
#include "pico/unique_id.h"
#include "tusb.h"

// TinyUSB example VID/PID for local development only; not a product allocation.
static const tusb_desc_device_t device = {
  .bLength = sizeof(tusb_desc_device_t), .bDescriptorType = TUSB_DESC_DEVICE,
  .bcdUSB = 0x0200, .bDeviceClass = TUSB_CLASS_MISC,
  .bDeviceSubClass = MISC_SUBCLASS_COMMON, .bDeviceProtocol = MISC_PROTOCOL_IAD,
  .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE, .idVendor = 0xcafe, .idProduct = 0x4053,
  .bcdDevice = 0x0200, .iManufacturer = 0, .iProduct = 2, .iSerialNumber = 3,
  .bNumConfigurations = 1
};

const uint8_t *tud_descriptor_device_cb(void) { return (const uint8_t *)&device; }

enum { ITF_CDC, ITF_CDC_DATA, ITF_MSC, ITF_COUNT };
static const uint8_t configuration[] = {
  TUD_CONFIG_DESCRIPTOR(1, ITF_COUNT, 0, TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_MSC_DESC_LEN, 0, 500),
  TUD_CDC_DESCRIPTOR(ITF_CDC, 4, 0x81, 8, 0x02, 0x82, 64),
  TUD_MSC_DESCRIPTOR(ITF_MSC, 5, 0x03, 0x83, 64)
};

const uint8_t *tud_descriptor_configuration_cb(uint8_t index) {
  return index == 0 ? configuration : NULL;
}

const uint16_t *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
  (void)langid;
  static uint16_t descriptor[64];
  static char serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];
  const char *text;
  if (index == 0) {
    descriptor[0] = (TUSB_DESC_STRING << 8) | 4;
    descriptor[1] = 0x0409;
    return descriptor;
  }
  switch (index) {
    case 2: text = "CH552 FW UPDATER"; break;
    case 3:
      pico_get_unique_board_id_string(serial, sizeof(serial));
      text = serial;
      break;
    case 4: text = "Programmer diagnostics"; break;
    case 5: text = "CH552 FW UPDATER"; break;
    default: return NULL;
  }
  size_t len = strlen(text);
  if (len > 63) len = 63;
  for (size_t i = 0; i < len; i++) descriptor[1 + i] = (uint8_t)text[i];
  descriptor[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * len + 2));
  return descriptor;
}
