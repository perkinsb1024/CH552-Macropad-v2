#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum { SCAN_REPORT_MAX = 64, SCAN_IDS = 3 };
typedef struct { uint8_t id; uint16_t bytes; } scan_report_t;
typedef struct { scan_report_t reports[SCAN_IDS]; unsigned count; } scan_layout_t;
// Only vendor Data Output reports on the legacy configurator's IDs 3, 0, 2.
bool scan_parse_hid(const uint8_t *data, size_t len, scan_layout_t *out);
bool scan_skip(uint8_t command);
// Finds the next unskipped command, including zero, without wrapping at FF.
bool scan_next(unsigned *cursor, uint8_t *command);
size_t scan_packet(scan_report_t report, uint8_t command, uint8_t out[65]);
uint32_t scan_crc(const void *data, size_t len);
