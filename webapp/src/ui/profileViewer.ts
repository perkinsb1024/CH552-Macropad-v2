import { effect } from '@preact/signals';
import { connection, profile, selectedLayer, selectedSlot, type Connection } from './store';

/** Follow hardware changes, while allowing manual browsing between changes. */
export function followDeviceLayer(): () => void {
  let lastConnection: Connection | null = null;
  let lastLayer: number | null = null;
  return effect(() => {
    const c = connection.value;
    const p = profile.value;
    if (c.kind !== 'connected' || !p || !c.connection.status.flashValid) {
      lastConnection = null;
      lastLayer = null;
      return;
    }
    const layer = c.connection.status.currentLayer;
    if (layer < 0 || layer >= p.layers.length || p.variant !== c.connection.info.variant) return;
    if (lastConnection !== c.connection || lastLayer !== layer) {
      selectedLayer.value = layer;
      selectedSlot.value = null;
    }
    lastConnection = c.connection;
    lastLayer = layer;
  });
}
