#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/config.h"
#include "config_fixture.h"
#include "../src/protocol_firmware.h"

static uint8_t flash[CONFIG_SIZE];
static uint8_t original[CONFIG_SIZE];
static uint8_t upload[CONFIG_SIZE];
static uint8_t sent[32];
static uint8_t packet[32];
static uint8_t writeOffsets[256];
static uint8_t writeValues[256];
static unsigned writes;
static int failAfter;
static unsigned applies;
static uint8_t preview;
static uint16_t now;
static uint8_t busy;
static uint8_t resetOnWrite;

uint8_t eeprom_read_byte(uint8_t offset) {
    assert(offset < CONFIG_SIZE);
    return flash[offset];
}

void eeprom_write_byte(uint8_t offset, uint8_t value) {
    assert(offset < CONFIG_SIZE && writes < 256);
    writeOffsets[writes] = offset;
    writeValues[writes++] = value;
    if (resetOnWrite) {
        resetOnWrite = 0;
        protocolReset();
    }
    if (failAfter == 0) {
        return;
    }
    if (failAfter > 0) {
        failAfter--;
    }
    flash[offset] = value;
}

uint8_t USB_EP1_sendConfig(const uint8_t *reply) {
    if (busy) {
        return 0;
    }
    memcpy(sent, reply, sizeof(sent));
    return 1;
}

void USB_EP1_receiveReady(void) {}
uint8_t actionsLayer(void) { return configStartupLayer(); }
uint8_t actionsDropped(uint8_t rotation) { return rotation ? 9 : 3; }
void firmwareApplyConfig(void) { applies++; }
void firmwarePreviewColor(uint8_t options) { preview = options; }

static void seal(uint8_t *image) {
    uint16_t crc = configCrc(image);
    image[6] = crc;
    image[7] = crc >> 8;
}

static void reset(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    memcpy(original, activeConfig, CONFIG_SIZE);
    memcpy(flash, original, CONFIG_SIZE);
    memcpy(upload, original, CONFIG_SIZE);
    upload[3] = 9; // Two layers, starting on layer 1.
    seal(upload);
    assert(configValid(upload, PHYSICAL_VARIANT));
    failAfter = -1;
    writes = applies = 0;
    now = 0;
    busy = resetOnWrite = 0;
    protocolInit();
}

static void prepare(uint8_t opcode, uint8_t offset, uint8_t length, const uint8_t *data) {
    memset(packet, 0, sizeof(packet));
    packet[0] = 3;
    packet[1] = 'U';
    packet[2] = 'M';
    packet[3] = 1;
    packet[4] = opcode;
    packet[5] = 42;
    packet[6] = offset;
    packet[7] = length;
    if (data) {
        memcpy(packet + 9, data, length);
    }
}

static void sendPacket(void) {
    assert(protocolReceive(packet));
    protocolPoll(now);
    assert(sent[0] == 4 && sent[4] == packet[4] && sent[5] == 42);
    if (sent[8]) {
        uint8_t i;
        assert(sent[7] == 0);
        for (i = 9; i < 32; i++) {
            assert(sent[i] == 0);
        }
    }
}

static void request(uint8_t opcode, uint8_t offset, uint8_t length, const uint8_t *data) {
    prepare(opcode, offset, length, data);
    sendPacket();
}

static void begin(void) {
    uint8_t data[3] = {128, upload[6], upload[7]};
    request(5, 0, 3, data);
    assert(sent[8] == 0);
}

static void chunks(void) {
    uint8_t offset = 0;
    while (offset < CONFIG_SIZE) {
        uint8_t length = CONFIG_SIZE - offset;
        if (length > 23) {
            length = 23;
        }
        request(6, offset, length, upload + offset);
        assert(sent[8] == 0);
        offset += length;
    }
}

static void testReads(void) {
    reset();
    request(1, 0, 0, 0);
    assert(sent[21] == 0xFF && sent[22] == 0xFF); // Type 0xF executes a macro.
    assert(sent[8] == 0 && sent[7] == 14);
    assert(memcmp(sent + 9, "UMAC", 4) == 0);
    assert(sent[16] == (PHYSICAL_VARIANT ? 3 : 6) && sent[19] == 128);
    assert(sent[14] == CONFIG_VERSION && sent[18] == CONFIG_MAX_LAYERS);
    request(2, 0, 0, 0);
    assert(sent[9] == 1 && sent[10] == 0 && sent[12] == 0);
    request(4, 120, 8, 0);
    assert(sent[7] == 8 && memcmp(sent + 9, flash + 120, 8) == 0);
    request(3, 127, 2, 0);
    assert(sent[8] == 3);
    request(99, 0, 0, 0);
    assert(sent[8] == 2);
    flash[6] ^= 1;
    protocolInit();
    request(2, 0, 0, 0);
    assert(sent[9] == 0 && writes == 0);
    request(3, 6, 1, 0);
    assert(sent[9] == flash[6]);
    request(4, 6, 1, 0);
    assert(sent[9] == flash[6]); // Boot copies even invalid flash into the inactive RAM image.
}

static void testSaveAndRetry(void) {
    unsigned programmed;
    reset();
    begin();
    chunks();
    assert(!writes && !applies && memcmp(activeConfig, original, CONFIG_SIZE) == 0);
    request(7, 0, 0, 0);
    assert(sent[8] == 0 && applies == 1);
    assert(memcmp(flash, upload, CONFIG_SIZE) == 0);
    assert(memcmp(activeConfig, upload, CONFIG_SIZE) == 0);
    assert(writeOffsets[0] == 0 && writeValues[0] == 0);
    assert(writeOffsets[1] == 1 && writeValues[1] == 0);
    assert(writeOffsets[writes - 2] == 1 && writeValues[writes - 2] == 'P');
    assert(writeOffsets[writes - 1] == 0 && writeValues[writes - 1] == 'M');
    programmed = writes;
    request(7, 0, 0, 0); // Lost commit acknowledgement.
    assert(sent[8] == 0 && writes == programmed && applies == 1);
    request(2, 0, 0, 0);
    assert(sent[9] == 1 && sent[10] == 1 && sent[12] == 2);
    begin();
    chunks();
    request(7, 0, 0, 0);
    assert(sent[8] == 0 && writes == programmed);
    protocolInit(); // Power cycle loads the actual saved bytes.
    assert(memcmp(activeConfig, upload, CONFIG_SIZE) == 0);
}

static void testSequenceAndAbort(void) {
    reset();
    request(6, 0, 23, upload);
    assert(sent[8] == 5);
    begin();
    request(6, 1, 23, upload + 1);
    assert(sent[8] == 10);
    request(6, 0, 23, upload);
    assert(sent[8] == 0);
    request(6, 0, 23, upload);
    assert(sent[8] == 0); // Identical duplicate is harmless.
    upload[10] ^= 1;
    request(6, 0, 23, upload);
    assert(sent[8] == 10);
    upload[10] ^= 1;
    request(6, 20, 23, upload + 20);
    assert(sent[8] == 10); // Overlap cannot advance the upload.
    request(7, 0, 0, 0);
    assert(sent[8] == 5);
    request(8, 0, 0, 0);
    assert(sent[8] == 0);
    request(7, 0, 0, 0);
    assert(sent[8] == 5 && writes == 0);
    begin();
    chunks();
    begin(); // A new begin discards the previous image.
    request(7, 0, 0, 0);
    assert(sent[8] == 5 && writes == 0);
}

static void testMalformed(void) {
    uint8_t i;
    reset();
    begin();
    chunks();
    for (i = 9; i < 32; i++) {
        prepare(7, 0, 0, 0);
        packet[i] = 1;
        sendPacket();
        assert(sent[8] == 4 && writes == 0 && applies == 0);
    }
    prepare(7, 0, 0, 0);
    packet[3] = 2;
    sendPacket();
    assert(sent[8] == 1 && writes == 0);
    prepare(7, 0, 0, 0);
    packet[8] = 1;
    sendPacket();
    assert(sent[8] == 4 && writes == 0);
    request(7, 1, 0, 0);
    assert(sent[8] == 3 && writes == 0);
    request(6, 255, 23, upload);
    assert(sent[8] == 3 && writes == 0);
}

static void testValidation(void) {
    reset();
    begin();
    upload[6] ^= 1;
    chunks();
    request(7, 0, 0, 0);
    assert(sent[8] == 7 && !writes);
    reset();
    upload[3] = 0x19; // Two layers with an out-of-range startup layer (3).
    seal(upload);
    begin();
    chunks();
    request(7, 0, 0, 0);
    assert(sent[8] == 6 && !writes);
    testLoadStarterProfile(PHYSICAL_VARIANT ^ 1);
    memcpy(upload, activeConfig, CONFIG_SIZE);
    memcpy(activeConfig, original, CONFIG_SIZE);
    begin();
    chunks();
    request(7, 0, 0, 0);
    assert(sent[8] == 6 && !writes);
}

static void testTimeoutAndReset(void) {
    reset();
    now = 65500;
    begin();
    chunks();
    now += 5000;
    protocolPoll(now);
    request(7, 0, 0, 0);
    assert(sent[8] == 5 && !writes);
    begin();
    chunks();
    protocolReset();
    assert(!protocolReceive(packet));
    protocolPoll(now);
    request(7, 0, 0, 0);
    assert(sent[8] == 5 && !writes);
    begin();
    chunks();
    prepare(7, 0, 0, 0);
    assert(protocolReceive(packet));
    resetOnWrite = 1;
    protocolPoll(now);
    assert(memcmp(flash, upload, CONFIG_SIZE) == 0);
    assert(!protocolReceive(packet));
    protocolPoll(now);
    request(2, 0, 0, 0);
    assert(sent[12] == 0 && sent[9] == 1);
}

static void testBusyReply(void) {
    unsigned programmed;
    reset();
    begin();
    chunks();
    prepare(7, 0, 0, 0);
    assert(protocolReceive(packet));
    busy = 1;
    protocolPoll(now);
    programmed = writes;
    assert(programmed && applies == 1);
    assert(!protocolReceive(packet));
    protocolPoll(now);
    assert(writes == programmed && applies == 1);
    busy = 0;
    protocolPoll(now);
    assert(sent[8] == 0 && sent[4] == 7);
}

static void testFailedWrites(void) {
    unsigned cut;
    unsigned total;
    reset();
    begin();
    chunks();
    request(7, 0, 0, 0);
    total = writes;
    for (cut = 0; cut < total; cut++) {
        reset();
        begin();
        chunks();
        failAfter = cut;
        request(7, 0, 0, 0);
        assert(sent[8] == 9 && applies == 0);
        assert(memcmp(activeConfig, original, CONFIG_SIZE) == 0);
        failAfter = -1;
        request(7, 0, 0, 0);
        assert(sent[8] == 0 && memcmp(flash, upload, CONFIG_SIZE) == 0);

        reset();
        begin();
        chunks();
        failAfter = cut;
        request(7, 0, 0, 0);
        protocolInit(); // Power loss at every individual write boundary.
        assert(memcmp(activeConfig, flash, CONFIG_SIZE) == 0);
        assert(activeConfigValid == (cut == 0));
        request(2, 0, 0, 0);
        assert(sent[9] == (cut == 0));
    }
}

static void testPreview(void) {
    reset();
#if ENABLE_COLOR_PREVIEW
    request(9, 0xFD, 0, 0); // Full-brightness Rainbow.
    assert(sent[8] == 0 && preview == 0xFD && !writes && !applies);
    request(9, 0x24, 0, 0); // Dim orange.
    assert(sent[8] == 0 && preview == 0x24);
    request(9, 0xF5, 0, 0); // Per-key Off, not Rainbow.
    assert(sent[8] == 0 && preview == 0xF5);
    request(9, 0x02, 0, 0);
    assert(sent[8] == 3 && preview == 0xF5);
    prepare(9, 0, 0, 0);
    packet[9] = 1;
    sendPacket();
    assert(sent[8] == 4 && preview == 0xF5);
    request(9, 0, 1, 0);
    assert(sent[8] == 3 && preview == 0xF5);
    request(9, 0, 0, 0);
    assert(sent[8] == 0 && preview == 0);
    flash[0] = 0;
    protocolInit();
    request(9, 5, 0, 0);
    assert(sent[8] == 0 && preview == 5); // No valid config required.
    // Preview traffic must not extend a pending upload's lifetime.
    begin();
    chunks();
    now = 4999;
    request(9, 5, 0, 0);
    now = 5000;
    request(7, 0, 0, 0);
    assert(sent[8] == 5 && !writes);
#else
    request(9, 0, 0, 0); // Cancel doubles as the web app's support probe.
    assert(sent[8] == 2 && !writes && !applies);
    request(9, 0xFD, 0, 0);
    assert(sent[8] == 2 && !writes && !applies);
#endif
}

static void testBootloaderRequest(void) {
    reset();
    prepare(10, 0, 0, 0);
    busy = 1;
    assert(protocolReceive(packet));
    protocolPoll(now);
    assert(protocolState == 2 && writes == 0);
    busy = 0;
    protocolPoll(now);
    assert(protocolState == 3 && sent[8] == 0 && sent[7] == 0 && writes == 0);

    // Invalid requests never arm entry, including padding and offset/length.
    for (uint8_t field = 3; field < 32; field++) {
        if (field == 4 || field == 5) continue;
        reset();
        prepare(10, 0, 0, 0);
        packet[field] = field == 3 ? 2 : 1;
        sendPacket();
        assert(sent[8] && protocolState == 0 && writes == 0);
    }
    reset();
    memset(flash, 0xFF, CONFIG_SIZE);
    protocolInit();
    assert(!activeConfigValid);
    prepare(10, 0, 0, 0);
    sendPacket();
    assert(!sent[8] && protocolState == 3 && writes == 0);

    reset();
    prepare(10, 0, 0, 0);
    busy = 1;
    assert(protocolReceive(packet));
    protocolPoll(now);
    protocolReset();
    busy = 0;
    protocolPoll(now);
    assert(protocolState == 0); // Reset cancels a blocked acknowledgement.
}

int main(void) {
    testBootloaderRequest();
    testPreview();
    testReads();
    testSaveAndRetry();
    testSequenceAndAbort();
    testMalformed();
    testValidation();
    testTimeoutAndReset();
    testBusyReply();
    testFailedWrites();
    return 0;
}
