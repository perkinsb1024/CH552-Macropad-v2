#pragma once
#include <stdbool.h>
void hcd_event_device_remove(unsigned rhport, bool in_isr);
void hcd_event_device_attach(unsigned rhport, bool in_isr);
