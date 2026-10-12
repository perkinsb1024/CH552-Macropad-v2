#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef unsigned xfer_result_t;
enum { XFER_RESULT_SUCCESS, XFER_RESULT_FAILED, XFER_RESULT_STALLED, TUSB_ROLE_DEVICE, TUSB_ROLE_HOST,
       TUSB_SPEED_FULL, TUH_CFGID_RPI_PIO_USB_CONFIGURATION };
typedef struct { uint8_t bmRequestType, bRequest; uint16_t wValue, wIndex, wLength; } tusb_control_request_t;
typedef struct tuh_xfer_s {
  uint8_t daddr, ep_addr;
  uint32_t buflen, actual_len;
  uint8_t *buffer;
  tusb_control_request_t *setup;
  uintptr_t user_data;
  xfer_result_t result;
  void (*complete_cb)(struct tuh_xfer_s *);
} tuh_xfer_t;
typedef struct { uint8_t bytes[9]; } tusb_desc_interface_t;
typedef struct { uint8_t bytes[7]; } tusb_desc_endpoint_t;
typedef struct { unsigned role, speed; } tusb_rhport_init_t;
bool tuh_edpt_xfer(tuh_xfer_t *xfer);
bool tuh_descriptor_get_configuration(uint8_t addr, uint8_t index, void *data, uint16_t len, void (*cb)(tuh_xfer_t *), uintptr_t arg);
bool tuh_descriptor_get_device(uint8_t addr, void *data, uint16_t len, void (*cb)(tuh_xfer_t *), uintptr_t arg);
void tuh_vid_pid_get(uint8_t addr, uint16_t *vid, uint16_t *pid);
bool tuh_edpt_open(uint8_t addr, const tusb_desc_endpoint_t *ep);
bool tuh_configure(uint8_t port, unsigned id, const void *config);
bool tusb_init(uint8_t port, const tusb_rhport_init_t *init);
bool tuh_inited(void);
void tuh_task_ext(uint32_t timeout, bool isr);
void tud_task_ext(uint32_t timeout, bool isr);
bool tud_cdc_connected(void);
uint32_t tud_cdc_write(const void *data, uint32_t len);
void tud_cdc_write_flush(void);
uint32_t tud_cdc_available(void);
uint32_t tud_cdc_read(void *data, uint32_t len);
void tud_disconnect(void);
void tud_connect(void);
void tud_msc_set_sense(uint8_t lun, uint8_t key, uint8_t asc, uint8_t ascq);
bool tud_msc_test_unit_ready_cb(uint8_t lun);
int32_t tud_msc_read10_cb(uint8_t lun, uint32_t lba, uint32_t offset, void *buffer, uint32_t size);
int32_t tud_msc_write10_cb(uint8_t lun, uint32_t lba, uint32_t offset, uint8_t *buffer, uint32_t size);
int32_t tud_msc_scsi_cb(uint8_t lun, const uint8_t command[16], void *buffer, uint16_t size);
bool tud_msc_is_writable_cb(uint8_t lun);

bool tuh_control_xfer(tuh_xfer_t *xfer);
bool tuh_rhport_reset_bus(uint8_t port, bool active);
