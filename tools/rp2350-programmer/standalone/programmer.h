#pragma once
#include "probe_protocol.h"

enum { PROGRAM_LIMIT = 0x3800, PROGRAM_CHUNK = 56 };
typedef enum {
  PROGRAM_DETECT, PROGRAM_INFO, PROGRAM_KEY, PROGRAM_ERASE,
  PROGRAM_WRITE, PROGRAM_VERIFY, PROGRAM_FINAL_INFO, PROGRAM_REBOOT,
  PROGRAM_DONE, PROGRAM_ERROR
} program_stage_t;

typedef struct {
  program_stage_t stage;
  const uint8_t *image;
  size_t image_len;
  size_t offset;
  uint8_t key[8];
  uint8_t config[12];
  probe_info_t info;
  const char *error;
} programmer_t;

uint32_t program_crc32(const uint8_t *data, size_t len);
bool program_init(programmer_t *p, const uint8_t *image, size_t len, uint32_t crc);
size_t program_packet(const programmer_t *p, uint8_t packet[64]);
bool program_reply(programmer_t *p, const uint8_t *data, size_t len);
bool program_reboot_sent(programmer_t *p);
void program_fail(programmer_t *p, const char *reason);
const char *program_stage_name(program_stage_t stage);

typedef enum { PROGRAM_TIMER_NONE, PROGRAM_TIMER_NEXT, PROGRAM_TIMER_TIMEOUT } program_timer_t;
// Use one time snapshot: an expired pacing gap sends a command, never times out.
program_timer_t program_deadline_action(bool gap, bool active, uint32_t now, uint32_t deadline);
