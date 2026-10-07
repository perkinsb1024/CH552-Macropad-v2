#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "programmer.h"

static uint8_t image[PROGRAM_LIMIT], flash[PROGRAM_LIMIT];
static const uint8_t info[] = {
  0xa7,0x9d,0x1a,0,0x1f,0,0xff,0xff,0xff,0xff,0x23,0,0,0,0xff,
  0x52,0xff,0x7d,0,2,5,0,0x0f,0x28,0x3e,0xbd,0,0,0,0
};

static void init(programmer_t *p) {
  assert(program_init(p, image, sizeof(image), program_crc32(image, sizeof(image))));
}

// An independent flash model decodes packets and compares stored bytes. It
// catches wrong addresses, XOR keys, A5 used in the verify loop, and missing tail.
static bool exchange(programmer_t *p, bool corrupt_verify, unsigned *writes, unsigned *verifies) {
  uint8_t packet[64], reply[] = {0, 0xbd, 2, 0, 0, 0};
  size_t len = program_packet(p, packet);
  assert(len >= 4 && len <= 64 && len == (size_t)packet[1] + 3 && packet[2] == 0);
  reply[0] = packet[0];
  if (packet[0] == 0xa1) {
    assert(len == 21);
    reply[4] = 0x52; reply[5] = 0x11;
  } else if (packet[0] == 0xa7) {
    return program_reply(p, info, sizeof(info));
  } else if (packet[0] == 0xa3) {
    assert(len == 33);
    for (size_t i = 3; i < len; i++) assert(packet[i] == 0);
    reply[4] = 0xe2; // For UID 0f283ebd: seven 0x32 bytes and one 0x84.
  } else if (packet[0] == 0xa4) {
    assert(packet[3] == 14);
    memset(flash, 0xff, sizeof(flash));
  } else if (packet[0] == 0xa5 || packet[0] == 0xa6) {
    size_t offset = packet[3] + ((size_t)packet[4] << 8);
    assert(packet[5] == 0 && packet[6] == 0 && packet[7] == 0);
    assert((offset & 7) == 0 && ((len - 8) & 7) == 0);
    assert(offset + len - 8 <= PROGRAM_LIMIT);
    if (packet[0] == 0xa5) {
      assert(offset == *writes);
      *writes += len - 8;
    } else {
      assert(*writes == PROGRAM_LIMIT);
      assert(offset == *verifies);
      *verifies += len - 8;
      if (corrupt_verify) flash[offset] ^= 1;
    }
    for (size_t i = 0; i < len - 8; i++) {
      uint8_t decoded = packet[8 + i] ^ ((i & 7) == 7 ? 0x84 : 0x32);
      if (packet[0] == 0xa5) flash[offset + i] = decoded;
      else if (flash[offset + i] != decoded) reply[4] = 1;
    }
  } else {
    assert(packet[0] == 0xa2 && len == 4 && packet[3] == 1);
    assert(*writes == PROGRAM_LIMIT && *verifies == PROGRAM_LIMIT);
    return program_reboot_sent(p);
  }
  return program_reply(p, reply, sizeof(reply));
}

int main(void) {
  programmer_t p;
  // Hardware regression: A1 at 4833ms, gap deadline 4853ms. A tick between
  // the old pair of clock checks could fail the gap before A7 was submitted.
  assert(program_deadline_action(true, true, 4852, 4853) == PROGRAM_TIMER_NONE);
  assert(program_deadline_action(true, true, 4853, 4853) == PROGRAM_TIMER_NEXT);
  assert(program_deadline_action(true, true, 4854, 4853) == PROGRAM_TIMER_NEXT);
  assert(program_deadline_action(false, true, 4853, 4853) == PROGRAM_TIMER_TIMEOUT);
  assert(program_deadline_action(false, false, 4853, 4853) == PROGRAM_TIMER_NONE);
  assert(program_deadline_action(true, true, UINT32_MAX, 1) == PROGRAM_TIMER_NONE);
  assert(program_deadline_action(true, true, 1, 1) == PROGRAM_TIMER_NEXT);
  // Include an erased gap and nontrivial final bytes at 0x37f8.
  for (size_t i = 0; i < sizeof(image); i++) image[i] = (uint8_t)(i * 17 + i / 256);
  memset(image + 1024, 0xff, 80);
  assert(program_crc32((const uint8_t *)"123456789", 9) == 0xcbf43926u);
  assert(!program_init(&p, image, sizeof(image), 0));
  uint8_t packet[64];
  assert(program_packet(&p, packet) == 0);
  assert(!program_init(&p, image, sizeof(image) - 8, 0));
  init(&p); p.stage = PROGRAM_WRITE; p.offset = PROGRAM_LIMIT;
  assert(program_packet(&p, packet) == 0);
  p.offset = PROGRAM_LIMIT - 1;
  assert(program_packet(&p, packet) == 0);
  p.offset = 0; p.image_len = PROGRAM_LIMIT + 8;
  assert(program_packet(&p, packet) == 0);

  init(&p);
  unsigned writes = 0, verifies = 0, steps = 0;
  while (p.stage != PROGRAM_DONE) {
    assert(exchange(&p, false, &writes, &verifies));
    assert(++steps < 600);
  }
  assert(writes == sizeof(image) && verifies == sizeof(image));
  assert(memcmp(image, flash, sizeof(image)) == 0);
  assert(program_packet(&p, packet) == 0);

  init(&p); writes = verifies = 0;
  while (p.stage != PROGRAM_VERIFY) assert(exchange(&p, false, &writes, &verifies));
  assert(!exchange(&p, true, &writes, &verifies));
  assert(strcmp(p.error, "verify_failed") == 0);
  assert(program_packet(&p, packet) == 0 && !program_reboot_sent(&p));

  // Every destructive-command failure must stop the sequence without reboot.
  const program_stage_t failures[] = {PROGRAM_KEY, PROGRAM_ERASE, PROGRAM_WRITE, PROGRAM_VERIFY};
  for (unsigned i = 0; i < sizeof(failures) / sizeof(failures[0]); i++) {
    init(&p); writes = verifies = 0;
    while (p.stage != failures[i]) assert(exchange(&p, false, &writes, &verifies));
    size_t len = program_packet(&p, packet);
    assert(len);
    uint8_t bad[] = {packet[0], 0x9d, 2, 0, 0xff, 0};
    assert(!program_reply(&p, bad, sizeof(bad)));
    assert(program_packet(&p, packet) == 0 && !program_reboot_sent(&p));
  }

  // Reject unsupported identity/version and incomplete or misframed replies.
  uint8_t detect[] = {0xa1,0x9d,2,0,0x52,0x11};
  for (size_t n = 0; n < sizeof(detect); n++) {
    init(&p); assert(!program_reply(&p, detect, n));
  }
  init(&p); detect[4] = 0x54; assert(!program_reply(&p, detect, sizeof(detect)));
  detect[4] = 0x52;
  uint8_t changed[sizeof(info)];
  memcpy(changed, info, sizeof(info)); changed[20] = 4;
  init(&p); assert(program_reply(&p, detect, sizeof(detect)));
  assert(!program_reply(&p, changed, sizeof(changed)));
  assert(strcmp(p.error, "unsupported_bootloader_version") == 0);

  for (size_t n = 0; n < sizeof(info); n++) {
    init(&p); assert(program_reply(&p, detect, sizeof(detect)));
    assert(!program_reply(&p, info, n));
  }
  // Config/UID readback changes prohibit the reboot even after flash comparison.
  const unsigned changed_offsets[] = {6, 10, 14, 22, 25};
  for (unsigned i = 0; i < sizeof(changed_offsets) / sizeof(changed_offsets[0]); i++) {
    init(&p); writes = verifies = 0;
    while (p.stage != PROGRAM_FINAL_INFO) assert(exchange(&p, false, &writes, &verifies));
    memcpy(changed, info, sizeof(info)); changed[changed_offsets[i]] ^= 1;
    assert(!program_reply(&p, changed, sizeof(changed)));
    assert(!program_reboot_sent(&p));
  }
  puts("Standalone programmer tests passed: full flash model, verify mismatch, failure gates, identity/config checks");
}
