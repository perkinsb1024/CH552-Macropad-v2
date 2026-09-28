import { useState } from 'preact/hooks';
import { keyCount } from '../../model/constants';
import { allPairs } from '../../model/pairs';
import { summarize } from '../../model/actions';
import type { Slot } from '../../model/types';
import { actionProblem } from '../../model/validate';
import { addChord, profile, removeChord, selectedLayer, selectedSlot } from '../store';
import { IconPlus, IconTrash } from './Icons';

export function ChordPanel() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const keys = keyCount(p.variant);
  const chords = p.chords.filter((c) => c.layer === li).sort((a, b) => a.keyA - b.keyA || a.keyB - b.keyB);
  const used = new Set(chords.map((c) => `${c.keyA}-${c.keyB}`));
  const available = allPairs(keys).filter(([a, b]) => !used.has(`${a}-${b}`));
  const [pick, setPick] = useState('');
  const first = available[0];

  return (
    <section class="card">
      <header class="card-head">
        <h2>Chords</h2>
        <span class="muted">Two keys pressed together</span>
      </header>
      {chords.length === 0 && <p class="empty">No chords on this layer. Each chord uses 3 bytes of device storage.</p>}
      {chords.length > 0 && (
        <ul class="chord-list">
          {chords.map((c) => {
            const slot: Slot = { kind: 'chord', layer: li, keyA: c.keyA, keyB: c.keyB };
            const selected = JSON.stringify(selectedSlot.value) === JSON.stringify(slot);
            const problem = actionProblem(c.action, { layerCount: p.layers.length, rotation: false });
            return (
              <li key={`${c.keyA}-${c.keyB}`} class={`chord ${selected ? 'is-selected' : ''} ${problem ? 'has-problem' : ''}`}>
                <button class="chord-main" onClick={() => { selectedSlot.value = slot; }}>
                  <span class="chord-keys"><kbd>{c.keyA + 1}</kbd><span>+</span><kbd>{c.keyB + 1}</kbd></span>
                  <span class="chord-action">{summarize(c.action)}</span>
                </button>
                <button class="btn btn-icon btn-ghost" aria-label="Remove chord" onClick={() => removeChord(c)}><IconTrash /></button>
              </li>
            );
          })}
        </ul>
      )}
      {available.length > 0 && (
        <div class="chord-add">
          <select value={pick || (first ? `${first[0]}-${first[1]}` : '')} onChange={(e) => setPick((e.target as HTMLSelectElement).value)} aria-label="Key pair">
            {available.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>Keys {a + 1} + {b + 1}</option>)}
          </select>
          <button class="btn" onClick={() => {
            const [a, b] = (pick || `${first![0]}-${first![1]}`).split('-').map(Number) as [number, number];
            addChord(li, a, b);
            setPick('');
          }}><IconPlus /> Add chord</button>
        </div>
      )}
      {p.chordWindow === 0 && chords.length > 0 && <p class="hint warn">The chord window is set to off, so these chords will not trigger.</p>}
    </section>
  );
}
