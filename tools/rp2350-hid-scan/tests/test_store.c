#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "store.h"

static uint8_t flash[2 * STORE_SLOT], original[2 * STORE_SLOT], first[STORE_DISK], second[STORE_DISK], restored[STORE_DISK];
static unsigned calls, fail_at;
static bool write_flash(unsigned pos, const uint8_t *data, size_t len) {
  assert(pos + len <= sizeof(flash));
  if (calls++ == fail_at) return false;
  if (!data) { assert(!(pos % 4096) && len == 4096); memset(flash + pos,0xff,len); }
  else {
    assert(!(pos % 256) && len == 256);
    for (size_t i = 0; i < len; i++) { assert((flash[pos+i] & data[i]) == data[i]); flash[pos+i] &= data[i]; }
  }
  return true;
}
int main(void) {
  store_t store;
  memset(flash,0xff,sizeof(flash));
  for (unsigned i = 0; i < STORE_DISK; i++) { first[i] = i * 3; second[i] = i * 7; }
  first[510] = second[510] = 0x55; first[511] = second[511] = 0xaa;
  assert(!store_load(&store,flash,restored));
  fail_at = UINT32_MAX; calls = 0; assert(store_save(&store,first,write_flash));
  assert(store_load(&store,flash,restored) && !memcmp(first,restored,STORE_DISK));
  memcpy(original,flash,sizeof(flash));
  // Interrupt every individual erase/program/commit operation in the next save.
  for (unsigned stop = 0; stop < 274; stop++) {
    memcpy(flash,original,sizeof(flash)); assert(store_load(&store,flash,restored));
    calls = 0; fail_at = stop;
    bool saved = store_save(&store,second,write_flash);
    assert(store_load(&store,flash,restored));
    assert(!memcmp(saved ? second : first,restored,STORE_DISK));
  }
  memcpy(flash,original,sizeof(flash)); assert(store_load(&store,flash,restored));
  calls = 0; fail_at = UINT32_MAX; assert(store_save(&store,second,write_flash));
  assert(store_load(&store,flash,restored) && !memcmp(second,restored,STORE_DISK));
  flash[STORE_SLOT + 4096 + 40] ^= 1;
  assert(store_load(&store,flash,restored) && !memcmp(first,restored,STORE_DISK));
  flash[8] ^= 1; assert(!store_load(&store,flash,restored));
  puts("Flash save/restore checks passed: all interrupted operations, CRC corruption and prior-snapshot recovery");
}
