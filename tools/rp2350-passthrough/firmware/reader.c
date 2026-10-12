#include "reader.h"
#include <stdio.h>
#include <string.h>

static uint16_t le16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
void reader_init(reader_t *r) { memset(r, 0, sizeof(*r)); }
void reader_fail(reader_t *r, const char *reason) {
  if (r->finished) return;
  r->finished = true;
  r->error = reason;
}
size_t reader_request(const reader_t *r, uint8_t out[64]) {
  if (r->finished) return 0;
  if (r->step < 2) {
    size_t len;
    const uint8_t *data = probe_request(r->step == 0 ? 0xa1 : 0xa7, &len);
    memcpy(out, data, len);
    return len;
  }
  if (r->step >= 5 || !r->identified) return 0;
  // CH552 DataFlash uses logical byte offsets, not the physical 0xC000 cells.
  const uint8_t offset = (uint8_t)((r->step - 2) * 58);
  const uint8_t count = r->step == 4 ? 12 : 58;
  const uint8_t request[] = {0xab, 0x06, 0x00, offset, 0, 0, 0, count, 0};
  memcpy(out, request, sizeof(request));
  return sizeof(request);
}
void reader_reply(reader_t *r, const uint8_t *data, size_t len) {
  if (r->finished) return;
  if (!data || len > 64) { reader_fail(r, "oversized_or_missing_reply"); return; }
  r->replies++;
  if (r->step == 0) {
    memcpy(r->detect, data, len); r->detect_len = len;
    if (!probe_parse_detect(data, len)) { reader_fail(r, "not_a_valid_ch552_reply"); return; }
    r->identified = true;
  } else if (r->step == 1) {
    memcpy(r->config, data, len); r->config_len = len;
    r->config_valid = probe_parse_info(data, len, &r->info);
    if (r->config_valid) {
      r->global_config = (uint32_t)le16(data + 14) | ((uint32_t)le16(data + 16) << 16);
      if (r->info.version[0] != 2) { reader_fail(r, "unsupported_bootloader_version"); return; }
    } else {
      // The A1 payload already established CH552/v2 protocol identity. Preserve
      // the failed A7 reply but still attempt the documented DataFlash reads.
      r->error = "invalid_configuration_reply";
    }
  } else if (r->step < 5) {
    const unsigned chunk = r->step - 2;
    const size_t count = chunk == 2 ? 12 : 58;
    memcpy(r->data_reply[chunk], data, len); r->data_reply_len[chunk] = len;
    if (len < 6 || data[0] != 0xab || le16(data + 2) < 2 ||
        (size_t)le16(data + 2) > len - 4) {
      reader_fail(r, "invalid_dataflash_reply"); return;
    }
    r->data_status = le16(data + 4);
    r->data_status_valid = true;
    if (r->data_status) { reader_fail(r, "dataflash_read_rejected"); return; }
    if (len != count + 6 || le16(data + 2) != count + 2) {
      reader_fail(r, "short_or_mismatched_dataflash_reply"); return;
    }
    memcpy(r->data + r->data_len, data + 6, count); r->data_len += count;
  } else { reader_fail(r, "invalid_reader_state"); return; }
  if (++r->step == 5) r->finished = true;
}
bool reader_complete(const reader_t *r) {
  return r->finished && r->identified && r->config_valid && !r->error && r->data_len == 128;
}
size_t reader_report(const reader_t *r, const char *version, char *out, size_t capacity) {
  // Version and errors are firmware constants, never target-supplied strings.
  char cfg[32] = "null", protection[8] = "null", external_read[8] = "null", boot[8] = "null";
  char uid[16] = "null", status[16] = "null";
  uint32_t crc = 0xffffffffu;
  for (size_t i = 0; i < r->data_len; i++) {
    crc ^= r->data[i];
    for (unsigned bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  crc ^= 0xffffffffu;
  if (r->data_status_valid) snprintf(status, sizeof(status), "%u", r->data_status);
  if (r->config_valid) {
    snprintf(cfg, sizeof(cfg), "\"0x%08lx\"", (unsigned long)r->global_config);
    snprintf(protection, sizeof(protection), "%u", !!(r->global_config & 0x8000));
    snprintf(external_read, sizeof(external_read), "%s", r->global_config & 0x8000 ? "true" : "false");
    snprintf(boot, sizeof(boot), "%s", r->global_config & 0x4000 ? "true" : "false");
    snprintf(uid, sizeof(uid), "\"%02x%02x%02x%02x\"", r->info.chip_id[0],
      r->info.chip_id[1], r->info.chip_id[2], r->info.chip_id[3]);
  }
  int n = snprintf(out, capacity,
    "{\n  \"reader_version\":\"%s\",\n  \"read_only\":true,\n"
    "  \"bootloader_entry_confirmed\":%s,\n  \"capture_complete\":%s,\n"
    "  \"configuration_valid\":%s,\n  \"bootloader_version\":%s",
    version, r->identified ? "true" : "false", reader_complete(r) ? "true" : "false",
    r->config_valid ? "true" : "false", r->config_valid ? "\"" : "null");
  if (n < 0 || (size_t)n >= capacity) return 0;
  size_t used = (size_t)n;
  if (r->config_valid) {
    n = snprintf(out + used, capacity - used, "%u.%u.%u\"", r->info.version[0], r->info.version[1], r->info.version[2]);
    if (n < 0 || (size_t)n >= capacity - used) return 0;
    used += (size_t)n;
  }
  n = snprintf(out + used, capacity - used,
    ",\n  \"chip_uid\":%s,\n  \"global_configuration_raw\":%s,\n  \"code_protect_bit\":%s,\n"
    "  \"external_code_read_allowed\":%s,\n  \"bootloader_enabled\":%s,\n"
    "  \"dataflash_expected_bytes\":128,\n  \"dataflash_read_bytes\":%u,\n"
    "  \"dataflash_crc32\":\"%08lx\",\n"
    "  \"dataflash_last_status\":%s,\n  \"error\":%s%s%s,\n"
    "  \"code_flash_captured\":false,\n"
    "  \"code_flash_note\":\"No documented USB code-flash read command; Code_Protect describes the external serial interface.\",\n"
    "  \"storage\":\"volatile RP2350 RAM; copy files before reset or power removal\"\n}\n",
    uid, cfg, protection, external_read, boot, (unsigned)r->data_len, (unsigned long)crc, status,
    r->error ? "\"" : "", r->error ? r->error : "null", r->error ? "\"" : "");
  if (n < 0 || (size_t)n >= capacity - used) return 0;
  return used + (size_t)n;
}
