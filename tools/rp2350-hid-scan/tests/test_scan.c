#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "scan.h"

static const uint8_t vendor[] = {0x06,0,0xff,0x09,1,0xa1,1,0x85,3,0x75,8,0x95,63,0x09,1,0x91,2,0xc0};
int main(void) {
  scan_layout_t layout;
  assert(scan_parse_hid(vendor, sizeof(vendor), &layout));
  assert(layout.count == 1 && layout.reports[0].id == 3 && layout.reports[0].bytes == 63);
  for (size_t i = 0; i < sizeof(vendor); i++) assert(!scan_parse_hid(vendor, i, &layout));
  uint8_t modified[64]; memcpy(modified, vendor, sizeof(vendor));
  modified[2] = 0; assert(!scan_parse_hid(modified, sizeof(vendor), &layout)); // Keyboard/output LEDs.
  memcpy(modified, vendor, sizeof(vendor)); modified[8] = 1;
  assert(!scan_parse_hid(modified, sizeof(vendor), &layout)); // Unsupported report ID.
  memcpy(modified, vendor, sizeof(vendor)); modified[12] = 65;
  assert(!scan_parse_hid(modified, sizeof(vendor), &layout));
  memcpy(modified, vendor, sizeof(vendor)); modified[8] = 0;
  assert(!scan_parse_hid(modified, sizeof(vendor), &layout)); // An explicit ID 0 is invalid.
  const uint8_t zero[] = {0x06,0,0xff,0x09,1,0xa1,1,0x75,8,0x95,64,0x09,1,0x91,2,0xc0};
  assert(scan_parse_hid(zero,sizeof(zero),&layout) && layout.reports[0].id == 0);
  const uint8_t combined[] = {0x06,0,0xff,0x09,1,0xa1,1,0x85,2,0x75,8,0x95,63,0x91,2,
    0x85,3,0x95,6,0x91,2,0xc0};
  assert(scan_parse_hid(combined,sizeof(combined),&layout) && layout.count == 2);
  assert(layout.reports[0].id == 3 && layout.reports[1].id == 2 && layout.reports[0].bytes == 6);
  // Push/pop globals, nested collections and constant padding contribute lengths.
  const uint8_t nested[] = {0x06,0,0xff,0x09,1,0xa1,1,0x85,3,0x75,8,0x95,60,0x91,2,
    0xa4,0x75,8,0x95,3,0x09,2,0xa1,0,0x91,1,0xc0,0xb4,0xc0};
  assert(scan_parse_hid(nested,sizeof(nested),&layout) && layout.reports[0].bytes == 63);
  uint32_t seed = 552;
  for (unsigned t = 0; t < 20000; t++) {
    size_t n = t % sizeof(modified);
    for (size_t i = 0; i < n; i++) { seed = seed * 1664525 + 1013904223; modified[i] = seed >> 24; }
    if (scan_parse_hid(modified,n,&layout)) {
      assert(layout.count && layout.count <= 3);
      for (unsigned i = 0; i < layout.count; i++) assert(layout.reports[i].bytes && layout.reports[i].bytes <= 64);
    }
  }
  unsigned cursor = 0, count = 0; uint8_t command, packet[65];
  while (scan_next(&cursor,&command)) {
    assert(command == 0 || command > 18);
    assert(command != 0xa1 && command != 0xaa && command != 0xb0);
    size_t n = scan_packet((scan_report_t){3,63},command,packet);
    assert(n == 64 && packet[0] == 3 && packet[1] == command);
    for (size_t i = 2; i < n; i++) assert(!packet[i]);
    count++;
  }
  assert(count == 235 && cursor == 256 && command == 255);
  assert(!scan_next(&cursor,&command));
  assert(scan_packet((scan_report_t){0,64},0x55,packet) == 64 && packet[0] == 0x55);
  assert(!scan_packet((scan_report_t){3,63},0xaa,packet));
  assert(scan_crc("123456789",9) == 0xcbf43926);
  puts("HID descriptor/parser, packet framing, complete sweep/skip list and fuzz checks passed");
}
