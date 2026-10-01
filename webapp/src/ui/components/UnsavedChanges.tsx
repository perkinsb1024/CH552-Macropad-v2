import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { profileChanges } from '../../model/changes';
import { baseline, getAction, profile, selectedLayer, selectedSlot, updateProfile } from '../store';

export function UnsavedChanges() {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const p = profile.value;
  const changes = p ? profileChanges(baseline.value, p) : [];
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (popup.current?.contains(document.activeElement)) trigger.current?.focus();
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!trigger.current || !popup.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const width = popup.current.getBoundingClientRect().width;
      const left = Math.max(16, Math.min(center - width / 2, window.innerWidth - width - 16));
      setShift(left + width / 2 - center);
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  return (
    <div
      ref={container}
      class="unsaved-changes"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button ref={trigger} type="button" class="pill pill-warn unsaved-changes-trigger" aria-expanded={open} aria-controls="unsaved-changes-popup" onClick={() => setOpen(true)}>
        Unsaved changes
      </button>
      {open && (
        <div ref={popup} id="unsaved-changes-popup" class="changes-popup" role="region" aria-label="Unsaved changes" style={`--popup-shift:${shift}px`}>
          <div class="changes-popup-heading">
            <strong>Unsaved changes</strong>
            {baseline.value && <span>{changes.length} {changes.length === 1 ? 'change' : 'changes'}</span>}
          </div>
          <div class="changes-popup-content" tabIndex={0} aria-label="Change list">
            {baseline.value && <p class="changes-popup-note">Compared with the last device read or save.</p>}
            <ul class="changes-list">
              {changes.map((change) => (
                <li key={change.where}>
                  <div class="change-heading">
                    <span class="change-location">{change.where}</span>
                    {change.undo && <button
                      type="button"
                      class="btn btn-small btn-ghost change-undo"
                      aria-label={`Revert ${change.where}`}
                      onClick={() => {
                        // Keep focus in the popup when this row disappears.
                        trigger.current?.focus();
                        updateProfile(change.undo!);
                        selectedLayer.value = Math.min(selectedLayer.value, profile.value!.layers.length - 1);
                        if (selectedSlot.value && !getAction(profile.value!, selectedSlot.value)) selectedSlot.value = null;
                      }}
                    >Revert</button>}
                  </div>
                  {(change.before !== undefined || change.after !== undefined) && (
                    <span class="change-values">
                      {change.before !== undefined && <span class="change-before">{change.before}</span>}
                      {change.before !== undefined && change.after !== undefined && <span class="change-arrow" aria-label="changed to">→</span>}
                      {change.after !== undefined && <span>{change.after}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
