import { useRef } from 'preact/hooks';
import { FORMAT_VERSION } from '../../model/constants';
import { connection, deviceDecode, deviceFlash, exportJson, exportToClipboard, exportRawFlash, importJsonFile, importFromClipboard, profile, resetToDefaults } from '../store';
import { IconDownload, IconRefresh, IconUpload } from './Icons';

export function ToolsPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const c = connection.value;
  const decode = deviceDecode.value;
  const status = c.kind === 'connected' ? c.connection.status : null;
  return (
    <section class="card tools">
      <header class="card-head">
        <h2>Backup &amp; restore</h2>
      </header>
      <div class="tool-row">
        <button class="btn" onClick={exportJson} disabled={!profile.value}><IconDownload /> Export JSON</button>
        <button class="btn" onClick={() => void exportToClipboard()} disabled={!profile.value}><IconDownload /> Export to Clipboard</button>
        <button class="btn" onClick={() => fileInput.current?.click()}><IconUpload /> Import profile</button>
        <button class="btn" onClick={() => void importFromClipboard()}><IconUpload /> Import from Clipboard</button>
        <input ref={fileInput} type="file" accept="application/json,text/plain,.json,.txt" hidden onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) void importJsonFile(file);
          (e.target as HTMLInputElement).value = '';
        }} />
      </div>
      <div class="tool-row">
        <button class="btn" onClick={resetToDefaults} disabled={!profile.value}><IconRefresh /> Reset to starter profile</button>
      </div>
      <p class="hint">Both exports contain the same JSON profile. Clipboard export is useful if MacOS GateKeeper prevents you from opening downloaded .json files.</p>

      {status && (
        <dl class="status-grid">
          <dt>Saved profile</dt>
          <dd>{decode?.ok ? 'Valid' : decode ? <span class="warn">{decode.reason === 'no-magic' ? 'None' : decode.reason === 'unsupported-version' ? 'Different format' : 'Invalid'}</span> : '—'}</dd>
          <dt>Active layer</dt>
          <dd>Layer {status.currentLayer + 1}</dd>
          <dt>Firmware</dt>
          <dd>Format v{c.kind === 'connected' ? c.connection.info.formatVersion : '?'} · Palette v{c.kind === 'connected' ? c.connection.info.paletteVersion : '?'}</dd>
          {(status.droppedButtonActions > 0 || status.droppedRotationActions > 0) && (
            <>
              <dt>Dropped actions</dt>
              <dd class="warn">{status.droppedButtonActions} button · {status.droppedRotationActions} rotation</dd>
            </>
          )}
        </dl>
      )}
      {c.kind === 'connected' && c.connection.info.formatVersion !== FORMAT_VERSION && (
        <p class="hint warn">Saving requires firmware with configuration format v{FORMAT_VERSION}.</p>
      )}
      {deviceFlash.value && decode && !decode.ok && (
        <button class="btn btn-small" onClick={exportRawFlash} title="Download the raw 128 flash bytes (also copies hex to the clipboard)">
          <IconDownload /> Export raw flash bytes
        </button>
      )}
    </section>
  );
}
