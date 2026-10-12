#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef uint32_t absolute_time_t;
#define GPIO_IN 0
absolute_time_t get_absolute_time(void);
uint32_t to_ms_since_boot(absolute_time_t t);
void tight_loop_contents(void);
void gpio_init(unsigned pin);
void gpio_disable_pulls(unsigned pin);
void gpio_set_dir(unsigned pin, bool out);
bool gpio_get(unsigned pin);
void panic(const char *msg);

typedef struct { unsigned token; } repeating_timer_t;
bool add_repeating_timer_us(int64_t delay, bool (*cb)(repeating_timer_t *), void *arg, repeating_timer_t *timer);
bool cancel_repeating_timer(repeating_timer_t *timer);
