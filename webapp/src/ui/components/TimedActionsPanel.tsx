import { MAX_TIMED_ACTIONS, TIMED_ENTRY_SIZE, TIMED_TICK_SECONDS } from '../../model/constants';
import type { Slot } from '../../model/types';
import { capacity, profile, selectedSlot, updateProfile } from '../store';
import { ActionLabel } from './ActionLabel';
import { IconPlus, IconTrash } from './Icons';

export function approximateDuration(ticks: number): string {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 128) return 'Choose 1–128 ticks';
  const seconds = ticks * TIMED_TICK_SECONDS;
  return seconds < 120 ? `≈ ${seconds.toFixed(1)} seconds` : `≈ ${(seconds / 60).toFixed(1)} minutes`;
}

export function TimedActionsPanel() {
  const p = profile.value!;
  const timers = p.timedActions ?? [];
  const unavailable = timers.length >= MAX_TIMED_ACTIONS ? `Maximum ${MAX_TIMED_ACTIONS} timed actions.`
    : (capacity.value?.remaining ?? 0) < TIMED_ENTRY_SIZE ? 'Not enough storage (5 bytes needed).' : '';
  const add = () => {
    if (unavailable) return;
    updateProfile((draft) => {
      (draft.timedActions ??= []).push({ ticks: 1, resetOnInput: true, action: { type: 'none' }, resumeAction: { type: 'none' } });
    });
    selectedSlot.value = { kind: 'timed', layer: 0, index: timers.length, resume: false };
  };
  return <section class="card timed-actions">
    <header class="card-head"><h2>Timed actions</h2><span class="muted">Across all layers · {timers.length}/{MAX_TIMED_ACTIONS}</span></header>
    {!timers.length && <p class="empty">Repeat an action on a timer, or after inactivity. Each timer uses 5 bytes.</p>}
    <div class="timer-list">
      {timers.map((timer, index) => {
        const select = (resume: boolean): Slot => ({ kind: 'timed', layer: 0, index, resume });
        const active = (resume: boolean) => selectedSlot.value?.kind === 'timed' && selectedSlot.value.index === index && selectedSlot.value.resume === resume;
        return <article class="timer-row" key={index}>
          <header class="card-head"><strong>Timer {index + 1}</strong>
            <button class="btn btn-icon btn-ghost" aria-label={`Remove timer ${index + 1}`} onClick={() => {
              updateProfile((draft) => { draft.timedActions!.splice(index, 1); if (!draft.timedActions!.length) delete draft.timedActions; });
              const slot = selectedSlot.value;
              if (slot?.kind === 'timed') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
            }}><IconTrash /></button>
          </header>
          <label class="field"><span class="field-label">Interval <output>{approximateDuration(timer.ticks)}</output></span>
            <div class="row"><input type="number" min={1} max={128} step={1} value={timer.ticks} aria-label={`Timer ${index + 1} interval ticks`} onInput={(event) => {
              const ticks = Number((event.target as HTMLInputElement).value);
              updateProfile((draft) => { draft.timedActions![index]!.ticks = ticks; }, `timer:${index}:ticks`);
            }} /><span class="muted">× 65.536 seconds</span></div>
          </label>
          <label class="timer-reset"><input type="checkbox" checked={timer.resetOnInput} onChange={(event) => {
            const reset = (event.target as HTMLInputElement).checked;
            updateProfile((draft) => { draft.timedActions![index]!.resetOnInput = reset; });
          }} /> Restart on key / encoder input</label>
          <button data-clipboard-target class={`timer-action ${active(false) ? 'is-selected' : ''}`} aria-label={`Edit timer ${index + 1} action`} aria-pressed={active(false)} onClick={() => { selectedSlot.value = select(false); }}>
            <span class="field-label">When timer fires</span><ActionLabel action={timer.action} />
          </button>
          <details class="timer-resume" open={timer.resumeAction.type !== 'none' || active(true)}>
            <summary>On next input <span class="muted">{timer.resumeAction.type === 'none' ? '(optional)' : '· assigned'}</span></summary>
            <p class="hint">Runs once after this timer fires, before the key or encoder action. Use this to restore configured LED brightness.</p>
            <button data-clipboard-target class={`timer-action ${active(true) ? 'is-selected' : ''}`} aria-label={`Edit timer ${index + 1} resume action`} aria-pressed={active(true)} onClick={() => { selectedSlot.value = select(true); }}>
              <ActionLabel action={timer.resumeAction} />
            </button>
          </details>
        </article>;
      })}
    </div>
    <button class="btn" disabled={!!unavailable} title={unavailable || 'Add a timed action'} onClick={add}><IconPlus /> Add timed action</button>
    {unavailable && <p class="hint">{unavailable}</p>}
    <p class="hint">Timers repeat. Restarting on input makes them inactivity timers. Intervals use a shared clock; the first firing can be up to 65.5 seconds early. Held actions are unavailable.</p>
  </section>;
}
