import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { dirty } from '../store';
import { MOUSE_BUTTONS } from '../../model/constants';

export function ScrollTest({ onClose }: { onClose(): void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState(MOUSE_BUTTONS.map(() => 0));
  const [heldButtons, setHeldButtons] = useState(0);
  useEffect(() => {
    const previousFocus = document.activeElement;
    modal.current?.showModal();
    const scroller = area.current;
    if (scroller) {
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    }
    // Observe releases outside the test area as well as buttons already held
    // when the pointer enters. DOM button bits are Left=1, Middle=4, Right=2.
    const syncButtons = (event: MouseEvent) => setHeldButtons(event.buttons & 255);
    const clearButtons = () => setHeldButtons(0);
    const onVisibility = () => { if (document.hidden) clearButtons(); };
    window.addEventListener('mousedown', syncButtons);
    window.addEventListener('mouseup', syncButtons);
    window.addEventListener('mousemove', syncButtons);
    window.addEventListener('blur', clearButtons);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('mousedown', syncButtons);
      window.removeEventListener('mouseup', syncButtons);
      window.removeEventListener('mousemove', syncButtons);
      window.removeEventListener('blur', clearButtons);
      document.removeEventListener('visibilitychange', onVisibility);
      modal.current?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  const countClick: JSX.MouseEventHandler<HTMLDivElement> = event => {
    const button = event.button;
    const selected = MOUSE_BUTTONS.findIndex(b => b.domButton === button);
    if (selected < 0) return;
    setCounts(current => current.map((count, index) => count + (index === selected ? 1 : 0)));
  };
  return (
    <dialog ref={modal} class="dialog scroll-test-dialog" aria-labelledby="scroll-test-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id="scroll-test-title">Scroll &amp; Click Test</h2>
      <p>Move your pointer into the test area, then use your macropad to scroll or click. This tests the settings currently saved on the macropad.</p>
      {dirty.value && <div class="notice notice-warn" role="alert">You currently have unsaved changes. Be sure to save your changes to the macropad for this test to work correctly.</div>}
      <div ref={area} class="scroll-test-area" tabIndex={0} aria-label="Scroll and click test area" onClick={countClick} onAuxClick={event => { event.preventDefault(); countClick(event); }} onContextMenu={event => event.preventDefault()} onMouseDown={event => { if (event.button !== 0) event.preventDefault(); }}>
        <div class="scroll-test-grid">
          {['Top left', 'Top', 'Top right', 'Left', 'Scroll in any direction', 'Right', 'Bottom left', 'Bottom', 'Bottom right'].map(label => <div key={label}>{label}</div>)}
        </div>
      </div>
      <p class="hint">The browser may intercept side buttons or expose only buttons 1–5. Missing events for buttons 6–8 do not establish whether another application supports them.</p>
      <div class="scroll-test-counts">
        <h3>Click count</h3>
        <div aria-live="polite" aria-atomic="true">
          {MOUSE_BUTTONS.map(({ label, bit }, index) => (
            <span key={bit} class="mouse-button-column"><span class={`mouse-button-state${heldButtons & bit ? ' is-held' : ''}`}>{heldButtons & bit ? 'Held' : 'Released'}</span><span>{label}: <output>{counts[index]}</output></span></span>
          ))}
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={() => setCounts(MOUSE_BUTTONS.map(() => 0))}>Reset counts</button>
        <button type="button" class="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
