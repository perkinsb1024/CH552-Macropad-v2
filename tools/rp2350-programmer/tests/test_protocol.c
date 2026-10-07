#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "probe_protocol.h"

int main(void) {
  uint8_t header[] = {9, 2, 32, 0, 1, 1, 0, 0x80, 50};
  assert(probe_config_length(header, sizeof(header), 512) == 32);
  for (size_t n = 0; n < sizeof(header); n++)
    assert(probe_config_length(header, n, 512) == 0);
  assert(probe_config_length(header, sizeof(header), 31) == 0);
  header[2] = 31; assert(probe_config_length(header, sizeof(header), 512) == 0);
  header[2] = 0; header[3] = 2; assert(probe_config_length(header, sizeof(header), 512) == 512);
  header[2] = 1; assert(probe_config_length(header, sizeof(header), 512) == 0);
  header[2] = 32; header[3] = 0;
  header[1] = 1; assert(probe_config_length(header, sizeof(header), 512) == 0);
  header[1] = 2; header[0] = 8; assert(probe_config_length(header, sizeof(header), 512) == 0);

  uint8_t interface[] = {9, 4, 0, 0, 2, 0xff, 0, 0, 0,
    7, 5, 0x02, 2, 64, 0, 0, 7, 5, 0x82, 2, 64, 0, 0};
  probe_endpoints_t ep;
  assert(probe_usb_identity(0x4348, 0x55e0));
  assert(probe_usb_identity(0x1a86, 0x55e0));
  assert(!probe_usb_identity(0x1189, 0x8890));
  assert(!probe_usb_identity(0x4348, 0x55e1));
  assert(probe_parse_interface(interface, sizeof(interface), &ep));
  assert(ep.ep_in == 0x82 && ep.ep_out == 2 && ep.in_offset == 16 && ep.out_offset == 9);
  for (size_t n = 0; n < sizeof(interface); n++)
    assert(!probe_parse_interface(interface, n, &ep));
  uint8_t bad[sizeof(interface)];
  const size_t offsets[] = {0, 1, 3, 4, 5, 9, 11, 12, 13, 14, 16, 18, 19, 20};
  const uint8_t values[] = {8, 3, 1, 3, 3, 0, 0, 3, 65, 8, 20, 2, 3, 0};
  for (size_t i = 0; i < sizeof(offsets) / sizeof(offsets[0]); i++) {
    memcpy(bad, interface, sizeof(bad));
    bad[offsets[i]] = values[i];
    assert(!probe_parse_interface(bad, sizeof(bad), &ep));
  }

  uint8_t detect[] = {0xa1, 0, 2, 0, 0x52, 0x11};
  assert(probe_parse_detect(detect, sizeof(detect)));
  // Regression fixture: probe-20261007T220128-002140Z.jsonl, real USB reply.
  detect[1] = 0x9f;
  assert(probe_parse_detect(detect, sizeof(detect)));
  // Second real capture: probe-20261007T220752-714885Z.jsonl.
  detect[1] = 0x9d;
  assert(probe_parse_detect(detect, sizeof(detect)));
  for (size_t n = 0; n < sizeof(detect); n++) assert(!probe_parse_detect(detect, n));
  uint8_t padded_detect[] = {0xa1, 0x9f, 2, 0, 0x52, 0x11, 0};
  assert(!probe_parse_detect(padded_detect, sizeof(padded_detect)));
  detect[1] = 0x9f; detect[0] = 0xa7; assert(!probe_parse_detect(detect, sizeof(detect)));
  detect[0] = 0xa1; detect[5] = 0x12; assert(!probe_parse_detect(detect, sizeof(detect)));
  detect[5] = 0x11;
  detect[4] = 0x54; assert(!probe_parse_detect(detect, sizeof(detect)));
  detect[4] = 0x52; detect[2] = 3; assert(!probe_parse_detect(detect, sizeof(detect)));

  uint8_t info[30] = {0xa7, 0, 26, 0, 0x1f};
  info[19] = 2; info[20] = 4; info[21] = 0;
  info[22] = 1; info[23] = 2; info[24] = 3; info[25] = 4;
  probe_info_t parsed;
  assert(probe_parse_info(info, sizeof(info), &parsed));
  assert(parsed.version[1] == 4 && parsed.chip_id[3] == 4 && parsed.field_mask == 0x1f);
  for (size_t n = 0; n < sizeof(info); n++) assert(!probe_parse_info(info, n, &parsed));
  info[4] = 0x07; assert(!probe_parse_info(info, sizeof(info), &parsed));
  info[4] = 0x1f; info[0] = 0xa8; assert(!probe_parse_info(info, sizeof(info), &parsed));
  info[0] = 0xa7; info[1] = 0x9f;
  assert(probe_parse_info(info, sizeof(info), &parsed));
  info[1] = 0x9d; assert(probe_parse_info(info, sizeof(info), &parsed));
  info[2] = 27; assert(!probe_parse_info(info, sizeof(info), &parsed));
  info[2] = 21; assert(!probe_parse_info(info, sizeof(info), &parsed));

  // First complete hardware identification: probe-20261007T222052-944174Z.jsonl.
  const uint8_t captured_info[] = {
    0xa7, 0x9d, 0x1a, 0x00, 0x1f, 0x00, 0xff, 0xff, 0xff, 0xff,
    0x23, 0x00, 0x00, 0x00, 0xff, 0x52, 0xff, 0x7d, 0x00, 0x02,
    0x05, 0x00, 0x0f, 0x28, 0x3e, 0xbd, 0x00, 0x00, 0x00, 0x00,
  };
  assert(probe_parse_info(captured_info, sizeof(captured_info), &parsed));
  assert(parsed.version[0] == 2 && parsed.version[1] == 5 && parsed.version[2] == 0);
  const uint8_t captured_id[] = {0x0f, 0x28, 0x3e, 0xbd};
  assert(memcmp(parsed.chip_id, captured_id, sizeof(captured_id)) == 0);
  assert(parsed.field_mask == 0x1f);
  for (size_t n = 0; n < sizeof(captured_info); n++)
    assert(!probe_parse_info(captured_info, n, &parsed));

  for (unsigned cmd = 0; cmd < 256; cmd++) {
    size_t len;
    const uint8_t *request = probe_request((uint8_t)cmd, &len);
    if (cmd == 0xa1 || cmd == 0xa7) {
      assert(request && len == (cmd == 0xa1 ? 21 : 5) && request[0] == cmd);
      assert((size_t)request[1] + 3 == len);
    } else assert(request == NULL && len == 0);
  }
  puts("Protocol tests passed: descriptors, reply bounds, identity, read-only request allowlist");
  return 0;
}
