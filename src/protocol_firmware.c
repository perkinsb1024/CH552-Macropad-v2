#include "protocol_firmware.h"
#include "config.h"
#include "actions.h"
#include "storage.h"

#include "userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"
void firmwareApplyConfig(void);

#define PROTOCOL_VERSION 1
#define PROTOCOL_GET_INFO 1
#define PROTOCOL_GET_STATUS 2
#define PROTOCOL_READ_FLASH 3
#define PROTOCOL_READ_ACTIVE 4
#define PROTOCOL_BEGIN_WRITE 5
#define PROTOCOL_WRITE_CHUNK 6
#define PROTOCOL_COMMIT_WRITE 7
#define PROTOCOL_ABORT_WRITE 8

#define PROTOCOL_OK 0
#define PROTOCOL_BAD_VERSION 1
#define PROTOCOL_BAD_OPCODE 2
#define PROTOCOL_BAD_RANGE 3
#define PROTOCOL_BAD_PACKET 4
#define PROTOCOL_INCOMPLETE 5
#define PROTOCOL_BAD_CONFIG 6
#define PROTOCOL_BAD_CRC 7
#define PROTOCOL_BUSY 8
#define PROTOCOL_FLASH_FAILED 9
#define PROTOCOL_BAD_SEQUENCE 10
#define UPLOAD_TIMEOUT_MS 5000

__xdata uint8_t protocolInbox[32];
__xdata uint8_t protocolReply[32];
__xdata uint8_t stagedConfig[CONFIG_SIZE];
volatile __xdata uint8_t protocolState;
volatile __xdata uint8_t resetPending;
__xdata uint8_t flashValid;
__xdata uint8_t activeConfigValid;
__xdata uint8_t uploadState; // 0 idle, 1 receiving, 2 committed (retry acknowledgement).
__xdata uint8_t uploadNext;
__xdata uint16_t uploadCrc;
__xdata uint16_t uploadTime;

void protocolInit(void) {
  uint8_t i;
  for (i = 0; i < CONFIG_SIZE; i++) {
    activeConfig[i] = storageRead(i);
  }
  flashValid = configValid(activeConfig, PHYSICAL_VARIANT);
  activeConfigValid = flashValid;
  protocolState = 0;
  uploadState = 0;
  resetPending = 0;
}

void protocolReset(void) {
  resetPending = 1; // Interrupt context; abandon the upload in the main loop.
}

uint8_t protocolReceive(const __xdata uint8_t *packet) {
  uint8_t i;
  if (protocolState || resetPending) {
    return 0;
  }
  for (i = 0; i < 32; i++) {
    protocolInbox[i] = packet[i];
  }
  protocolState = 1;
  return 1;
}

static uint8_t processRequest(void) {
  uint8_t opcode = protocolInbox[4];
  uint8_t offset = protocolInbox[6];
  uint8_t length = protocolInbox[7];
  uint8_t i;
  uint16_t crc;
  if (protocolInbox[0] != 3 || protocolInbox[1] != 'U' ||
      protocolInbox[2] != 'M' || protocolInbox[8]) {
    return PROTOCOL_BAD_PACKET;
  }
  if (protocolInbox[3] != PROTOCOL_VERSION) {
    return PROTOCOL_BAD_VERSION;
  }
  if (length > 23) {
    return PROTOCOL_BAD_RANGE;
  }
  // Validate every byte before a request can change staging or flash.
  i = opcode == PROTOCOL_BEGIN_WRITE || opcode == PROTOCOL_WRITE_CHUNK ? length : 0;
  for (i += 9; i < 32; i++) {
    if (protocolInbox[i]) {
      return PROTOCOL_BAD_PACKET;
    }
  }
  if (opcode == PROTOCOL_READ_FLASH || opcode == PROTOCOL_READ_ACTIVE ||
      opcode == PROTOCOL_WRITE_CHUNK) {
    if (!length || (uint16_t)offset + length > CONFIG_SIZE) {
      return PROTOCOL_BAD_RANGE;
    }
  } else if (offset || (opcode == PROTOCOL_BEGIN_WRITE ? length != 3 : length != 0)) {
    return PROTOCOL_BAD_RANGE;
  }
  switch (opcode) {
    case PROTOCOL_GET_INFO:
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
      protocolReply[20] = CONFIG_PALETTE_VERSION;
      protocolReply[21] = 0xFF;
      protocolReply[22] = 0xFF;
      break;
    case PROTOCOL_GET_STATUS:
      protocolReply[7] = 6;
      protocolReply[9] = flashValid;
      protocolReply[10] = activeConfigValid ? actionsLayer() : 0;
      protocolReply[11] = activeConfigValid ? configStartupLayer() : 0;
      protocolReply[12] = uploadState;
      protocolReply[13] = actionsDropped(0);
      protocolReply[14] = actionsDropped(1);
      break;
    case PROTOCOL_READ_FLASH:
    case PROTOCOL_READ_ACTIVE:
      protocolReply[7] = length;
      for (i = 0; i < length; i++) {
        protocolReply[9 + i] = opcode == PROTOCOL_READ_FLASH ?
                                storageRead(offset + i) : activeConfig[offset + i];
      }
      break;
    case PROTOCOL_BEGIN_WRITE:
      if (protocolInbox[9] != CONFIG_SIZE) {
        return PROTOCOL_BAD_RANGE;
      }
      uploadCrc = protocolInbox[10] | ((uint16_t)protocolInbox[11] << 8);
      uploadNext = 0;
      uploadState = 1;
      break;
    case PROTOCOL_WRITE_CHUNK:
      if (uploadState != 1) {
        return PROTOCOL_INCOMPLETE;
      }
      if (offset != uploadNext) {
        if ((uint16_t)offset + length > uploadNext) {
          return PROTOCOL_BAD_SEQUENCE;
        }
        for (i = 0; i < length; i++) {
          if (stagedConfig[offset + i] != protocolInbox[9 + i]) {
            return PROTOCOL_BAD_SEQUENCE;
          }
        }
      } else {
        for (i = 0; i < length; i++) {
          stagedConfig[offset + i] = protocolInbox[9 + i];
        }
        uploadNext += length;
      }
      break;
    case PROTOCOL_COMMIT_WRITE:
      if (uploadState == 2) {
        break;
      }
      if (uploadState != 1 || uploadNext != CONFIG_SIZE) {
        return PROTOCOL_INCOMPLETE;
      }
      crc = configCrc(stagedConfig);
      if (crc != uploadCrc || stagedConfig[6] != (uint8_t)crc ||
          stagedConfig[7] != (uint8_t)(crc >> 8)) {
        return PROTOCOL_BAD_CRC;
      }
      if (!configValid(stagedConfig, PHYSICAL_VARIANT)) {
        return PROTOCOL_BAD_CONFIG;
      }
      flashValid = storageSave(stagedConfig);
      if (!flashValid) {
        return PROTOCOL_FLASH_FAILED;
      }
      for (i = 0; i < CONFIG_SIZE; i++) {
        activeConfig[i] = stagedConfig[i];
      }
      activeConfigValid = 1;
      firmwareApplyConfig();
      uploadState = 2;
      break;
    case PROTOCOL_ABORT_WRITE:
      uploadState = 0;
      break;
    default:
      return PROTOCOL_BAD_OPCODE;
  }
  return PROTOCOL_OK;
}

void protocolPoll(uint16_t now) {
  uint8_t i;
  uint8_t status;
  if (resetPending) {
    uploadState = 0;
    protocolState = 0;
    firmwareApplyConfig();
    resetPending = 0;
    USB_EP1_receiveReady();
    return;
  }
  if (uploadState && (uint16_t)(now - uploadTime) >= UPLOAD_TIMEOUT_MS) {
    uploadState = 0;
  }
  if (!protocolState) {
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
    protocolReply[4] = protocolInbox[4];
    protocolReply[5] = protocolInbox[5];
    protocolReply[6] = protocolInbox[6];
    status = processRequest();
    protocolReply[8] = status;
    if (!status && protocolInbox[4] >= PROTOCOL_BEGIN_WRITE) {
      uploadTime = now;
    }
    protocolState = 2;
  }
  // A reset during a save abandons its reply; flash still has to finish safely.
  if (!resetPending && USB_EP1_sendConfig(protocolReply)) {
    protocolState = 0;
    USB_EP1_receiveReady();
  }
}
