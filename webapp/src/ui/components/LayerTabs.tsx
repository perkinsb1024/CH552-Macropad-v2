import { useState } from 'preact/hooks';
import { addLayer, layerName, meta, profile, selectedLayer, selectedSlot, setLayerName } from '../store';
import { MAX_LAYERS } from '../../model/constants';
import { IconPlus } from './Icons';

export function LayerTabs() {
  const p = profile.value!;
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div class="tabs" role="tablist" aria-label="Layers">
      {p.layers.map((_, i) => {
        const active = selectedLayer.value === i;
        return (
          <button
            key={i}
            role="tab"
            aria-selected={active}
            class={`tab ${active ? 'tab-active' : ''}`}
            onClick={() => { selectedLayer.value = i; if (selectedSlot.value && selectedSlot.value.layer !== i) selectedSlot.value = null; }}
            onDblClick={() => setEditing(i)}
            title="Double-click to rename (name is stored in this browser only)"
          >
            <span class="tab-index">{i + 1}</span>
            {editing === i ? (
              <input
                class="tab-rename"
                autoFocus
                value={meta.value.layerNames?.[i] ?? ''}
                placeholder={`Layer ${i + 1}`}
                onInput={(e) => setLayerName(i, (e.target as HTMLInputElement).value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null); }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span class="tab-name">{layerName(i)}</span>
            )}
            {p.startupLayer === i && <span class="tab-badge" title="Startup layer">start</span>}
          </button>
        );
      })}
      {p.layers.length < MAX_LAYERS && (
        <button class="tab tab-add" onClick={addLayer} title="Add layer"><IconPlus /> Add layer</button>
      )}
    </div>
  );
}
