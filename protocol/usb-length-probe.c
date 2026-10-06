/* Produce a digest of externally observable USB behavior for all wLength values. */
#define main existingUsbMain
#include "tests/usb_test.c"
#undef main
#include <stdio.h>

static uint64_t digest;
static void mix(uint8_t value) { digest = (digest ^ value) * UINT64_C(1099511628211); }
static void observe(void) {
    mix(UEP0_CTRL); mix(UEP0_T_LEN); mix(UEP1_CTRL); mix(UEP1_T_LEN);
    mix(USB_DEV_AD); mix(UsbConfig); mix(UpPoint1_Busy);
    mix(receives); mix(resets);
    for (uint8_t i = 0; i < DEFAULT_ENDP0_SIZE; i++) mix(Ep0Buffer[i]);
}

int main(void) {
    static const struct { uint8_t type, request; uint16_t value, index; } requests[] = {
        {0x80, USB_GET_DESCRIPTOR, 0x0100, 0},
        {0x80, USB_GET_DESCRIPTOR, 0x0200, 0},
        {0x80, USB_GET_DESCRIPTOR, 0x0300, 0},
        {0x80, USB_GET_DESCRIPTOR, 0x0301, 0},
        {0x80, USB_GET_DESCRIPTOR, 0x0302, 0},
        {0x80, USB_GET_DESCRIPTOR, 0x0303, 0},
        {0x81, USB_GET_DESCRIPTOR, 0x2100, 0},
        {0x81, USB_GET_DESCRIPTOR, 0x2200, 0},
        {0x81, USB_GET_DESCRIPTOR, 0x2201, 0},
        {0xA1, 1, 0x0101, 0}, {0xA1, 1, 0x0102, 0}, {0xA1, 1, 0x0105, 0},
        {0xA1, 1, 0x0201, 0}, {0xA1, 1, 0x0203, 0},
        {0x21, 9, 0x0201, 0}, {0x21, 9, 0x0203, 0},
        {0x21, 10, 0x0200, 0}, {0x21, 10, 0x0201, 0},
        {0xA1, 2, 0, 0}, {0xA1, 2, 1, 0}, {0xA1, 2, 2, 0}, {0xA1, 2, 5, 0},
        {0xA1, 2, 1, 1},
        {0, USB_SET_ADDRESS, 7, 0}, {0x80, USB_GET_CONFIGURATION, 0, 0},
        {0, USB_SET_CONFIGURATION, 1, 0}, {0, USB_SET_CONFIGURATION, 0, 0},
        {0x81, USB_GET_INTERFACE, 0, 0}, {1, USB_SET_INTERFACE, 0, 0},
        {2, USB_CLEAR_FEATURE, 0, 0x81}, {2, USB_SET_FEATURE, 0, 0x81},
        {2, USB_CLEAR_FEATURE, 0, 1}, {2, USB_SET_FEATURE, 0, 1},
        {0x80, USB_GET_STATUS, 0, 0}, {0x81, USB_GET_STATUS, 0, 0},
        {0x82, USB_GET_STATUS, 0, 0x81}, {0x82, USB_GET_STATUS, 0, 1},
        {0x82, USB_GET_STATUS, 0, 0x82},
    };
    existingUsbMain();
    for (uint8_t request = 0; request < sizeof(requests) / sizeof(requests[0]); request++) {
        digest = UINT64_C(14695981039346656037);
        for (uint32_t length = 0; length < 65536; length++) {
            reset(); USB_DEV_AD = 0; UEP0_T_LEN = 0;
            SetupReq = 0; SetupLen = 0;
            memset(Ep0Buffer, 0, DEFAULT_ENDP0_SIZE);
            setupRequest(requests[request].type, requests[request].request,
                         requests[request].value, requests[request].index, length);
            observe();
            if (SetupReq == USB_GET_DESCRIPTOR &&
                (UEP0_CTRL & MASK_UEP_T_RES) != UEP_T_RES_STALL) {
                while (SetupLen) { USB_EP0_IN(); observe(); }
                USB_EP0_IN(); observe(); // Final zero-length packet.
            } else if (SetupReq == USB_SET_ADDRESS) {
                USB_EP0_IN(); observe();
            }
        }
        printf("%u %016llx\n", request, (unsigned long long)digest);
    }
    return 0;
}
