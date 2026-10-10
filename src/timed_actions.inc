// Included inside actions.c: shares the existing dispatcher and timer state.
// Byte 0 has the low eight interval-1 bits. Byte 5 has the high three
// interval bits in bits 3-5 and scope 0/global or 1-7/layer+1 in bits 0-2,
// consume in bit 6 and restart-on-input in bit 7. Pending input actions survive
// layer transitions and are serviced even outside their timer's assigned layer.
__idata uint8_t timedPending[CONFIG_TIMED_MAX];

void actionsTimedReset(uint8_t tick) {
  timedClock = tick;
  for (uint8_t i = 0; i < CONFIG_TIMED_MAX; i++) {
    timedAge[i] = 0;
    timedHigh[i] = 0;
    timedFraction[i] = 0;
    timedPending[i] = 0;
  }
}

static ACTION_BIT timedEvent(uint8_t tick) {
  uint8_t offset = configTimedOffset();
  uint8_t count = configTimedCount();
  ACTION_BIT consume = 0;
  for (uint8_t i = 0; i < count; i++, offset += CONFIG_TIMED_SIZE) {
    uint8_t age = timedAge[i];
    uint8_t action = 0;
    uint8_t flags = activeConfig[offset + 5];
    if (tick) {
      if ((flags & 7) && (flags & 7) != (uint8_t)(effectiveLayer + 1)) continue;
      // Each carry of the 16 ms fine clock advances age by 4.096 seconds.
      timedFraction[i] += tick;
      if (timedFraction[i] >= tick) continue;
      if (age == activeConfig[offset] && timedHigh[i] == (flags & 56)) {
        age = 0;
        timedHigh[i] = 0;
        timedPending[i] = 1;
        action = 1;
      } else if (!++age) timedHigh[i] += 8;
    } else {
      if (timedPending[i]) {
        action = 3;
        if (flags & CONFIG_TIMED_CONSUME) consume = 1;
      }
      timedPending[i] = 0;
      if (CONFIG_TIMED_ALL_RESET || (flags & 128)) {
        age = 0;
        timedHigh[i] = 0;
        timedFraction[i] = 0;
      }
    }
    timedAge[i] = age;
    if (action) {
      action += offset;
      runAction(activeConfig[action], activeConfig[action + 1], 0, 9 + i);
      updateLayer();
    }
  }
  return consume;
}

void actionsTimedPoll(uint8_t tick) {
  uint8_t elapsed = tick - timedClock;
  timedClock = tick;
  if (elapsed) timedEvent(elapsed);
}

ACTION_BIT actionsTimedInput(void) {
#if CONFIG_SCROLL_ACCELERATION
  ACTION_BIT consumed = timedEvent(0);
  if (consumed) scrollFirst = 0;
  return consumed;
#else
  return timedEvent(0);
#endif
}

static void resetLayerTimers(void) {
  uint8_t offset = configTimedOffset();
  uint8_t count = configTimedCount();
  for (uint8_t i = 0; i < count; i++, offset += CONFIG_TIMED_SIZE) {
    uint8_t scope = activeConfig[offset + 5] & 7;
    if (scope) {
      timedAge[i] = 0;
      timedHigh[i] = 0;
      timedFraction[i] = 0;
    }
  }
}
