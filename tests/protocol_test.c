#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/config.h"
#include "../src/protocol_firmware.h"

static uint8_t flash[CONFIG_SIZE];
static uint8_t sent[32];
static uint8_t sends;
static uint8_t ready;

uint8_t eeprom_read_byte(uint8_t offset) {
    return flash[offset];
}

uint8_t USB_EP1_sendConfig(const uint8_t *reply) {
    memcpy(sent, reply, sizeof(sent));
    sends++;
    return 1;
}

void USB_EP1_receiveReady(void) {
    ready++;
}

static void request(uint8_t opcode, uint8_t offset, uint8_t length) {
    uint8_t packet[32] = {3, 'U', 'M', 1};
    packet[4] = opcode;
    packet[5] = 42;
    packet[6] = offset;
    packet[7] = length;
    assert(protocolReceive(packet));
    protocolPoll();
    assert(sent[0] == 4 && sent[4] == opcode && sent[5] == 42);
    assert(ready == sends);
}

int main(void) {
    uint8_t packet[32] = {3, 'U', 'M', 2, 1};
    configDefaults(CONFIG_SIX_KEYS);
    memcpy(flash, activeConfig, sizeof(flash));
    protocolInit();
    request(1, 0, 0);
    assert(sent[8] == 0 && sent[7] == 14);
    assert(memcmp(sent + 9, "UMAC", 4) == 0);
    assert(sent[16] == 6 && sent[19] == 128);
    assert(sent[21] == 0 && sent[22] == 0);
    request(2, 0, 0);
    assert(sent[8] == 0 && sent[9] == 1 && sent[10] == 0);
    request(4, 120, 8);
    assert(sent[8] == 0 && sent[7] == 8);
    assert(memcmp(sent + 9, flash + 120, 8) == 0);
    request(3, 127, 2);
    assert(sent[8] == 3 && sent[7] == 0);
    request(8, 0, 0);
    assert(sent[8] == 2 && sent[7] == 0);
    assert(protocolReceive(packet));
    protocolPoll();
    assert(sent[8] == 1);
    packet[3] = 1;
    packet[8] = 1;
    assert(protocolReceive(packet));
    protocolPoll();
    assert(sent[8] == 4 && sent[7] == 0);
    packet[8] = 0;
    flash[6] ^= 1;
    protocolInit();
    request(2, 0, 0);
    assert(sent[9] == 0);
    request(3, 6, 1);
    assert(sent[9] == flash[6]);
    request(4, 6, 1);
    assert(sent[9] == activeConfig[6] && sent[9] != flash[6]);
    return 0;
}
