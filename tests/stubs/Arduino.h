#ifndef MACROPAD_TEST_ARDUINO_H
#define MACROPAD_TEST_ARDUINO_H
#include <stdint.h>
extern uint8_t P1;
extern uint8_t P3;
#define P1_MOD_OC testP1ModOc
#define P1_DIR_PU testP1DirPu
#define P3_MOD_OC testP3ModOc
#define P3_DIR_PU testP3DirPu
extern uint8_t testP1ModOc;
extern uint8_t testP1DirPu;
extern uint8_t testP3ModOc;
extern uint8_t testP3DirPu;
#define P3_0 ((P3 >> 0) & 1)
#define P3_1 ((P3 >> 1) & 1)
#define P3_2 ((P3 >> 2) & 1)
#define P3_3 ((P3 >> 3) & 1)
extern volatile uint8_t USB_CTRL;
extern uint8_t TMOD;
extern volatile uint8_t EA;
uint32_t millis(void);
void delayMicroseconds(uint16_t us);
#endif
