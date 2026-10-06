import { IMAGE_SIZE, layerSize } from '../../model/constants';
import { capacity, profile } from '../store';

export function StorageMeter() {
  const cap = capacity.value!;
  const p = profile.value!;
  const over = cap.remaining < 0;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / IMAGE_SIZE) * 100))}%`;
  const segments = [
    { key: 'header', label: 'Header', bytes: cap.header, detail: 'Fixed' },
    { key: 'layers', label: `${p.layers.length} layer${p.layers.length > 1 ? 's' : ''}`, bytes: cap.layers, detail: `${layerSize(p.variant)} bytes each` },
    { key: 'chords', label: `${p.chords.length} chord${p.chords.length === 1 ? '' : 's'}`, bytes: cap.chords, detail: '3 bytes each' },
    { key: 'timers', label: `${p.timedActions?.length ?? 0} timed action${p.timedActions?.length === 1 ? '' : 's'}`, bytes: cap.timedActions, detail: '6 bytes each' },
    { key: 'strings', label: `${cap.pool.length} string${cap.pool.length === 1 ? '' : 's'}`, bytes: cap.strings, detail: 'length + terminator' },
  ];
  return (
    <section class={`card storage ${over ? 'is-over' : ''}`}>
      <header class="card-head">
        <h2>Device storage</h2>
        <span class={over ? 'warn' : 'muted'}>
          {over ? `${-cap.remaining} byte${cap.remaining === -1 ? '' : 's'} over` : `${cap.remaining} of ${IMAGE_SIZE} bytes free`}
        </span>
      </header>
      <div class="meter" role="img" aria-label={`${cap.used} of ${IMAGE_SIZE} bytes used`}>
        {segments.map((s) => s.bytes > 0 && <span key={s.key} class={`meter-seg seg-${s.key}`} style={`width:${pct(s.bytes)}`} title={`${s.label}: ${s.bytes} byte${s.bytes === 1 ? '' : 's'}`} />)}
      </div>
      <ul class="meter-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span class={`legend-dot seg-${s.key}`} />
            <span class="legend-label">{s.label}</span>
            <span class="legend-detail muted">{s.detail}</span>
            <span class="legend-bytes mono">{s.bytes}</span>
          </li>
        ))}
        <li class="legend-free">
          <span class="legend-dot seg-free" />
          <span class="legend-label">Free</span>
          <span class="legend-detail muted">for timers, chords and text</span>
          <span class={`legend-bytes mono ${over ? 'warn' : ''}`}>{cap.remaining}</span>
        </li>
      </ul>
      {cap.pool.length > 0 && (
        <details class="pool">
          <summary>String pool ({cap.strings} byte{cap.strings === 1 ? '' : 's'})</summary>
          <ol>
            {cap.pool.map((s, i) => (
              <li key={i}><code>{s === '' ? '(empty)' : s.replace(/\n/g, '⏎').replace(/\t/g, '⇥')}</code> <span class="muted mono">{s.length + 1}</span></li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
