import { useRef } from 'preact/hooks';
import { paletteHex } from '../../model/palette';
import { activeColorPreview, cancelPreview, COLOR_PREVIEW_DURATION_MS, connection, previewColor } from '../store';

export function ColorPreview({ color, fullBrightness = true, rainbow = false }: {
  color: number; fullBrightness?: boolean; rainbow?: boolean;
}) {
  const source = useRef({});
  const preview = activeColorPreview.value;
  const ownPreview = preview?.source === source.current ? preview : null;
  const c = connection.value;
  const available = c.kind === 'connected' && c.connection.previewSupported !== false;
  const unsupported = c.kind === 'connected' && c.connection.previewSupported === false;
  if (unsupported) {
    return <span class="hint">Color preview is unavailable in this firmware.</span>;
  }
  return (
    <div class="color-preview-actions">
      <button type="button" class="btn btn-small color-preview-button" disabled={!available} onClick={() => void (ownPreview ? cancelPreview() : previewColor(color, fullBrightness, rainbow, source.current))}>
        {ownPreview && <span key={ownPreview.id} class={`color-preview-countdown${ownPreview.rainbow ? ' swatch-rainbow' : ''}`} style={{ backgroundColor: paletteHex(ownPreview.color), filter: `brightness(${ownPreview.fullBrightness ? 1 : 0.5})`, animationDuration: `${COLOR_PREVIEW_DURATION_MS}ms` }} aria-hidden="true" />}
        {ownPreview ? 'Cancel Preview' : 'Preview Color'}
      </button>
    </div>
  );
}
