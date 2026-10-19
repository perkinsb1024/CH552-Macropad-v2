import { keyCount, LayerIndicatorBehavior } from '../../model/constants';
import { layerIndicatorBackground, RAINBOW_GRADIENT } from '../../model/layerPalette';
import { paletteHex } from '../../model/palette';
import { actionTooltip, summarize } from '../../model/actions';
import { matchesChord } from '../../model/chords';
import type { Slot } from '../../model/types';
import { actionProblem } from '../../model/validate';
import { connection, liveActivity, liveClock, liveRuntime, canInsertSlot, canSwapSlots, draggedSlot, insertSlotAction, profile, selectedLayer, selectedSlot, slotDrop, swapSlotActions, type DropPosition } from '../store';
import { dropPosition, endShortcutDrag, setRoundedDragImage, shortcutDragOver, shortcutDrop } from '../drag';
import { IconRotate } from './Icons';
import { ActionLabel } from './ActionLabel';
import { liveLighting, restartBriefRainbowAnimation, setLiveDeviceHovered } from '../liveLighting';

function sameSlot(a: Slot | null, b: Slot): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

export function DeviceView({ readOnly = false }: { readOnly?: boolean } = {}) {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const indicatorOn = layer.indicatorBehavior !== LayerIndicatorBehavior.None;
  const indicatorColor = layerIndicatorBackground(layer);
  const lighting = readOnly ? liveLighting.value : null;
  const keys = keyCount(p.variant);
  const layerCount = p.layers.length;
  const chordKeys = new Set<number>();
  for (const c of p.chords) if (c.global || c.layer === li) { chordKeys.add(c.keyA); chordKeys.add(c.keyB); }
  const selection = readOnly ? null : selectedSlot.value;
  const c = connection.value;
  const activity = readOnly ? liveActivity.value : null;
  const runtime = readOnly ? liveRuntime.value : null;
  const asleep = runtime && c.kind === 'connected' && c.connection.status.live && c.connection.status.flashValid &&
    liveClock.value - runtime.receivedAt < 1000 && liveClock.value - runtime.timersReceivedAt < 1000 &&
    !!(runtime.timers.high[p.timedActions?.length ?? 0]! & 1);
  const fresh = activity && liveClock.value - activity.receivedAt < 1000 && c.kind === 'connected' && c.connection.status.flashValid && c.connection.status.currentLayer === li;
  const pressed = (index: number) => !!fresh && !!(activity!.sample.pressed & (1 << index));
  const fired = (index: number) => !!fresh && activity!.sample.bindingLayer === li && activity!.hotUntil[index]! > liveClock.value;
  const triggerClass = (index: number) => !fired(index) ? '' : `is-live-fired ${activity!.triggerKinds?.[index] === 'hold' ? 'is-live-hold' : activity!.triggerKinds?.[index] === 'unknown' ? 'is-live-unknown' : ''}`;
  const turned = (index: number) => !!fresh && index >= 7 && activity!.turnUntil[index - 7]! > liveClock.value;

  const selectedChord = selection?.kind === 'chord'
    ? p.chords.find((c) => matchesChord(c, selection) && (c.global || c.layer === li))
    : undefined;

  const select = (slot: Slot) => { selectedSlot.value = sameSlot(selection, slot) ? null : slot; };
  const dragStart = (event: DragEvent, slot: Slot) => {
    setRoundedDragImage(event);
    endShortcutDrag();
    draggedSlot.value = slot;
    event.dataTransfer?.setData('application/x-macropad-slot', 'move');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };
  const dragEnd = () => { draggedSlot.value = null; slotDrop.value = null; };
  const valid = (source: Slot, target: Slot, position: DropPosition) => position === 'swap'
    ? canSwapSlots(source, target)
    : canInsertSlot(source, target, position);
  const bindingPosition = (event: DragEvent, target: Slot, orientation: 'horizontal' | 'vertical'): DropPosition => {
    const source = draggedSlot.value;
    if (source?.branch || source?.kind === 'timed' || target.kind !== 'key') return 'swap';
    return dropPosition(event, orientation);
  };
  const insertionTarget = (slot: Slot, position: 'before' | 'after'): { slot: Slot; position: 'before' | 'after' } => {
    // Both sides of an internal key gap share the preceding key's after target.
    // Row starts stay separate so before key 4 and after key 3 remain available.
    if (slot.kind === 'key' && position === 'before' && slot.index % 3 !== 0) {
      return { slot: { ...slot, index: slot.index - 1 }, position: 'after' };
    }
    return { slot, position };
  };
  const drop = (event: DragEvent, target: Slot, orientation: 'horizontal' | 'vertical') => {
    if (shortcutDrop(event, target)) return;
    event.preventDefault();
    const source = draggedSlot.value;
    const position = slotDrop.value && sameSlot(slotDrop.value.slot, target)
      ? slotDrop.value.position : bindingPosition(event, target, orientation);
    const destination = position === 'swap' ? { slot: target, position } : insertionTarget(target, position);
    if (source && valid(source, destination.slot, destination.position)) {
      if (destination.position === 'swap') swapSlotActions(source, destination.slot);
      else insertSlotAction(source, destination.slot, destination.position);
    }
    dragEnd();
  };
  const dragOver = (event: DragEvent, target: Slot, orientation: 'horizontal' | 'vertical') => {
    if (shortcutDragOver(event, target)) return;
    const source = draggedSlot.value;
    const position = bindingPosition(event, target, orientation);
    const destination = position === 'swap' ? { slot: target, position } : insertionTarget(target, position);
    if (!source || !valid(source, destination.slot, destination.position)) {
      slotDrop.value = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    if (!slotDrop.value || !sameSlot(slotDrop.value.slot, destination.slot) || slotDrop.value.position !== destination.position) slotDrop.value = destination;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };
  const gridGapTarget = (event: DragEvent): { slot: Slot; position: 'before' | 'after' } | null => {
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.keycap'));
    if (buttons.length === 6) {
      const topRow = buttons[0]!.getBoundingClientRect();
      const bottomRow = buttons[3]!.getBoundingClientRect();
      // Insertion follows the side edges of each row, not the horizontal gap.
      if (event.clientY >= topRow.bottom && event.clientY <= bottomRow.top) return null;
    }
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const x = position === 'before' ? rect.left : rect.right;
        const y = Math.max(rect.top, Math.min(event.clientY, rect.bottom));
        const distance = Math.hypot(event.clientX - x, event.clientY - y);
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    if (!closest) return null;
    const { index, position } = closest as { index: number; position: 'before' | 'after' };
    return insertionTarget({ kind: 'key', layer: li, index }, position);
  };
  const gridDragOver = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.keycap')) return;
    const source = draggedSlot.value;
    const target = gridGapTarget(event);
    if (source && target && canInsertSlot(source, target.slot, target.position)) {
      event.preventDefault();
      if (!slotDrop.value || !sameSlot(slotDrop.value.slot, target.slot) || slotDrop.value.position !== target.position) slotDrop.value = target;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else {
      slotDrop.value = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }
  };
  const gridDrop = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.keycap')) return;
    event.preventDefault();
    const source = draggedSlot.value;
    const target = gridGapTarget(event);
    if (source && target) insertSlotAction(source, target.slot, target.position);
    dragEnd();
  };
  // Render helpers keep button identity stable across selection updates. Defining
  // component types inside DeviceView remounts them on every render, losing focus.
  const renderKeyCap = (index: number) => {
    const slot: Slot = { kind: 'key', layer: li, index };
    const action = layer.keys[index]!;
    const problem = actionProblem(action, { layerCount, rotation: false });
    const color = lighting ? lighting.displayColors[index]! : paletteHex(layer.leds[index]!);
    const off = readOnly ? color === '#000000' : layer.leds[index] === 0;
    const rainbow = !readOnly && layer.leds[index] === 15;
    const dragged = readOnly ? null : draggedSlot.value;
    const invalidDrop = !!dragged && !canSwapSlots(dragged, slot) && !canInsertSlot(dragged, slot, 'before') && !canInsertSlot(dragged, slot, 'after');
    const intent = !readOnly && slotDrop.value && sameSlot(slotDrop.value.slot, slot) ? slotDrop.value.position : null;
    return (
      <button
        key={index}
        title={actionTooltip(action)}
        data-clipboard-target={!readOnly || undefined} data-slot={readOnly ? undefined : JSON.stringify(slot)}
        class={`keycap ${pressed(index) ? 'is-live-pressed' : ''} ${triggerClass(index)} ${rainbow ? 'keycap-rainbow' : ''} ${sameSlot(selection, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''} ${sameSlot(dragged, slot) ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''} ${intent === 'before' ? 'drop-before' : ''} ${intent === 'after' ? 'drop-after' : ''} ${invalidDrop ? 'drag-invalid' : ''}`}
        style={`--led:${color}; --led-strip:${rainbow ? RAINBOW_GRADIENT : `linear-gradient(${color}, ${color})`}; --led-glow:${off ? 'transparent' : rainbow ? '#8000ff' : color}`}
        onClick={readOnly ? restartBriefRainbowAnimation : () => select(slot)}
        draggable={!readOnly}
        onDragStart={readOnly ? undefined : (event) => dragStart(event, slot)}
        onDragEnd={readOnly ? undefined : dragEnd}
        onDragOver={readOnly ? undefined : (event) => dragOver(event, slot, 'horizontal')}
        onDrop={readOnly ? undefined : (event) => drop(event, slot, 'horizontal')}
        aria-label={`Key ${index + 1}: ${summarize(action)}`}
      >
        <span class="keycap-led" aria-hidden="true" />
        <span class="keycap-index">{index + 1}</span>
        <span class="keycap-label"><ActionLabel action={action} showTooltip={false} compact /></span>
        {chordKeys.has(index) && <span class={`keycap-chord ${selectedChord && (selectedChord.keyA === index || selectedChord.keyB === index) ? 'is-selected' : ''}`} title="Part of a chord on this layer">chord</span>}
        {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
      </button>
    );
  };

  const renderEncoderPart = ({ slot, label, icon }: { slot: Slot; label: string; icon?: preact.ComponentChildren }) => {
    const liveIndex = slot.kind === 'encoderButton' ? keys : slot.kind === 'clockwise' ? 7 : 8;
    const action = slot.kind === 'encoderButton' ? layer.encoderButton : slot.kind === 'clockwise' ? layer.clockwise : layer.counterclockwise;
    const problem = actionProblem(action, { layerCount, rotation: slot.kind !== 'encoderButton' });
    const dragged = readOnly ? null : draggedSlot.value;
    const invalidDrop = !!dragged && !canSwapSlots(dragged, slot);
    const intent = !readOnly && slotDrop.value && sameSlot(slotDrop.value.slot, slot) ? slotDrop.value.position : null;
    return (
      <button title={actionTooltip(action)} data-clipboard-target={!readOnly || undefined} data-slot={readOnly ? undefined : JSON.stringify(slot)} class={`enc-part ${(slot.kind === 'encoderButton' && pressed(liveIndex)) || turned(liveIndex) ? 'is-live-pressed' : ''} ${triggerClass(liveIndex)} ${sameSlot(selection, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''} ${sameSlot(dragged, slot) ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''} ${invalidDrop ? 'drag-invalid' : ''}`} onClick={readOnly ? undefined : () => select(slot)} draggable={!readOnly} tabIndex={readOnly ? -1 : undefined} aria-disabled={readOnly || undefined} onDragStart={readOnly ? undefined : (event) => dragStart(event, slot)} onDragEnd={readOnly ? undefined : dragEnd} onDragOver={readOnly ? undefined : (event) => dragOver(event, slot, 'vertical')} onDrop={readOnly ? undefined : (event) => drop(event, slot, 'vertical')}>
        <span class="enc-part-label">{icon}{label}{readOnly && turned(liveIndex) && <small>{activity!.turns[liveIndex - 7]} Detent{activity!.turns[liveIndex - 7] === 1 ? '' : 's'}</small>}</span>
        <span class="enc-part-value"><ActionLabel action={action} showTooltip={false} compact /></span>
      </button>
    );
  };

  return (
    <div class={`device device-${keys} ${readOnly ? "device-readonly" : ""}`}>
      <div class={`device-shell ${!readOnly && indicatorOn ? 'indicator-glow' : ''}`}
        style={`--indicator-color:${indicatorColor}; --indicator-opacity:${layer.indicatorFullBrightness ? 1 : 0.65}`}>
      <div class="device-body"
        onMouseEnter={readOnly ? () => setLiveDeviceHovered(true) : undefined}
        onMouseLeave={readOnly ? () => setLiveDeviceHovered(false) : undefined}>
        <div class="keygrid" style={`--cols:${keys === 6 ? 3 : 3}`} onDragOver={readOnly ? undefined : gridDragOver} onDrop={readOnly ? undefined : gridDrop}>
          {Array.from({ length: keys }, (_, i) => renderKeyCap(i))}
        </div>
        <div class="encoder">
          <div class="knob" aria-hidden="true"><div class="knob-mark" /></div>
          <div class="enc-parts">
            {renderEncoderPart({ slot: { kind: 'clockwise', layer: li }, label: 'Turn Left', icon: <IconRotate /> })}
            {renderEncoderPart({ slot: { kind: 'encoderButton', layer: li }, label: 'Press' })}
            {renderEncoderPart({ slot: { kind: 'counterclockwise', layer: li }, label: 'Turn Right', icon: <IconRotate ccw /> })}
          </div>
        </div>
        {asleep && <div class="device-sleep-overlay" role="status">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.5 13A7 7 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
          </svg>
          <span class="device-sleep-title">Sleeping</span>
          <span class="device-sleep-hint">Press a key or turn the knob to wake
            {!p.consumeWakeInput && <><br />and run its assigned action</>}
          </span>
        </div>}
      </div>
      </div>
    </div>
  );
}
