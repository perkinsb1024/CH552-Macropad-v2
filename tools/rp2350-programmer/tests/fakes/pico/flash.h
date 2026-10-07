#pragma once
#include <stdint.h>
int flash_safe_execute(void (*callback)(void *), void *arg, uint32_t timeout);
