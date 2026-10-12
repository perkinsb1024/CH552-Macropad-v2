#include "scan.h"
#include <string.h>

bool scan_skip(uint8_t c) {
  // Exact selectors traced in MINI KeyBoard.exe: twelve keys and two knobs.
  // A1 selects the configuration layer; AA saves keys/LEDs; B0 sets LEDs.
  return (c >= 1 && c <= 18) || c == 0xa1 || c == 0xaa || c == 0xb0;
}
bool scan_next(unsigned *cursor, uint8_t *command) {
  while (*cursor < 256) {
    unsigned c = (*cursor)++;
    if (!scan_skip((uint8_t)c)) { *command = (uint8_t)c; return true; }
  }
  return false;
}
size_t scan_packet(scan_report_t report, uint8_t command, uint8_t out[65]) {
  if (!report.bytes || report.bytes > SCAN_REPORT_MAX || scan_skip(command)) return 0;
  size_t n = report.bytes + (report.id != 0);
  memset(out, 0, n);
  if (report.id) out[0] = report.id;
  out[report.id != 0] = command;
  return n;
}
uint32_t scan_crc(const void *data, size_t len) {
  const uint8_t *p = data;
  uint32_t crc = UINT32_MAX;
  while (len--) {
    crc ^= *p++;
    for (unsigned i = 0; i < 8; i++) crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320u : 0);
  }
  return ~crc;
}

bool scan_parse_hid(const uint8_t *data, size_t len, scan_layout_t *out) {
  typedef struct { uint32_t page, size, count, id; } globals_t;
  globals_t g = {0}, stack[8];
  unsigned sp = 0, depth = 0;
  bool vendor[16], uses_ids = false;
  // Static workspace: called serially on core0; avoid the 4KiB stack.
  static uint32_t bits[256];
  static bool vendor_data[256], other_data[256];
  uint32_t usage = 0;
  bool usage_set = false;
  if (!data || !len || !out) return false;
  memset(out, 0, sizeof(*out)); memset(bits, 0, sizeof(bits));
  memset(vendor_data, 0, sizeof(vendor_data)); memset(other_data, 0, sizeof(other_data));
  for (size_t pos = 0; pos < len;) {
    uint8_t item = data[pos++];
    if (item == 0xfe) return false; // Unsupported long item: no guessing.
    unsigned n = item & 3; if (n == 3) n = 4;
    if (n > len - pos) return false;
    uint32_t value = 0;
    for (unsigned i = 0; i < n; i++) value |= (uint32_t)data[pos++] << (8 * i);
    unsigned type = (item >> 2) & 3, tag = item >> 4;
    if (type == 1) {
      switch (tag) {
        case 0: if (value > 0xffff) return false; g.page = value; break;
        case 7: g.size = value; break;
        case 8:
          if (!value || value > 255) return false;
          g.id = value; uses_ids = true; break;
        case 9: g.count = value; break;
        case 10: if (sp == 8) return false; stack[sp++] = g; break;
        case 11: if (!sp) return false; g = stack[--sp]; break;
        default: break;
      }
    } else if (type == 2) {
      if (tag == 0 || tag == 1) { usage = n == 4 ? value >> 16 : g.page; usage_set = true; }
      // Delimiters are outside this bounded parser's supported grammar.
      if (tag == 10) return false;
    } else if (type == 0) {
      if (tag == 10) {
        if (depth == 16) return false;
        uint32_t page = usage_set ? usage : g.page;
        vendor[depth] = (depth && vendor[depth - 1]) || page >= 0xff00;
        depth++;
      } else if (tag == 12) {
        if (!depth) return false;
        depth--;
      } else if (tag == 9) {
        if (!depth || !g.size || !g.count || g.size > 512 || g.count > 512 ||
            g.size * g.count > 512 || bits[g.id] > 512 - g.size * g.count) return false;
        bits[g.id] += g.size * g.count;
        if (!(value & 1)) {
          bool v = vendor[depth - 1] || g.page >= 0xff00;
          if (v) vendor_data[g.id] = true; else other_data[g.id] = true;
        }
      }
      usage_set = false;
    } else return false;
  }
  if (depth || sp || (uses_ids && bits[0])) return false;
  const uint8_t preferred[] = {3, 0, 2};
  for (unsigned i = 0; i < SCAN_IDS; i++) {
    unsigned id = preferred[i];
    if (bits[id] && !(bits[id] & 7) && vendor_data[id] && !other_data[id])
      out->reports[out->count++] = (scan_report_t){(uint8_t)id, (uint16_t)(bits[id] / 8)};
  }
  return out->count != 0;
}
