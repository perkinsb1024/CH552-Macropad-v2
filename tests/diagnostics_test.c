#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../src/diagnostics.h"
#include "../src/protocol_firmware.h"
#include "../src/storage.h"
#include "config_fixture.h"

uint8_t P1 = 255, P3 = 255;
uint8_t testP1ModOc, testP1DirPu, testP3ModOc, testP3DirPu, TMOD;
volatile uint8_t USB_CTRL, EA, UsbConfig;
static uint8_t heldAtStartup;
static uint32_t clockMs;
static jmp_buf trapJump;
static uint8_t flash[128], original[128], sent[32], packet[32];
static unsigned writes, handoffs, reports;
static int interruptAfter = -1, failAfter = -1;
static uint8_t failOffset = 255;
static uint8_t offsets[256], values[256];
extern uint8_t eventHead, eventTail, eventUsed, effectiveLayer, phase, macroNext;
extern uint8_t flashValid;

uint32_t millis(void) { return clockMs; }
void delayMicroseconds(uint16_t delay) {
  (void)delay;
  assert(EA == 0 && USB_CTRL == 0 && TMOD == 0);
  handoffs++;
  longjmp(trapJump, 1);
}
void neopixel_show_P3_4(uint8_t *data, uint8_t length) { (void)data; (void)length; }
void set_pixel_for_GRB_LED(uint8_t *data, uint8_t i, uint8_t r, uint8_t g, uint8_t b) {
  data[3*i] = g; data[3*i+1] = r; data[3*i+2] = b;
}
uint8_t eeprom_read_byte(uint8_t offset) { assert(offset < 128); return flash[offset]; }
void eeprom_write_byte(uint8_t offset, uint8_t value) {
  assert(offset < 128 && writes < 256);
  offsets[writes] = offset; values[writes] = value;
  if (offset == failOffset) failOffset = 255;
  else if (failAfter < 0 || writes < (unsigned)failAfter) flash[offset] = value;
  writes++;
  if (interruptAfter >= 0 && writes == (unsigned)interruptAfter) longjmp(trapJump, 2);
}
uint8_t USB_queueKeyboard(const uint8_t *keys) { (void)keys; reports++; return 1; }
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
  (void)buttons; (void)x; (void)y; (void)scroll; reports++; return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) { (void)usage; reports++; return 1; }
void USB_discardReports(void) { reports = 0; }
uint8_t USB_reportGeneration(void) { return 0; }
uint8_t USB_reportsPending(void) { return 0; }
uint8_t USB_asciiUsage(uint8_t c) { return c; }
void USB_reportPoll(uint16_t now) { (void)now; }
void USBInit(void) { UsbConfig = 1; }
void USB_EP1_receiveReady(void) {}
uint8_t USB_EP1_sendConfig(const uint8_t *reply) { memcpy(sent, reply, 32); return 1; }
void diagnosticSnapshotUsb(void) {
  stagedConfig[104] = UsbConfig;
  stagedConfig[105] = 0;
  stagedConfig[106] = stagedConfig[107] = stagedConfig[108] = stagedConfig[109] = 0;
}

#include <Arduino.h>
#undef P3_3
#define P3_3 (heldAtStartup ? 0 : ((P3 >> 3) & 1))
#include "../CH552_Universal_Macropad.ino"

static void resetHarness(void) {
  testLoadStarterProfile(PHYSICAL_VARIANT);
  memcpy(original, activeConfig, 128); memcpy(flash, original, 128);
  heldAtStartup = 0; P1 = P3 = 255; EA = 1; clockMs = 123456;
  writes = handoffs = reports = 0; interruptAfter = failAfter = -1; failOffset = 255;
  memset(packet, 0, 32);
  setup();
  assert(activeConfigValid && !diagnosticRecovery);
}

static void request(uint8_t opcode, uint8_t offset, uint8_t length, const uint8_t *data) {
  memset(packet, 0, 32);
  packet[0] = 3; packet[1] = 'U'; packet[2] = 'M'; packet[3] = 1;
  packet[4] = opcode; packet[6] = offset; packet[7] = length;
  if (data) memcpy(packet + 9, data, length);
  assert(protocolReceive(packet));
  protocolPoll(clockMs);
}

static void sendProfile(void) {
  uint8_t begin[3] = {128, original[6], original[7]};
  request(5, 0, 3, begin); assert(sent[8] == 0);
  for (uint8_t offset = 0; offset < 128;) {
    uint8_t length = 128 - offset > 23 ? 23 : 128 - offset;
    request(6, offset, length, original + offset); assert(sent[8] == 0);
    offset += length;
  }
  request(7, 0, 0, NULL);
}

static void verifyCapture(uint8_t reason, uint8_t site) {
  assert(handoffs == 1 && flash[0] == 0xD7 && flash[1] == 0x44 && flash[2] == 0x46 && flash[3] == 0xA6);
  assert(flash[4] == 0xA5 && flash[5] == 1 && flash[6] == PHYSICAL_VARIANT);
  assert(flash[10] == reason && flash[11] == site);
  assert(diagnosticCrc(flash) == ((uint16_t)flash[15] << 8 | flash[14]));
  unsigned captureStart = 0;
  while (captureStart < writes && (offsets[captureStart] != 0 || values[captureStart] != 0xD7)) captureStart++;
  assert(captureStart < writes);
  assert(offsets[writes - 1] == 4 && values[writes - 1] == 0xA5);
  for (uint8_t i = 0; i < NUM_LEDS; i++) assert(ledData[3*i] == 0 && ledData[3*i+1] == 255 && ledData[3*i+2] == 0);
}

static void captureBoot(void) {
  if (!setjmp(trapJump)) { enterBootloader(); assert(0); }
  verifyCapture(DIAG_BOOT_STARTUP, DIAG_SITE_BOOT_OTHER);
}

static void testRecovery(void) {
  uint8_t saved[128];
  resetHarness(); captureBoot(); memcpy(saved, flash, 128);
  writes = 0; EA = 1; setup();
  assert(!activeConfigValid && diagnosticRecovery);
  assert(ledSettings[0] == 0 && ledSettings[1] == 0);
  assert(ledData[1] == 255);
  clockMs += 500; loop(); assert(ledData[1] == 0);
  protocolReset(); protocolPoll(clockMs);
  assert(writes == 0 && memcmp(saved, flash, 128) == 0);
  request(3, 0, 23, NULL); assert(sent[8] == 0 && memcmp(sent + 9, flash, 23) == 0);
  request(0x72, 0, 0, NULL); assert(sent[8] == 2);
  heldAtStartup = 1;
  if (!setjmp(trapJump)) { EA = 1; setup(); assert(0); }
  assert(writes == 0 && memcmp(saved, flash, 128) == 0);
  heldAtStartup = 0; EA = 1; setup();
  sendProfile();
  assert(sent[8] == 0 && activeConfigValid && flashValid && !diagnosticRecovery);
  assert(memcmp(original, flash, 128) == 0);
  protocolReset(); protocolPoll(clockMs); loop();
  assert(activeConfigValid);
}

static void testTraps(void) {
  resetHarness(); flash[0] = 0;
  if (!setjmp(trapJump)) { setup(); assert(0); }
  verifyCapture(DIAG_INVALID_CONFIG, DIAG_SITE_STARTUP);
  assert(flash[32] == 0);
  resetHarness(); heldAtStartup = 1;
  if (!setjmp(trapJump)) { setup(); assert(0); }
  verifyCapture(DIAG_BOOT_STARTUP, DIAG_SITE_BOOT_STARTUP);
  resetHarness(); activeConfigValid = 0;
  if (!setjmp(trapJump)) { loop(); assert(0); }
  verifyCapture(DIAG_INVALID_ACTIVE, DIAG_SITE_LOOP);
  resetHarness(); activeConfigValid = 0;
  if (!setjmp(trapJump)) { firmwareApplyConfig(); assert(0); }
  verifyCapture(DIAG_INVALID_ACTIVE, DIAG_SITE_APPLY);
  resetHarness();
  stableState[NUM_LEDS] = rawState[NUM_LEDS] = 1;
  P3 &= ~8; allowRunBootloader = 1; encoderPressedMs = (uint16_t)clockMs - 3000;
  if (!setjmp(trapJump)) { loop(); assert(0); }
  verifyCapture(DIAG_BOOT_HOLD, DIAG_SITE_BOOT_HOLD);
  assert(flash[12] == (3000 & 255) && flash[13] == (3000 >> 8));
  resetHarness(); eventHead = 8;
  if (!setjmp(trapJump)) { loop(); assert(0); }
  verifyCapture(DIAG_ACTION_QUEUE, DIAG_SITE_ACTION_POLL);
#if !DIAGNOSTIC_REDUCED
  resetHarness(); phase = 4;
  if (!setjmp(trapJump)) { loop(); assert(0); }
  verifyCapture(DIAG_MACRO, DIAG_SITE_ACTION_POLL);
#endif
  resetHarness(); effectiveLayer = 7;
  if (!setjmp(trapJump)) { loop(); assert(0); }
  verifyCapture(DIAG_LAYER, DIAG_SITE_ACTION_POLL);
}

static void testInterruptedCapture(void) {
  // Interrupt after every actual byte write, then verify startup never retries
  // or overwrites the record once its reservation byte persisted.
  resetHarness(); captureBoot(); unsigned total = writes;
  for (unsigned stop = 1; stop <= total; stop++) {
    uint8_t saved[128];
    resetHarness(); interruptAfter = stop;
    if (!setjmp(trapJump)) { enterBootloader(); assert(0); }
    assert(flash[0] == 0xD7);
    memcpy(saved, flash, 128); interruptAfter = -1; writes = 0;
    EA = 1; setup(); loop();
    assert(diagnosticRecovery && !activeConfigValid && writes == 0);
    assert(memcmp(saved, flash, 128) == 0);
  }
  resetHarness(); failAfter = 0;
  if (!setjmp(trapJump)) { enterBootloader(); assert(0); }
  assert(handoffs == 1 && writes == 1 && flash[0] == 'M');
  resetHarness(); failAfter = 2;
  if (!setjmp(trapJump)) { enterBootloader(); assert(0); }
  assert(handoffs == 1 && flash[0] == 0xD7 && flash[4] == 0 && writes <= 4);
}

static void testSaveFailure(void) {
  resetHarness(); captureBoot(); writes = 0; EA = 1; setup(); failAfter = 0;
  if (!setjmp(trapJump)) { sendProfile(); assert(0); }
  // Failed replacement never destroys an existing reservation record.
  assert(flash[0] == 0xD7 && writes == 1);
  resetHarness(); original[9] ^= 0x10;
  uint16_t crc = configCrc(original); original[6] = crc; original[7] = crc >> 8;
  failAfter = 0;
  if (!setjmp(trapJump)) { sendProfile(); assert(0); }
  assert(handoffs == 1 && writes == 2); // Save failed, then marker write failed.
  resetHarness(); original[9] ^= 0x10;
  crc = configCrc(original); original[6] = crc; original[7] = crc >> 8;
  failOffset = 9;
  if (!setjmp(trapJump)) { sendProfile(); assert(0); }
  verifyCapture(DIAG_SAVE, DIAG_SITE_SAVE);
  assert(flash[12] == 9 && flash[13] == original[9]);
#if DIAGNOSTIC_REDUCED
  assert(flash[43] == activeConfig[9]);
#else
  assert(flash[120] == activeConfig[9] && flash[121] == original[9]);
#endif
}

static void testDisabledTimersAndEmptyMacro(void) {
  resetHarness();
  activeConfig[3] |= 0x40;
  assert(!configValid(activeConfig, PHYSICAL_VARIANT));
  resetHarness();
#if CONFIG_MACRO_REPEAT
  extern uint8_t macroStart, macroRepeat;
  macroNext = macroStart = 127; macroRepeat = 3;
  for (uint8_t i = 0; i < 5; i++) actionsPoll(clockMs);
  assert(macroNext == 0 && writes == 0 && handoffs == 0);
#endif
}

int main(int argc, char **argv) {
  testRecovery(); testTraps(); testInterruptedCapture(); testSaveFailure();
  testDisabledTimersAndEmptyMacro();
  resetHarness(); captureBoot();
  if (argc > 1) {
    FILE *output = fopen(argv[1], "wb"); assert(output);
    assert(fwrite(flash, 1, 128, output) == 128); fclose(output);
  }
  return 0;
}
