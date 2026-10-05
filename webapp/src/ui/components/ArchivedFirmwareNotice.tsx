import { archivedFirmware } from '../store';

export function ArchivedFirmwareNotice() {
  const archive = archivedFirmware.value;
  if (!archive) return null;
  return (
    <div class="notice notice-warn" role="alert">
      Your macropad uses firmware format v{archive.version}.{' '}
      <a href={archive.url}>Open its archived configurator</a> to edit and save its settings, or{' '}
      build and upload format v8 firmware to use this editor.
    </div>
  );
}
