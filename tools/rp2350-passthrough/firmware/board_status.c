#include "board_status.h"
#include "pico/stdlib.h"
#include "hardware/pio.h"
#include "hardware/sync.h"
#include "hardware/structs/ioqspi.h"
#include "hardware/structs/sio.h"
#include "ws2812.pio.h"

// USB occupies PIO0 SM0/1/2 and DMA0. The RGB LED uses PIO1 SM0, no DMA.
void board_status_init(void) {
  pio_sm_claim(pio1, 0);
  uint offset = pio_add_program(pio1, &ws2812_program);
  ws2812_program_init(pio1, 0, offset, PICO_DEFAULT_WS2812_PIN, 800000, false);
}

void board_color(uint8_t red, uint8_t green, uint8_t blue) {
  // This board's LED uses RGB wire order (confirmed by the cyan/magenta trial).
  // Modest brightness keeps adapter consumption low.
  // Allow the preceding 30us packet to finish and latch, even for two immediate
  // state changes (e.g. blink update followed by BOOT arming).
  busy_wait_us_32(400);
  pio_sm_put_blocking(pio1, 0, ((uint32_t)red << 24) | ((uint32_t)green << 16) |
                     ((uint32_t)blue << 8));
}

// Adapted from Raspberry Pi pico-examples/picoboard/button/button.c.
// Copyright (c) 2020 Raspberry Pi (Trading) Ltd. SPDX-License-Identifier: BSD-3-Clause
bool __no_inline_not_in_flash_func(board_boot_pressed)(void) {
  uint32_t irq = save_and_disable_interrupts();
  uint32_t previous = ioqspi_hw->io[1].ctrl;
  hw_write_masked(&ioqspi_hw->io[1].ctrl,
    GPIO_OVERRIDE_LOW << IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_LSB,
    IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_BITS);
  for (volatile unsigned i = 0; i < 1000; i++) {}
  bool pressed = !(sio_hw->gpio_hi_in & SIO_GPIO_HI_IN_QSPI_CSN_BITS);
  ioqspi_hw->io[1].ctrl = previous;
  restore_interrupts(irq);
  return pressed;
}
