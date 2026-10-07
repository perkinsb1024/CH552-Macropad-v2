#pragma once
#include <stdbool.h>
#include <stdint.h>
void board_status_init(void);
void board_color(uint8_t red, uint8_t green, uint8_t blue);
// Sample only before PIO USB starts. No other core or XIP DMA is running.
bool board_boot_pressed(void);
