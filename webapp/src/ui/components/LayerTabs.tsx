import { addLayer, ask, canInsertLayer, closeDialog, draggedLayer, insertLayer, layerDrop, layerName, profile, removeLayer, selectedLayer, selectedSlot, swapLayers } from '../store';
import { dropPosition } from '../drag';
import { MAX_LAYERS } from '../../model/constants';
import { IconPlus, IconTrash } from './Icons';

export function LayerTabs() {
  const p = profile.value!;
  const current = selectedLayer.value;
  const clearDrag = () => { draggedLayer.value = null; layerDrop.value = null; };
  const gapTarget = (event: DragEvent): { index: number; position: 'before' | 'after' } | null => {
    const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab:not(.tab-add)'));
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    tabs.forEach((tab, index) => {
      const rect = tab.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const x = position === 'before' ? rect.left : rect.right;
        const y = Math.max(rect.top, Math.min(event.clientY, rect.bottom));
        const distance = Math.hypot(event.clientX - x, event.clientY - y);
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    return closest;
  };
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
    <div class="tabs" role="tablist" aria-label="Layers" onDragOver={(event) => {
      if ((event.target as HTMLElement).closest('.tab')) return;
      const source = draggedLayer.value;
      const target = gapTarget(event);
      if (source !== null && target && canInsertLayer(source, target.index, target.position)) {
        event.preventDefault();
        layerDrop.value = target;
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      } else layerDrop.value = null;
    }} onDrop={(event) => {
      if ((event.target as HTMLElement).closest('.tab')) return;
      event.preventDefault();
      const source = draggedLayer.value;
      const target = gapTarget(event);
      if (source !== null && target) insertLayer(source, target.index, target.position);
      clearDrag();
    }}>
      {p.layers.map((_, i) => {
        const active = selectedLayer.value === i;
        const intent = layerDrop.value?.index === i ? layerDrop.value.position : null;
        return (
          <button
            key={i}
            role="tab"
            aria-selected={active}
            class={`tab ${active ? 'tab-active' : ''} ${draggedLayer.value === i ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''}`}
            onClick={() => { selectedLayer.value = i; if (selectedSlot.value && selectedSlot.value.layer !== i) selectedSlot.value = null; }}
            title="Drop in the center to swap, or at an edge to insert"
            draggable
            onDragStart={(event) => { draggedLayer.value = i; event.dataTransfer?.setData('application/x-macropad-layer', 'move'); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              const source = draggedLayer.value;
              const position = dropPosition(event, 'horizontal');
              const valid = source !== null && (position === 'swap' ? source !== i : canInsertLayer(source, i, position));
              if (!valid) { layerDrop.value = null; if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'; return; }
              event.preventDefault();
              layerDrop.value = { index: i, position };
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const source = draggedLayer.value;
              const position = layerDrop.value?.index === i ? layerDrop.value.position : dropPosition(event, 'horizontal');
              if (source !== null) {
                if (position === 'swap') swapLayers(source, i);
                else insertLayer(source, i, position);
              }
              clearDrag();
            }}
          >
            <span class="tab-index">{i + 1}</span>
            <span class="tab-name">{layerName(i)}</span>
            {p.startupLayer === i && <span class="tab-badge" title="Startup layer">start</span>}
            {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
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
