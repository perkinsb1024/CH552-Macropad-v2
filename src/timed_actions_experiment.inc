// Included inside actions.c: shares the existing dispatcher and timer state.
// Byte 0 is interval-1. Byte 5 has scope 0/global or 1-7/layer+1 in bits 0-2,
// consume in bit 6 and restart-on-input in bit 7. Pending input actions survive
// layer transitions and are serviced even outside their timer's assigned layer.
__idata uint8_t timedPending[CONFIG_TIMED_MAX];

void actionsTimedReset(uint8_t tick) {
  timedClock = tick;
  for (uint8_t i = 0; i < CONFIG_TIMED_MAX; i++) {
    timedAge[i] = 0;
    timedFraction[i] = 0;
    timedPending[i] = 0;
  }
}

static ACTION_BIT timedEvent(__idata uint8_t tick) {
  __pdata uint8_t offset = configTimedOffset();
  ACTION_BIT consume = 0;
  for (__idata uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {
    __idata uint8_t age = timedAge[i];
    uint8_t action = 0;
    __idata uint8_t scope = activeConfig[offset + 5] & 7;
    if (tick && scope && scope != (uint8_t)(effectiveLayer + 1)) continue;
    if (tick) {
      // Each carry of the 128 ms fine clock advances age by 32.768 seconds.
      timedFraction[i] += tick;
      if (timedFraction[i] >= tick) continue;
      timedWork = activeConfig[offset];
      if (age == timedWork) {
        age = 0;
        timedPending[i] = 1;
        action = 1;
      } else age++;
    } else {
      if (timedPending[i]) {
        action = 3;
        if (activeConfig[offset + 5] & CONFIG_TIMED_CONSUME) consume = 1;
      }
      timedPending[i] = 0;
      if (CONFIG_TIMED_ALL_RESET || (activeConfig[offset + 5] & 128)) {
        age = 0;
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
  __idata uint8_t offset = configTimedOffset();
  for (__idata uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {
    __idata uint8_t scope = activeConfig[offset + 5] & 7;
    if (scope) {
      timedAge[i] = 0;
      timedFraction[i] = 0;
    }
  }
}
