#include "protocol_firmware.h"
#include "config.h"

uint8_t USB_EP1_sendConfig(const __xdata uint8_t *reply);
void USB_EP1_receiveReady(void);

#define PROTOCOL_VERSION 1
#define PROTOCOL_GET_INFO 1
#define PROTOCOL_GET_STATUS 2
#define PROTOCOL_READ_FLASH 3
#define PROTOCOL_READ_ACTIVE 4

#define PROTOCOL_OK 0
#define PROTOCOL_BAD_VERSION 1
#define PROTOCOL_BAD_OPCODE 2
#define PROTOCOL_BAD_RANGE 3
#define PROTOCOL_BAD_PACKET 4

__xdata uint8_t protocolInbox[32];
__xdata uint8_t protocolReply[32];
volatile __xdata uint8_t protocolState;
__xdata uint8_t flashValid;

uint8_t eeprom_read_byte(__data uint8_t addr);

void protocolInit(void) {
  uint8_t i;
  for (i = 0; i < CONFIG_SIZE; i++) {
    activeConfig[i] = eeprom_read_byte(i);
  }
  flashValid = configValid(activeConfig, PHYSICAL_VARIANT);
  if (!flashValid) {
    configDefaults(PHYSICAL_VARIANT);
  }
  protocolReset();
}

void protocolReset(void) {
  protocolState = 0;
}

uint8_t protocolReceive(const __xdata uint8_t *packet) {
  uint8_t i;
  if (protocolState) {
    return 0;
  }
  for (i = 0; i < 32; i++) {
    protocolInbox[i] = packet[i];
  }
  protocolState = 1;
  return 1;
}

void protocolPoll(void) {
  uint8_t i;
  uint8_t opcode;
  uint8_t offset;
  uint8_t length;
  uint8_t status = PROTOCOL_OK;
  if (protocolState == 0) {
    return;
  }
  if (protocolState == 1) {
    for (i = 0; i < 32; i++) {
      protocolReply[i] = 0;
    }
    protocolReply[0] = 4;
    protocolReply[1] = 'U';
    protocolReply[2] = 'M';
    protocolReply[3] = PROTOCOL_VERSION;
    opcode = protocolInbox[4];
    offset = protocolInbox[6];
    length = protocolInbox[7];
    protocolReply[4] = opcode;
    protocolReply[5] = protocolInbox[5];
    protocolReply[6] = offset;
    if (protocolInbox[0] != 3 || protocolInbox[1] != 'U' ||
        protocolInbox[2] != 'M' || protocolInbox[8] != 0) {
      status = PROTOCOL_BAD_PACKET;
    } else if (protocolInbox[3] != PROTOCOL_VERSION) {
      status = PROTOCOL_BAD_VERSION;
    } else if (opcode == PROTOCOL_GET_INFO) {
      if (offset || length) {
        status = PROTOCOL_BAD_RANGE;
      } else {
        protocolReply[7] = 14;
        protocolReply[9] = 'U';
        protocolReply[10] = 'M';
        protocolReply[11] = 'A';
        protocolReply[12] = 'C';
        protocolReply[13] = PROTOCOL_VERSION;
        protocolReply[14] = CONFIG_VERSION;
        protocolReply[15] = PHYSICAL_VARIANT;
        protocolReply[16] = PHYSICAL_VARIANT ? 3 : 6;
        protocolReply[17] = protocolReply[16]; // LEDs per physical key
        protocolReply[18] = CONFIG_MAX_LAYERS;
        protocolReply[19] = CONFIG_SIZE;
        protocolReply[20] = 1; // Palette version
        protocolReply[21] = 0; // Runtime actions are not active yet
        protocolReply[22] = 0;
      }
    } else if (opcode == PROTOCOL_GET_STATUS) {
      if (offset || length) {
        status = PROTOCOL_BAD_RANGE;
      } else {
        protocolReply[7] = 4;
        protocolReply[9] = flashValid;
        protocolReply[10] = configStartupLayer();
        protocolReply[11] = configStartupLayer();
        protocolReply[12] = 0; // No upload is active
      }
    } else if (opcode == PROTOCOL_READ_FLASH ||
               opcode == PROTOCOL_READ_ACTIVE) {
      if (length == 0 || length > 23 ||
          (uint16_t)offset + length > CONFIG_SIZE) {
        status = PROTOCOL_BAD_RANGE;
      } else {
        protocolReply[7] = length;
        for (i = 0; i < length; i++) {
          protocolReply[9 + i] = opcode == PROTOCOL_READ_FLASH ?
                                  eeprom_read_byte(offset + i) :
                                  activeConfig[offset + i];
        }
      }
    } else {
      status = PROTOCOL_BAD_OPCODE;
    }
    // No request carries data in the read-only protocol phase.
    for (i = 9; i < 32; i++) {
      if (protocolInbox[i]) {
        status = PROTOCOL_BAD_PACKET;
      }
    }
    if (status) {
      protocolReply[7] = 0;
      for (i = 9; i < 32; i++) {
        protocolReply[i] = 0;
      }
    }
    protocolReply[8] = status;
    protocolState = 2;
  }
  if (USB_EP1_sendConfig(protocolReply)) {
    protocolState = 0;
    USB_EP1_receiveReady();
  }
}
