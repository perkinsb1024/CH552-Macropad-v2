// Included inside actions.c: shares the existing dispatcher and timer state.
// Byte 0 has the low eight interval-1 bits. Byte 5 has the high three
// interval bits in bits 3-5 and scope 0/global or 1-7/layer+1 in bits 0-2,
// consume in bit 6 and restart-on-input in bit 7. Pending input actions survive
// layer transitions and are serviced even outside their timer's assigned layer.

// The last runtime slot uses a synthesized record after the saved image.
// User timers retain their original order and all four configuration slots.
// Bit 0 of timedHigh latches the pending next-input action; bits 3-5 are age.
// Low interval-1 byte and pre-positioned high bits for 220/440/879/1758 ticks.
static const __code uint8_t sleepLow[] = {219, 183, 110, 221};
static const __code uint8_t sleepHigh[] = {0, 8, 24, 48};

void actionsTimedReset(uint8_t tick) {
  uint8_t settings = activeConfig[CONFIG_HEADER_SLEEP];
  uint8_t timeout = settings & CONFIG_SLEEP_TIMEOUT_MASK;
  timedClock = tick;
  activeConfig[CONFIG_SIZE + 0] = sleepLow[timeout];
  activeConfig[CONFIG_SIZE + 1] = (settings & CONFIG_SLEEP_DIM) ? 0x2D : 0x4D;
  activeConfig[CONFIG_SIZE + 2] = CONFIG_LED_PRESET_SET;
  activeConfig[CONFIG_SIZE + 3] = CONFIG_ACTION_LED_CONTROL;
  activeConfig[CONFIG_SIZE + 4] = CONFIG_LED_PRESET_SET;
  activeConfig[CONFIG_SIZE + 5] = 128 | sleepHigh[timeout] | ((settings & CONFIG_SLEEP_CONSUME) << 4);
  for (uint8_t i = 0; i <= CONFIG_TIMED_MAX; i++) {
    timedAge[i] = 0;
    timedHigh[i] = 0;
    timedFraction[i] = 0;
  }
}

static ACTION_BIT timedEvent(uint8_t tick) {
  uint8_t offset = configTimedOffset();
  uint8_t count = configTimedCount();
  ACTION_BIT consume = 0;
  for (uint8_t i = 0; i <= count; i++, offset += CONFIG_TIMED_SIZE) {
    if (i == count) {
      offset = CONFIG_SIZE;
      if (tick && !(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) continue;
    }
    uint8_t age = timedAge[i];
    uint8_t action = 0;
    uint8_t flags = activeConfig[(uint8_t)(offset + 5)];
    if (tick) {
      if ((flags & 7) && (uint8_t)((flags & 7) - 1) != effectiveLayer) continue;
      // Each carry of the 16 ms fine clock advances age by 4.096 seconds.
      timedFraction[i] += tick;
      if (timedFraction[i] >= tick) continue;
      if (age == activeConfig[offset] && (timedHigh[i] & 56) == (flags & 56)) {
        age = 0;
        timedHigh[i] = 1;
        action = 1;
      } else if (!++age) timedHigh[i] += 8;
    } else {
      if (timedHigh[i] & 1) {
        action = 3;
        if (flags & CONFIG_TIMED_CONSUME) consume = 1;
        // Reuse the normal indication without changing or consuming the layer.
        if (i == count && (activeConfig[CONFIG_HEADER_SLEEP] & CONFIG_SLEEP_INDICATOR))
          layerSelectionPending = 1;
      }
      timedHigh[i] &= ~1;
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
  // Point directly at each user timer's scope byte (inside the saved image).
  uint8_t offset = configTimedOffset() + 5;
  uint8_t count = configTimedCount();
  for (uint8_t i = 0; i <= count; i++, offset += CONFIG_TIMED_SIZE) {
    if (i == count) {
      // Enabled layers preserve sleep time and any pending physical wake.
      if (configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP) return;
    } else if (!(activeConfig[offset] & 7)) continue;
    timedAge[i] = 0;
    timedHigh[i] &= 1;
    timedFraction[i] = 0;
  }
  // The shared reset retained only the pending bit; clear it before restoring
  // lighting so this transition cannot consume the next physical input.
  if (timedHigh[count]) {
    timedHigh[count] = 0;
    firmwareLedAction(CONFIG_LED_PRESET_SET, 0);
  }
}
