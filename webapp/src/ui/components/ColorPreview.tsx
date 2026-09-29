import { cancelPreview, connection, previewColor } from '../store';

export function ColorPreview({ color, fullBrightness = true, rainbow = false }: {
  color: number; fullBrightness?: boolean; rainbow?: boolean;
}) {
  const c = connection.value;
  const available = c.kind === 'connected' && c.connection.previewSupported !== false;
  const unsupported = c.kind === 'connected' && c.connection.previewSupported === false;
  if (unsupported) {
    return <span class="hint">Color preview is unavailable in this firmware.</span>;
  }
  return (
    <div class="row">
      <button type="button" class="btn btn-small" disabled={!available} onClick={() => void previewColor(color, fullBrightness, rainbow)}>Preview Color</button>
      <button type="button" class="btn btn-small" disabled={!available} onClick={() => void cancelPreview()}>Cancel Preview</button>
    </div>
  );
}
