// Compile the real USB handlers against byte variables in place of device registers.
#include <assert.h>
#include <stdint.h>
#include <string.h>
#define __xdata
#define __code
#define __data
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

static uint8_t received[32];
static unsigned receives;
static unsigned resets;
static uint8_t inboxBusy;

uint8_t protocolReceive(const uint8_t *packet) {
    if (inboxBusy) {
        return 0;
    }
    memcpy(received, packet, 32);
    receives++;
    return 1;
}

void protocolReset(void) { resets++; }

static void reset(void) {
    USB_EP1_reset();
    UsbConfig = 1;
    UEP1_CTRL = bUEP_AUTO_TOG | UEP_T_RES_NAK | UEP_R_RES_ACK;
    U_TOG_OK = 1;
    receives = resets = inboxBusy = 0;
}

static void setupRequest(uint8_t type, uint8_t request, uint16_t value,
                         uint16_t index, uint16_t length) {
    Ep0Buffer[0] = type;
    Ep0Buffer[1] = request;
    Ep0Buffer[2] = value;
    Ep0Buffer[3] = value >> 8;
    Ep0Buffer[4] = index;
    Ep0Buffer[5] = index >> 8;
    Ep0Buffer[6] = length;
    Ep0Buffer[7] = length >> 8;
    USB_RX_LEN = 8;
    USB_EP0_SETUP();
}

static void testQueue(void) {
    uint8_t i;
    uint8_t keys[8] = {2, 0, 4};
    uint8_t reply[32] = {4, 'U', 'M'};
    reset();
    for (i = 0; i < 8; i++) {
        assert(USB_queueKeyboard(keys));
    }
    assert(!USB_queueConsumer(0xE9));
    assert(!USB_EP1_sendConfig(reply));
    USB_reportPoll(0);
    assert(UEP1_T_LEN == 9 && Ep1Buffer[64] == 1 && Ep1Buffer[67] == 4);
    USB_EP1_IN();
    USB_reportPoll(1); // Give a waiting config reply a turn despite queued input.
    assert(!UpPoint1_Busy);
    assert(USB_EP1_sendConfig(reply));
    assert(UEP1_T_LEN == 32 && Ep1Buffer[64] == 4);
    USB_EP1_IN();
    assert(!USB_EP1_sendConfig(reply)); // The next turn belongs to input.
    USB_reportPoll(2);
    assert(UEP1_T_LEN == 9 && UpPoint1_Busy);
    USB_EP1_reset();
    assert(!USB_reportsPending());
    assert(USB_queueMouse(1, 3, -2, 1));
    assert(USB_queueMouse(0, 0, 0, 0));
    USB_reportPoll(3);
    assert(Ep1Buffer[66] == 3 && Ep1Buffer[67] == 254 && Ep1Buffer[68] == 1);
    USB_EP1_IN();
    USB_reportPoll(4);
    assert(Ep1Buffer[65] == 0 && Ep1Buffer[66] == 0 && Ep1Buffer[68] == 0);
}

static void testControlReports(void) {
    uint8_t i;
    uint8_t packet[32] = {3, 'U', 'M', 1, 1};
    reset();
    setupRequest(0x21, 9, 0x203, 0, 32);
    assert((UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_NAK);
    for (i = 0; i < 32; i += 8) {
        memcpy(Ep0Buffer, packet + i, 8);
        USB_RX_LEN = 8;
        USB_EP0_OUT();
    }
    assert(receives == 1 && memcmp(received, packet, 32) == 0);
    assert(UEP0_T_LEN == 0 && (UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_ACK);
    USB_EP0_IN();
    USB_RX_LEN = 0;
    USB_EP0_OUT();
    assert(receives == 1); // A later zero-length packet cannot replay the request.

    setupRequest(0x21, 9, 0x203, 0, 32);
    USB_RX_LEN = 4;
    USB_EP0_OUT();
    assert((UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL);
    assert(receives == 1);
    setupRequest(0x21, 9, 0x203, 0, 31);
    assert((UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL);

    setupRequest(0x21, 9, 0x201, 0, 2);
    Ep0Buffer[0] = 1;
    Ep0Buffer[1] = 5;
    USB_RX_LEN = 2;
    USB_EP0_OUT();
    setupRequest(0xA1, 1, 0x201, 0, 2);
    assert(UEP0_T_LEN == 2 && Ep0Buffer[0] == 1 && Ep0Buffer[1] == 5);

    packet[0] = 3;
    memcpy(Ep1Buffer, packet, 32);
    USB_RX_LEN = 31;
    USB_EP1_OUT();
    assert(receives == 1);
    USB_RX_LEN = 32;
    USB_EP1_OUT();
    assert(receives == 2);
}

static void testGetReportAndIdle(void) {
    uint8_t keys[8] = {2, 0, 4, 5, 6, 7, 8, 9};
    reset();
    assert(USB_queueKeyboard(keys));
    USB_reportPoll(100);
    USB_EP1_IN();
    setupRequest(0xA1, 1, 0x101, 0, 9);
    assert(UEP0_T_LEN == 8 && Ep0Buffer[0] == 1 && Ep0Buffer[1] == 2);
    USB_EP0_IN();
    assert(UEP0_T_LEN == 1 && Ep0Buffer[0] == 9);
    assert(USB_queueMouse(1, 2, 3, 4));
    setupRequest(0xA1, 1, 0x102, 0, 5);
    assert(UEP0_T_LEN == 5 && Ep0Buffer[1] == 1 && Ep0Buffer[2] == 0 && Ep0Buffer[4] == 0);
    assert(USB_queueConsumer(0x1E9));
    setupRequest(0xA1, 1, 0x105, 0, 3);
    assert(UEP0_T_LEN == 3 && Ep0Buffer[1] == 0xE9 && Ep0Buffer[2] == 1);
    USB_discardReports();
    setupRequest(0x21, 0x0A, 0x0201, 0, 0);
    setupRequest(0xA1, 0x02, 1, 0, 1);
    assert(UEP0_T_LEN == 1 && Ep0Buffer[0] == 2);
    setupRequest(0xA1, 0x02, 0, 0, 1);
    assert(Ep0Buffer[0] == 0);
    USB_reportPoll(107);
    assert(!UpPoint1_Busy);
    USB_reportPoll(108);
    assert(UpPoint1_Busy && UEP1_T_LEN == 9 && Ep1Buffer[67] == 4);
    setupRequest(0x21, 0x0A, 0x0200, 0, 0);
    setupRequest(0xA1, 0x02, 0, 0, 1);
    assert(Ep0Buffer[0] == 2);

    USB_EP1_reset();
    UsbConfig = 1;
    setupRequest(0x21, 0x0A, 0x0200, 0, 0); // ID zero assigns all inputs.
    USB_reportPoll(8);
    assert(UEP1_T_LEN == 9 && Ep1Buffer[64] == 1);
    USB_EP1_IN();
    USB_reportPoll(8);
    assert(UEP1_T_LEN == 5 && Ep1Buffer[64] == 2 && Ep1Buffer[66] == 0);
    USB_EP1_IN();
    USB_reportPoll(8);
    assert(UEP1_T_LEN == 3 && Ep1Buffer[64] == 5);
}

static void testStandardRequests(void) {
    uint8_t keys[8] = {0, 0, 4};
    reset();
    setupRequest(0x81, USB_GET_DESCRIPTOR, 0x2100, 0, 9);
    assert(UEP0_T_LEN == 8 && Ep0Buffer[1] == 0x21);
    setupRequest(0x81, USB_GET_INTERFACE, 0, 0, 1);
    assert(UEP0_T_LEN == 1 && Ep0Buffer[0] == 0);
    setupRequest(0x02, USB_SET_FEATURE, 0, 0x81, 0);
    assert((UEP1_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL);
    assert(USB_queueKeyboard(keys));
    USB_reportPoll(0);
    assert((UEP1_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL);
    setupRequest(0x82, USB_GET_STATUS, 0, 0x81, 2);
    assert(UEP0_T_LEN == 2 && Ep0Buffer[0] == 1);
    setupRequest(0x02, USB_CLEAR_FEATURE, 0, 0x81, 0);
    assert((UEP1_CTRL & MASK_UEP_T_RES) == UEP_T_RES_NAK && resets == 1);
    setupRequest(0x02, USB_SET_FEATURE, 0, 1, 0);
    USB_EP1_receiveReady();
    assert((UEP1_CTRL & MASK_UEP_R_RES) == UEP_R_RES_STALL);
    setupRequest(0x02, USB_CLEAR_FEATURE, 0, 1, 0);
    assert((UEP1_CTRL & MASK_UEP_R_RES) == UEP_R_RES_ACK);
    setupRequest(0, USB_SET_FEATURE, 1, 0, 0); // No remote wakeup advertised.
    assert((UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL);
    setupRequest(0, USB_SET_CONFIGURATION, 2, 0, 0);
    assert((UEP0_CTRL & MASK_UEP_T_RES) == UEP_T_RES_STALL && UsbConfig == 1);
    setupRequest(0, USB_SET_CONFIGURATION, 0, 0, 0);
    assert(UsbConfig == 0 && resets == 2 && !USB_reportsPending());
}

int main(void) {
    testQueue();
    testControlReports();
    testGetReportAndIdle();
    testStandardRequests();
    return 0;
}
