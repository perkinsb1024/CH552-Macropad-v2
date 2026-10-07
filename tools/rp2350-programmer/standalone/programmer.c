#include "programmer.h"
#include <string.h>

program_timer_t program_deadline_action(bool gap, bool active, uint32_t now, uint32_t deadline) {
  if ((int32_t)(now - deadline) < 0) return PROGRAM_TIMER_NONE;
  if (gap) return PROGRAM_TIMER_NEXT;
  return active ? PROGRAM_TIMER_TIMEOUT : PROGRAM_TIMER_NONE;
}

uint32_t program_crc32(const uint8_t *data, size_t len) {
  uint32_t crc = UINT32_MAX;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (unsigned bit = 0; bit < 8; bit++)
      crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320u : 0);
  }
  return ~crc;
}

void program_fail(programmer_t *p, const char *reason) {
  p->stage = PROGRAM_ERROR;
  p->error = reason;
}

bool program_init(programmer_t *p, const uint8_t *image, size_t len, uint32_t crc) {
  memset(p, 0, sizeof(*p));
  p->image = image;
  p->image_len = len;
  if (!image || len != PROGRAM_LIMIT || program_crc32(image, len) != crc) {
    program_fail(p, "embedded_image_invalid");
    return false;
  }
  p->stage = PROGRAM_DETECT;
  return true;
}

const char *program_stage_name(program_stage_t stage) {
  static const char *const names[] = {"detect", "info", "key", "erase", "write",
    "verify", "config_readback", "reboot", "done", "error"};
  return (unsigned)stage < sizeof(names) / sizeof(names[0]) ? names[stage] : "invalid";
}

size_t program_packet(const programmer_t *p, uint8_t packet[64]) {
  memset(packet, 0, 64);
  if (p->stage == PROGRAM_DETECT || p->stage == PROGRAM_INFO ||
      p->stage == PROGRAM_FINAL_INFO) {
    size_t len;
    const uint8_t *request = probe_request(p->stage == PROGRAM_DETECT ? 0xa1 : 0xa7, &len);
    memcpy(packet, request, len);
    return len;
  }
  if (p->stage == PROGRAM_KEY) {
    packet[0] = 0xa3; packet[1] = 30; // Zero seed, same key scheme as webUploader.
    return 33;
  }
  if (p->stage == PROGRAM_ERASE) {
    packet[0] = 0xa4; packet[1] = 1; packet[3] = 14; // 14 application KiB.
    return 4;
  }
  if (p->stage == PROGRAM_WRITE || p->stage == PROGRAM_VERIFY) {
    if (!p->image || p->image_len != PROGRAM_LIMIT ||
        p->offset >= PROGRAM_LIMIT || (p->offset & 7)) return 0;
    size_t n = p->image_len - p->offset;
    if (n > PROGRAM_CHUNK) n = PROGRAM_CHUNK;
    packet[0] = p->stage == PROGRAM_WRITE ? 0xa5 : 0xa6;
    packet[1] = (uint8_t)(n + 5);
    packet[3] = (uint8_t)p->offset;
    packet[4] = (uint8_t)(p->offset >> 8);
    for (size_t i = 0; i < n; i++) packet[8 + i] = p->image[p->offset + i] ^ p->key[i & 7];
    return n + 8;
  }
  if (p->stage == PROGRAM_REBOOT) {
    packet[0] = 0xa2; packet[1] = 1; packet[3] = 1;
    return 4; // No IN reply expected.
  }
  return 0;
}

static bool status_reply(const uint8_t *data, size_t len, uint8_t command, uint8_t value) {
  // Header byte 1 varies on real hardware; command and payload are authoritative.
  return data && len == 6 && data[0] == command && data[2] == 2 && data[3] == 0 &&
    data[4] == value && data[5] == 0;
}

bool program_reply(programmer_t *p, const uint8_t *data, size_t len) {
  if (p->stage == PROGRAM_ERROR || p->stage == PROGRAM_DONE) return false;
  if (p->stage == PROGRAM_DETECT) {
    if (!probe_parse_detect(data, len)) goto invalid;
    p->stage = PROGRAM_INFO;
    return true;
  }
  if (p->stage == PROGRAM_INFO || p->stage == PROGRAM_FINAL_INFO) {
    probe_info_t info;
    if (!probe_parse_info(data, len, &info)) goto invalid;
    // This POC deliberately targets the bootloader version tested on this pad.
    if (info.version[0] != 2 || info.version[1] != 5 || info.version[2] != 0) {
      program_fail(p, "unsupported_bootloader_version"); return false;
    }
    if (p->stage == PROGRAM_FINAL_INFO) {
      if (memcmp(info.chip_id, p->info.chip_id, 4) ||
          memcmp(data + 6, p->config, sizeof(p->config))) {
        program_fail(p, "config_readback_changed"); return false;
      }
      p->stage = PROGRAM_REBOOT;
    } else {
      p->info = info;
      memcpy(p->config, data + 6, sizeof(p->config));
      uint8_t sum = 0;
      for (unsigned i = 0; i < 4; i++) sum += info.chip_id[i];
      memset(p->key, sum, sizeof(p->key));
      p->key[7] += 0x52;
      p->stage = PROGRAM_KEY;
    }
    return true;
  }
  if (p->stage == PROGRAM_KEY) {
    uint8_t checksum = 0;
    for (unsigned i = 0; i < 8; i++) checksum += p->key[i];
    if (!status_reply(data, len, 0xa3, checksum)) {
      program_fail(p, "key_checksum_failed"); return false;
    }
    p->stage = PROGRAM_ERASE;
    return true;
  }
  if (p->stage == PROGRAM_ERASE) {
    if (!status_reply(data, len, 0xa4, 0)) {
      program_fail(p, "erase_failed"); return false;
    }
    p->stage = PROGRAM_WRITE;
    p->offset = 0;
    return true;
  }
  if (p->stage == PROGRAM_WRITE || p->stage == PROGRAM_VERIFY) {
    if (!status_reply(data, len, p->stage == PROGRAM_WRITE ? 0xa5 : 0xa6, 0)) {
      program_fail(p, p->stage == PROGRAM_WRITE ? "write_failed" : "verify_failed");
      return false;
    }
    size_t n = p->image_len - p->offset;
    p->offset += n > PROGRAM_CHUNK ? PROGRAM_CHUNK : n;
    if (p->offset == p->image_len) {
      p->stage = p->stage == PROGRAM_WRITE ? PROGRAM_VERIFY : PROGRAM_FINAL_INFO;
      p->offset = 0;
    }
    return true;
  }
invalid:
  program_fail(p, "invalid_bootloader_reply");
  return false;
}

bool program_reboot_sent(programmer_t *p) {
  if (p->stage != PROGRAM_REBOOT) return false;
  p->stage = PROGRAM_DONE;
  return true;
}
