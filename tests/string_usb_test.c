// Exercise string playback through the real action engine, ASCII mapper, USB
// queue, and endpoint buffers. Existing action tests stub both mapper and USB.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define __at(address)
#define __sfr uint8_t
#define __sbit uint8_t
#define __sfr16 uint16_t
#define __sfr32 uint32_t
#define USER_USB_RAM 148
#define CH552
#pragma pack(push, 1)
#include "../src/userUsbHidKeyboardMouse/USBconstant.c"
#pragma pack(pop)
#include "../src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c"
#include "../src/userUsbHidKeyboardMouse/USBhandler.c"
#include "../src/config.h"
#include "../src/actions.h"

uint8_t protocolReceive(const uint8_t *packet) { (void)packet; return 0; }
void protocolReset(void) {}
void firmwareLedAction(uint8_t command, uint8_t value) { (void)command; (void)value; }

static uint8_t edges[512][8], hostKeys[8];
static unsigned edgeCount, acknowledgments;
static uint32_t wallClock, ackAt;
static uint32_t nextConfigAt;
static unsigned transferMs;
static uint8_t inFlight, configTraffic;

static void step(void) {
    if (inFlight && wallClock >= ackAt) {
        if (Ep1Buffer[64] == 1) {
            assert(UEP1_T_LEN == 9);
            if (memcmp(hostKeys, Ep1Buffer + 65, 8)) {
                assert(edgeCount < 512);
                memcpy(hostKeys, Ep1Buffer + 65, 8);
                memcpy(edges[edgeCount++], hostKeys, 8);
            }
        }
        if (Ep1Buffer[64] == 4) nextConfigAt = wallClock + 10;
        USB_EP1_IN();
        inFlight = 0;
        acknowledgments++;
    }
    USB_reportPoll((uint16_t)wallClock);
    if (configTraffic && wallClock >= nextConfigAt) {
        uint8_t reply[32] = {4, 'U', 'M'};
        if (USB_EP1_sendConfig(reply)) nextConfigAt = UINT32_MAX;
    }
    actionsPoll((uint16_t)wallClock);
    if (UpPoint1_Busy && !inFlight) {
        inFlight = 1;
        ackAt = wallClock + transferMs;
    }
    wallClock++;
}

static void prepare(unsigned delay, uint8_t traffic, uint8_t idle, uint32_t start) {
    static const char text[] = "Timer T!\n";
    memset(activeConfig, 0, CONFIG_SIZE);
    activeConfig[0] = 'M'; activeConfig[1] = 'P'; activeConfig[2] = 7;
    activeConfig[3] = 1 << 6; // One layer, one timer.
    activeConfig[4] = sizeof(text);
    activeConfig[5] = PHYSICAL_VARIANT;
    activeConfig[9] = CONFIG_ACTION_STRING; // Physical Key 1.
    uint8_t timer = configTimedOffset();
    activeConfig[timer] = 0; // Also exercise the same string from one-tick expiry.
    activeConfig[timer + 1] = CONFIG_ACTION_STRING;
    memcpy(activeConfig + timer + CONFIG_TIMED_SIZE, text, sizeof(text));
    uint16_t crc = configCrc(activeConfig);
    activeConfig[6] = crc; activeConfig[7] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    USB_EP1_reset();
    UsbConfig = 1;
    UEP1_CTRL = bUEP_AUTO_TOG | UEP_T_RES_NAK | UEP_R_RES_ACK;
    USB_setIdle(1, idle);
    actionsInit(); actionsTimedReset(0);
    memset(hostKeys, 0, sizeof(hostKeys));
    edgeCount = acknowledgments = inFlight = 0;
    wallClock = start; transferMs = delay; configTraffic = traffic;
    nextConfigAt = start;
}

static void assertString(unsigned first) {
    // Independent expected wire sequence: uppercase T, i,m,e,r,space,T,!,Enter.
    static const uint8_t usage[] = {0x17, 0x0c, 0x10, 0x08, 0x15, 0x2c, 0x17, 0x1e, 0x28};
    for (unsigned i = 0; i < sizeof(usage); i++) {
        uint8_t press[8] = {0};
        press[0] = (i == 0 || i == 6 || i == 7) ? 2 : 0;
        press[2] = usage[i];
        assert(!memcmp(edges[first + i * 2], press, 8));
        uint8_t release[8] = {0};
        assert(!memcmp(edges[first + i * 2 + 1], release, 8));
    }
}

static void scenario(unsigned delay, uint8_t traffic, uint8_t idle, uint32_t start) {
    prepare(delay, traffic, idle, start);
    for (uint8_t repeat = 1; repeat <= 6; repeat++) {
        unsigned first = edgeCount;
        if (repeat & 1) {
            actionsPress(0, (uint16_t)wallClock);
            actionsRelease(0);
        } else actionsTimedPoll(repeat);
        for (unsigned i = 0; i < 2000; i++) step();
        if (edgeCount != first + 18) {
            fprintf(stderr, "Incomplete string: variant=%d delay=%u traffic=%u idle=%u repeat=%u edges=%u\n",
                    PHYSICAL_VARIANT, delay, traffic, idle, repeat, edgeCount - first);
            assert(edgeCount == first + 18);
        }
        assertString(first);
    }
    assert(acknowledgments > 0);
}

int main(void) {
    // Endpoint requests a 10 ms polling interval; vary host latency and fairness.
    for (uint8_t traffic = 0; traffic <= 1; traffic++) {
        scenario(1, traffic, 0, 0);
        scenario(10, traffic, 0, 0);
        scenario(37, traffic, 0, 65530); // Slow transfers plus 16-bit clock wrap.
    }
    scenario(1, 0, 1, 0); // Periodic unchanged-state reports must preserve edges.
    return 0;
}
