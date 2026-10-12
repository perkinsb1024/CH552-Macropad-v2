#include "probe_protocol.h"

static uint16_t le16(const uint8_t *p) {
  return (uint16_t)p[0] | (uint16_t)((uint16_t)p[1] << 8);
}

bool probe_usb_identity(uint16_t vid, uint16_t pid) {
  return (vid == 0x4348 || vid == 0x1a86) && pid == 0x55e0;
}

uint16_t probe_config_length(const uint8_t *data, size_t len, size_t capacity) {
  if (!data || len < 9 || data[0] != 9 || data[1] != 2) return 0;
  uint16_t total = le16(data + 2);
  // Minimum: configuration + interface + bulk IN and OUT descriptors.
  return total >= 32 && total <= capacity ? total : 0;
}

bool probe_parse_interface(const uint8_t *data, size_t len, probe_endpoints_t *out) {
  // Interface descriptor, alternate zero, vendor class, exactly two endpoints.
  if (!data || !out || len < 9 || data[0] != 9 || data[1] != 4 ||
      data[3] != 0 || data[4] != 2 || data[5] != 0xff) return false;
  probe_endpoints_t result = {.interface_number = data[2]};
  unsigned count = 0;
  for (size_t pos = 9; pos < len;) {
    if (len - pos < 2 || data[pos] < 2 || data[pos] > len - pos) return false;
    if (data[pos + 1] == 4 || data[pos + 1] == 11) break;
    if (data[pos + 1] == 5) {
      if (data[pos] != 7) return false;
      const uint8_t ep = data[pos + 2];
      const uint16_t packet = le16(data + pos + 4);
      if ((data[pos + 3] & 3) != 2 || (ep & 0x70) || !(ep & 0x0f) ||
          (packet != 8 && packet != 16 && packet != 32 && packet != 64)) return false;
      if (ep & 0x80) {
        if (result.ep_in) return false;
        result.ep_in = ep;
        result.packet_in = packet;
        result.in_offset = pos;
      } else {
        if (result.ep_out) return false;
        result.ep_out = ep;
        result.packet_out = packet;
        result.out_offset = pos;
      }
      count++;
    }
    pos += data[pos];
  }
  if (count != 2 || !result.ep_in || !result.ep_out) return false;
  *out = result;
  return true;
}

const uint8_t *probe_request(uint8_t command, size_t *len) {
  static const uint8_t detect[] = {
    0xa1, 0x12, 0x00, 0x00, 0x11, 0x4d, 0x43, 0x55, 0x20, 0x49, 0x53,
    0x50, 0x20, 0x26, 0x20, 0x57, 0x43, 0x48, 0x2e, 0x43, 0x4e
  };
  static const uint8_t info[] = {0xa7, 0x02, 0x00, 0x1f, 0x00};
  *len = 0;
  if (command == 0xa1) { *len = sizeof(detect); return detect; }
  if (command == 0xa7) { *len = sizeof(info); return info; }
  return NULL;
}

static bool valid_reply(const uint8_t *data, size_t len, uint8_t command, size_t min) {
  // Byte 1 is not a reliable status field for these read replies. Validate the
  // command, declared payload length, and command-specific payload instead.
  return data && len >= min && len <= 64 && data[0] == command &&
    le16(data + 2) >= min - 4 && (size_t)le16(data + 2) <= len - 4;
}

bool probe_parse_detect(const uint8_t *data, size_t len) {
  // Real captures returned A1 9F 02 00 52 11 and A1 9D 02 00 52 11.
  // Upstream readers likewise identify using payload bytes, not header byte 1.
  return data && len == 6 && data[0] == 0xa1 && le16(data + 2) == 2 &&
    data[4] == 0x52 && data[5] == 0x11;
}

bool probe_parse_info(const uint8_t *data, size_t len, probe_info_t *out) {
  if (!out || !valid_reply(data, len, 0xa7, 26) || (le16(data + 4) & 0x1f) != 0x1f)
    return false;
  out->field_mask = le16(data + 4);
  for (unsigned i = 0; i < 3; i++) out->version[i] = data[19 + i];
  for (unsigned i = 0; i < 4; i++) out->chip_id[i] = data[22 + i];
  return true;
}
