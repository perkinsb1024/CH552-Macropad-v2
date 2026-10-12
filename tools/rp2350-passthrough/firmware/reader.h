#pragma once
#include "probe_protocol.h"

enum { READER_DATA_SIZE = 128, READER_CHUNKS = 3, READER_REPLY_SIZE = 64 };
typedef struct {
  bool identified, config_valid, data_status_valid, finished;
  probe_info_t info;
  uint8_t detect[64], config[64], data_reply[3][64], data[128];
  size_t detect_len, config_len, data_reply_len[3], data_len;
  uint32_t global_config;
  uint16_t data_status;
  unsigned step, replies;
  const char *error;
} reader_t;

void reader_init(reader_t *r);
// Closed sequence: A1, A7, AB(offset=0,count=58), AB(58,58), AB(116,12).
// No caller-supplied opcode or arbitrary USB OUT payload is accepted.
size_t reader_request(const reader_t *r, uint8_t out[64]);
void reader_reply(reader_t *r, const uint8_t *data, size_t len);
void reader_fail(reader_t *r, const char *reason);
bool reader_complete(const reader_t *r);
size_t reader_report(const reader_t *r, const char *version, char *out, size_t capacity);
