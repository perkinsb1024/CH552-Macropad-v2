import { addLayer, ask, closeDialog, draggedLayer, layerName, profile, removeLayer, selectedLayer, selectedSlot, swapLayers } from '../store';
import { MAX_LAYERS } from '../../model/constants';
import { IconPlus, IconTrash } from './Icons';

export function LayerTabs() {
  const p = profile.value!;
  const current = selectedLayer.value;
  const removeSelected = () => {
    ask({
      title: `Remove ${layerName(current)}?`,
      body: 'All chords and bindings on this layer will be deleted. Nothing changes on the device until you save.',
      actions: [
        { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
        { label: 'Remove layer', tone: 'danger', onSelect: () => { removeLayer(current); closeDialog(); } },
      ],
    });
  };
  return (
    <div class="layer-tabs-row">
    <div class="tabs" role="tablist" aria-label="Layers">
      {p.layers.map((_, i) => {
        const active = selectedLayer.value === i;
        return (
          <button
            key={i}
            role="tab"
            aria-selected={active}
            class={`tab ${active ? 'tab-active' : ''} ${draggedLayer.value === i ? 'is-dragging' : ''} ${draggedLayer.value !== null && draggedLayer.value !== i ? 'is-drop-target' : ''}`}
            onClick={() => { selectedLayer.value = i; if (selectedSlot.value && selectedSlot.value.layer !== i) selectedSlot.value = null; }}
            title="Drag onto another layer to swap their configurations"
            draggable
            onDragStart={(event) => { draggedLayer.value = i; event.dataTransfer?.setData('application/x-macropad-layer', 'move'); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { draggedLayer.value = null; }}
            onDragOver={(event) => { if (draggedLayer.value !== null && draggedLayer.value !== i) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(event) => { event.preventDefault(); const source = draggedLayer.value; if (source !== null) swapLayers(source, i); draggedLayer.value = null; }}
          >
            <span class="tab-index">{i + 1}</span>
            <span class="tab-name">{layerName(i)}</span>
            {p.startupLayer === i && <span class="tab-badge" title="Startup layer">start</span>}
          </button>
        );
      })}
      {p.layers.length < MAX_LAYERS && (
        <button class="tab tab-add" onClick={addLayer} title="Add layer"><IconPlus /> Add layer</button>
      )}
    </div>
    {p.layers.length > 1 && <button class="btn btn-icon btn-danger layer-delete" aria-label={`Remove ${layerName(current)}`} title={p.startupLayer === current ? 'Change the startup layer before removing this layer' : `Remove ${layerName(current)}`} disabled={p.startupLayer === current} onClick={removeSelected}><IconTrash /></button>}
    </div>
  );
}
