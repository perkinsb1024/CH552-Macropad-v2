#ifndef MACROPAD_TEST_WS2812_H
#define MACROPAD_TEST_WS2812_H
#include <stdint.h>
void neopixel_show_P3_4(uint8_t *data, uint8_t length);
void set_pixel_for_GRB_LED(uint8_t *data, uint8_t index,
                           uint8_t green, uint8_t red, uint8_t blue);
#endif
