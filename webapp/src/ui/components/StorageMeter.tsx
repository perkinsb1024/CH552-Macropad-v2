import { IMAGE_SIZE, layerSize, layerPaletteSize } from '../../model/constants';
import { capacity, profile } from '../store';

export function StorageMeter() {
  const cap = capacity.value!;
  const p = profile.value!;
  const over = cap.remaining < 0;
  const palettes = cap.layerPalettes / layerPaletteSize(p.variant);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / IMAGE_SIZE) * 100))}%`;
  const segments = [
    { key: 'header', label: 'Header', bytes: cap.header, detail: 'Fixed' },
    { key: 'layers', label: `${p.layers.length} Layer${p.layers.length > 1 ? 's' : ''}`, bytes: cap.layers, detail: `${layerSize(p.variant)} bytes each` },
    { key: 'palettes', label: `${palettes} Layer Palette${palettes === 1 ? '' : 's'}`, bytes: cap.layerPalettes, detail: `${layerPaletteSize(p.variant)} bytes each` },
    { key: 'chords', label: `${p.chords.length} Chord${p.chords.length === 1 ? '' : 's'}`, bytes: cap.chords, detail: '3 bytes each' },
    { key: 'timers', label: `${p.timedActions?.length ?? 0} Timed Action${p.timedActions?.length === 1 ? '' : 's'}`, bytes: cap.timedActions, detail: '6 bytes each' },
    ...(cap.tapHold ? [{ key: 'tap-hold', label: 'Tap-Hold Pairs', bytes: cap.tapHold, detail: '4 bytes each + 1 header' }] : []),
    { key: 'macros', label: `${p.macros?.length ?? 0} Macro${p.macros?.length === 1 ? '' : 's'}`, bytes: cap.macros, detail: '2 bytes per step + terminator' },
    { key: 'strings', label: `${cap.pool.length} String${cap.pool.length === 1 ? '' : 's'}`, bytes: cap.strings, detail: 'length + terminator' },
  ];
  return (
    <section class={`card storage ${over ? 'is-over' : ''}`}>
      <header class="card-head">
        <h2>Device Storage</h2>
        <span class={over ? 'warn' : 'muted'}>
          {over ? `${-cap.remaining} byte${cap.remaining === -1 ? '' : 's'} over` : `${cap.used} of ${IMAGE_SIZE} bytes used`}
        </span>
      </header>
      <div class="meter" role="group" aria-label={`${cap.used} of ${IMAGE_SIZE} bytes used`}>
        {[...segments, { key: 'free', label: 'Free', bytes: Math.max(0, cap.remaining), detail: '' }].filter(s => s.bytes > 0).map((s) => <button type="button" key={s.key} class={`meter-seg seg-${s.key}`} style={`width:${pct(s.bytes)}`} aria-label={`${s.label}: ${s.bytes} bytes`} aria-describedby={`storage-${s.key}`}
          onPointerDown={event => {
            // Mouse clicks should not retain focus and pin the hover flyout.
            if (event.pointerType === 'mouse') event.preventDefault();
          }}
        >
          <span class="meter-flyout" id={`storage-${s.key}`} role="tooltip">{s.label}<span class="meter-usage">{s.bytes} byte{s.bytes === 1 ? '' : 's'}</span></span>
        </button>)}
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
          <span class={`legend-bytes mono ${over ? 'warn' : ''}`}>{cap.remaining}</span>
        </li>
      </ul>
      {cap.pool.length > 0 && (
        <details class="pool">
          <summary>String Pool ({cap.strings} byte{cap.strings === 1 ? '' : 's'})</summary>
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
