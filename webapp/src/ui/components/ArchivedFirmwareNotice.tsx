import { archivedFirmware } from '../store';
import { FORMAT_VERSION } from '../../model/constants';
import { siteUrl } from '../../site';

export function ArchivedFirmwareNotice() {
  const archive = archivedFirmware.value;
  if (!archive) return null;
  return (
    <div class="notice notice-warn" role="alert">
      Your macropad uses firmware format v{archive.version}.{' '}
      <a href={archive.url}>Open its archived configurator</a> to edit and save its settings, or{' '}
      <a href={siteUrl('webUploader/')}>update to format v{FORMAT_VERSION} firmware</a> to use this editor.{' '}
      Back up your profile before updating, then load and save it here to migrate it.
    </div>
  );
}
