import { useEffect, useState } from 'preact/hooks';
import { KEYS, KEY_GROUPS, keyForCode, keyName } from '../../keys/keyboard';
import { MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT } from '../../model/constants';

interface Props {
  usage: number;
  modifiers: number;
  onChange(usage: number, modifiers: number): void;
}

const MODS = [
  { bit: MOD_CTRL, label: 'Ctrl' },
  { bit: MOD_SHIFT, label: 'Shift' },
  { bit: MOD_ALT, label: 'Alt / Option' },
  { bit: MOD_GUI, label: 'GUI (Win / Cmd)' },
];

export function KeyPicker({ usage, modifiers, onChange }: Props) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = (e.ctrlKey ? MOD_CTRL : 0) | (e.shiftKey ? MOD_SHIFT : 0) | (e.altKey ? MOD_ALT : 0) | (e.metaKey ? MOD_GUI : 0);
      const key = keyForCode(e.code);
      const isModifierOnly = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code);
      if (isModifierOnly) {
        onChange(0, mods); // keep listening for a main key; releasing leaves modifier-only
        return;
      }
      if (key) onChange(key.usage, mods);
      setCapturing(false);
    };
    const onBlur = () => setCapturing(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [capturing, onChange]);

  return (
    <div class="keypicker">
      <div class="field">
        <span class="field-label">Key</span>
        <div class="row">
          <select value={usage} onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value), modifiers)} aria-label="Key">
            <option value={0}>No key (modifiers only)</option>
            {KEY_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {KEYS.filter((k) => k.group === group).map((k) => <option key={k.usage} value={k.usage}>{k.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button class={`btn ${capturing ? 'btn-capturing' : ''}`} onClick={() => setCapturing(!capturing)} aria-pressed={capturing} title="Press a shortcut on your keyboard to fill in the key and modifiers">
            {capturing ? 'Press a shortcut…' : 'Capture'}
          </button>
        </div>
        {capturing && <span class="hint">Listening. Some shortcuts are intercepted by the OS or browser and cannot be captured; pick them from the list instead.</span>}
      </div>
      <div class="field">
        <span class="field-label">Modifiers</span>
        <div class="chips">
          {MODS.map((m) => (
            <label key={m.bit} class={`chip ${modifiers & m.bit ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={!!(modifiers & m.bit)} onChange={(e) => onChange(usage, (e.target as HTMLInputElement).checked ? modifiers | m.bit : modifiers & ~m.bit)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>
      <div class="preview">
        {[...MODS.filter((m) => modifiers & m.bit).map((m) => m.label.split(' ')[0]!), ...(usage ? [keyName(usage)] : [])].map((part, i, arr) => (
          <span key={i}><kbd>{part}</kbd>{i < arr.length - 1 && <span class="plus">+</span>}</span>
        ))}
        {!usage && !modifiers && <span class="muted">Nothing selected</span>}
      </div>
    </div>
  );
}
