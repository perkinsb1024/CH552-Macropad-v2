#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint8_t interface_number;
  uint8_t ep_in;
  uint8_t ep_out;
  uint16_t packet_in;
  uint16_t packet_out;
  size_t in_offset;
  size_t out_offset;
} probe_endpoints_t;

typedef struct {
  uint8_t version[3];
  uint8_t chip_id[4];
  uint16_t field_mask;
} probe_info_t;

bool probe_usb_identity(uint16_t vid, uint16_t pid);
bool probe_parse_interface(const uint8_t *data, size_t len, probe_endpoints_t *out);
// Decode a nine-byte configuration header, bounding the subsequent full read.
uint16_t probe_config_length(const uint8_t *data, size_t len, size_t capacity);
// Only these two immutable read-only requests are exposed; there is no raw OUT API.
const uint8_t *probe_request(uint8_t command, size_t *len);
bool probe_parse_detect(const uint8_t *data, size_t len);
bool probe_parse_info(const uint8_t *data, size_t len, probe_info_t *out);
