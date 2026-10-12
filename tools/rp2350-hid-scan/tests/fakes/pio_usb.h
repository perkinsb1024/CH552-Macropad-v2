#pragma once
typedef struct { unsigned pin_dp, pinout; bool skip_alarm_pool; } pio_usb_configuration_t;
#define PIO_USB_DEFAULT_CONFIG {0}
#define PIO_USB_PINOUT_DPDM 0

void pio_usb_host_frame(void);
