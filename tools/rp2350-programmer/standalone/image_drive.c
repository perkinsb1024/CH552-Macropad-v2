#include "image_drive.h"
#include <string.h>

static uint16_t le16(const uint8_t *p) { return p[0] | (uint16_t)p[1] << 8; }
static uint32_t le32(const uint8_t *p) { return le16(p) | (uint32_t)le16(p + 2) << 16; }
static void put16(uint8_t *p, unsigned n) { p[0] = n; p[1] = n >> 8; }
void image_drive_format(uint8_t *d) {
  memset(d, 0, DRIVE_BYTES);
  d[0] = 0xeb; d[1] = 0x3c; d[2] = 0x90;
  memcpy(d + 3, "MACROPAD", 8);
  put16(d + 11, DRIVE_SECTOR); d[13] = 1; put16(d + 14, 1); d[16] = 2;
  put16(d + 17, 128); put16(d + 19, DRIVE_SECTORS); d[21] = 0xf8;
  put16(d + 22, DRIVE_FAT_SECTORS); put16(d + 24, 1); put16(d + 26, 1);
  d[38] = 0x29; memcpy(d + 39, "UMAC", 4);
  memcpy(d + 43, "MACROPAD   ", 11); memcpy(d + 54, "FAT12   ", 8);
  d[510] = 0x55; d[511] = 0xaa;
  for (unsigned i = 1; i <= 3; i += 2) { d[i * 512] = 0xf8; d[i * 512 + 1] = 255; d[i * 512 + 2] = 255; }
  memcpy(d + DRIVE_ROOT * 512, "MACROPAD   ", 11); d[DRIVE_ROOT * 512 + 11] = 8;
}
static unsigned next_cluster(const uint8_t *fat, unsigned c) {
  unsigned offset = c + c / 2;
  unsigned n = le16(fat + offset);
  return c & 1 ? n >> 4 : n & 0xfff;
}
static int nibble(uint8_t c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}
static bool space(uint8_t c) { return c == ' ' || c == '\t' || c == '\r'; }
image_result_t image_drive_load(const uint8_t *d, uint8_t image[PROGRAM_LIMIT], image_info_t *info) {
  // Fixed geometry keeps all directory, FAT and file accesses bounded, including corrupt disks.
  static uint8_t occupied[PROGRAM_LIMIT];
  uint16_t chain[DRIVE_SECTORS - DRIVE_DATA];
  uint8_t seen[(DRIVE_SECTORS - DRIVE_DATA + 9) / 8] = {0};
  uint8_t record[260];
  memset(info, 0, sizeof(*info));
#define BAD(reason) do { info->error = reason; return IMAGE_INVALID; } while (0)
  if (le16(d + 11) != 512 || d[13] != 1 || le16(d + 14) != 1 || d[16] != 2 ||
      le16(d + 17) != 128 || le16(d + 19) != DRIVE_SECTORS || le16(d + 22) != 2 ||
      le32(d + 32) != 0 || d[510] != 0x55 || d[511] != 0xaa)
    BAD("unsupported_disk_format");
  const uint8_t *entry = NULL;
  bool apple_double = false;
  for (unsigned i = 0; i < 128; i++) {
    const uint8_t *e = d + DRIVE_ROOT * 512 + i * 32;
    if (!e[0]) break;
    if (e[0] == 0xe5) { apple_double = false; continue; }
    // The nearest LFN entry holds the start of the filename. AppleDouble files
    // begin with "._"; ordinary visible names beginning with '_' remain usable.
    if (e[11] == 0x0f) {
      if ((e[0] & 0x1f) == 1) apple_double = le16(e + 1) == '.' && le16(e + 3) == '_';
      continue;
    }
    bool metadata = apple_double; apple_double = false;
    if (metadata || e[0] == '.' || (e[11] & 0x1e)) continue;
    if ((e[8] | 32) != 'h' || (e[9] | 32) != 'e' || (e[10] | 32) != 'x') continue;
    if (entry) BAD("multiple_hex_files");
    entry = e;
  }
  if (!entry) { info->error = "no_hex_file"; return IMAGE_MISSING; }
  unsigned name_len = 0;
  for (unsigned i = 0; i < 8 && entry[i] != ' '; i++) { uint8_t ch = entry[i]; info->name[name_len++] = ch >= 32 && ch < 127 && ch != '"' && ch != '\\' ? ch : '_'; }
  info->name[name_len++] = '.';
  memcpy(info->name + name_len, entry + 8, 3);
  uint32_t size = le32(entry + 28);
  if (!size || size > (DRIVE_SECTORS - DRIVE_DATA) * 512) BAD("invalid_file_size");
  unsigned count = (size + 511) / 512, c = le16(entry + 26);
  if (le16(entry + 20)) BAD("invalid_cluster");
  for (unsigned i = 0; i < count; i++) {
    if (c < 2 || c >= DRIVE_SECTORS - DRIVE_DATA + 2 || (seen[c / 8] & (1u << (c % 8))))
      BAD("invalid_file_chain");
    seen[c / 8] |= 1u << (c % 8); chain[i] = c;
    unsigned next = next_cluster(d + 512, c);
    if (next != next_cluster(d + 3 * 512, c)) BAD("incomplete_fat_update");
    c = next;
  }
  if (c < 0xff8) BAD("incomplete_file_chain");
  memset(image, 255, PROGRAM_LIMIT); memset(occupied, 0, sizeof(occupied));
  uint32_t high = 0;
  bool eof = false, any = false;
  // Consume lines directly from the FAT chain; no assumption about sector/write ordering.
  for (uint32_t pos = 0; pos < size;) {
    unsigned digits = 0, sum = 0; bool colon = false, trailing = false;
    while (pos < size) {
      uint8_t ch = d[(DRIVE_DATA + chain[pos / 512] - 2) * 512 + pos % 512]; pos++;
      if (ch == '\n') break;
      if (space(ch)) { if (colon) trailing = true; continue; }
      if (!colon) { if (ch != ':' || eof) BAD("invalid_hex_record"); colon = true; continue; }
      if (trailing || digits >= sizeof(record) * 2 || nibble(ch) < 0) BAD("invalid_hex_record");
      if (!(digits & 1)) record[digits / 2] = nibble(ch) << 4;
      else { record[digits / 2] |= nibble(ch); sum += record[digits / 2]; }
      digits++;
    }
    if (!colon) continue;
    if ((digits & 1) || digits < 10 || digits / 2 != (unsigned)record[0] + 5 || (sum & 255))
      BAD("hex_length_or_checksum");
    unsigned n = record[0], address = (unsigned)record[1] << 8 | record[2], type = record[3];
    if (type == 0) {
      uint32_t start = high + address;
      if (start > PROGRAM_LIMIT || n > PROGRAM_LIMIT - start) BAD("outside_application_flash");
      for (unsigned i = 0; i < n; i++) {
        if (occupied[start + i]) BAD("overlapping_hex_records");
        occupied[start + i] = 1; image[start + i] = record[4 + i]; any = true;
      }
    } else if (type == 1) {
      if (n || address) BAD("invalid_hex_eof");
      eof = true;
    } else if (type == 2 || type == 4) {
      if (n != 2 || address) BAD("invalid_hex_extension");
      high = ((uint32_t)record[4] << 8 | record[5]) << (type == 2 ? 4 : 16);
    } else if (type == 3 || type == 5) {
      if (n != 4 || address) BAD("invalid_hex_entry");
    } else BAD("unsupported_hex_record");
  }
  if (!eof || !any || !occupied[0]) BAD("missing_eof_or_reset_vector");
  unsigned identities = 0;
  for (unsigned i = 0; i + 6 < PROGRAM_LIMIT; i++) {
    if (!memcmp(image + i, "UMAC\x01", 5) && image[i + 6] <= 1) {
      identities++; info->format = image[i + 5]; info->keys = image[i + 6] ? 3 : 6;
    }
  }
  if (identities != 1) BAD("invalid_macropad_identity");
  info->error = "";
  return IMAGE_VALID;
#undef BAD
}
