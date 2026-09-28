import { computed, effect, signal } from '@preact/signals';
import type { Action, Chord, Issue, Profile, Slot } from '../model/types';
import { MAX_LAYERS, keyCount, type Variant } from '../model/constants';
import { cloneProfile, defaultProfile, emptyLayer } from '../model/defaults';
import { validateProfile } from '../model/validate';
import { layerReachabilityWarnings } from '../model/reachability';
import { computeCapacity } from '../model/capacity';
import { encodeProfile } from '../codec/encode';
import { decodeImage, peekHeader, type DecodeResult } from '../codec/decode';
import { ConfigClient, ProtocolError, type SavePhase } from '../protocol/client';
import { WebHidTransport, webHidSupported, type Transport } from '../protocol/transport';
import { SimulatedDevice } from '../protocol/simulator';
import type { DeviceInfo, DeviceStatus } from '../protocol/packet';
import { exportProfile, importProfile, type LocalMetadata } from '../io/json';
import { clearDraft, loadDraft, storeDraft } from '../io/drafts';

// ---------------------------------------------------------------------------
// Connection

export interface Connection {
  transport: Transport;
  client: ConfigClient;
  info: DeviceInfo;
  status: DeviceStatus;
}

export type ConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting'; label: string }
  | { kind: 'connected'; connection: Connection };

export const connection = signal<ConnectionState>({ kind: 'disconnected' });
export const hidSupported = webHidSupported();

/** Raw flash bytes from the last read, kept for diagnostics/export even when undecodable. */
export const deviceFlash = signal<Uint8Array | null>(null);
export const deviceDecode = signal<DecodeResult | null>(null);

// ---------------------------------------------------------------------------
// Editor state

export const profile = signal<Profile | null>(null);
export const baseline = signal<Profile | null>(null);
export const meta = signal<LocalMetadata>({});
export const selectedLayer = signal(0);
export const selectedSlot = signal<Slot | null>(null);

interface EditorSnapshot { profile: Profile; meta: LocalMetadata }
interface HistoryEntry extends EditorSnapshot { key?: string; at: number }
const undoHistory = signal<HistoryEntry[]>([]);
const redoHistory = signal<EditorSnapshot[]>([]);
export const canUndo = computed(() => undoHistory.value.length > 0);
export const canRedo = computed(() => redoHistory.value.length > 0);

function copyMeta(value: LocalMetadata): LocalMetadata {
  return { ...value, layerNames: value.layerNames ? [...value.layerNames] : undefined };
}
function editorSnapshot(): EditorSnapshot | null {
  return profile.value ? { profile: cloneProfile(profile.value), meta: copyMeta(meta.value) } : null;
}
function clearHistory(): void {
  undoHistory.value = [];
  redoHistory.value = [];
}
function recordHistory(key?: string): void {
  const before = editorSnapshot();
  if (!before) return;
  const now = Date.now();
  const history = undoHistory.value;
  const last = history[history.length - 1];
  if (key && last?.key === key && now - last.at < 700) {
    undoHistory.value = [...history.slice(0, -1), { ...last, at: now }];
  } else {
    undoHistory.value = [...history, { ...before, key, at: now }].slice(-100);
  }
  redoHistory.value = [];
}
function restoreEditor(snapshot: EditorSnapshot): void {
  profile.value = cloneProfile(snapshot.profile);
  meta.value = copyMeta(snapshot.meta);
  selectedLayer.value = Math.min(selectedLayer.value, snapshot.profile.layers.length - 1);
}
export function undo(): void {
  const history = undoHistory.value;
  const previous = history[history.length - 1];
  const current = editorSnapshot();
  if (!previous || !current) return;
  undoHistory.value = history.slice(0, -1);
  redoHistory.value = [...redoHistory.value, current].slice(-100);
  restoreEditor(previous);
}
export function redo(): void {
  const next = redoHistory.value[redoHistory.value.length - 1];
  const current = editorSnapshot();
  if (!next || !current) return;
  redoHistory.value = redoHistory.value.slice(0, -1);
  undoHistory.value = [...undoHistory.value, { ...current, at: Date.now() }].slice(-100);
  restoreEditor(next);
}

export const issues = computed<Issue[]>(() => (profile.value ? validateProfile(profile.value) : []));
export const reachabilityWarnings = computed(() => (profile.value ? layerReachabilityWarnings(profile.value) : []));
export const capacity = computed(() => (profile.value ? computeCapacity(profile.value) : null));
export const dirty = computed(() => {
  if (!profile.value) return false;
  if (!baseline.value) return true;
  return JSON.stringify(profile.value) !== JSON.stringify(baseline.value);
});
export const encodable = computed(() => issues.value.length === 0);

/** Whether the connected device can accept this profile. */
export const canSave = computed(() => {
  const c = connection.value;
  return c.kind === 'connected' && !!profile.value && encodable.value && profile.value.variant === c.connection.info.variant && saveState.value.phase !== 'busy';
});

export type SaveState =
  | { phase: 'idle' }
  | { phase: 'busy'; step: SavePhase; fraction: number }
  | { phase: 'saved'; at: number }
  | { phase: 'error'; message: string };

export const saveState = signal<SaveState>({ phase: 'idle' });

// ---------------------------------------------------------------------------
// Notifications & dialogs

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  text: string;
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function notify(tone: Toast['tone'], text: string, ttl = tone === 'error' ? 9000 : 4500): void {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, tone, text }];
  setTimeout(() => dismissToast(id), ttl);
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export interface DialogSpec {
  title: string;
  body: string;
  actions: Array<{ label: string; tone?: 'primary' | 'danger' | 'neutral'; onSelect: () => void }>;
}
export const dialog = signal<DialogSpec | null>(null);

export function ask(spec: DialogSpec): void {
  dialog.value = spec;
}

export function closeDialog(): void {
  dialog.value = null;
}

// ---------------------------------------------------------------------------
// Profile editing helpers

export function updateProfile(mutate: (draft: Profile) => void, historyKey?: string): void {
  if (!profile.value) return;
  const draft = cloneProfile(profile.value);
  mutate(draft);
  if (JSON.stringify(draft) === JSON.stringify(profile.value)) return;
  recordHistory(historyKey);
  profile.value = draft;
  if (saveState.value.phase === 'saved' || saveState.value.phase === 'error') saveState.value = { phase: 'idle' };
}

export function getAction(p: Profile, slot: Slot): Action | undefined {
  const layer = p.layers[slot.layer];
  if (!layer) return undefined;
  switch (slot.kind) {
    case 'key':
      return layer.keys[slot.index];
    case 'encoderButton':
      return layer.encoderButton;
    case 'clockwise':
      return layer.clockwise;
    case 'counterclockwise':
      return layer.counterclockwise;
    case 'chord':
      return p.chords.find((c) => c.layer === slot.layer && c.keyA === slot.keyA && c.keyB === slot.keyB)?.action;
  }
}

export function setAction(slot: Slot, action: Action): void {
  rememberAction(slot, action);
  updateProfile((draft) => {
    const layer = draft.layers[slot.layer];
    if (!layer) return;
    switch (slot.kind) {
      case 'key':
        layer.keys[slot.index] = action;
        break;
      case 'encoderButton':
        layer.encoderButton = action;
        break;
      case 'clockwise':
        layer.clockwise = action;
        break;
      case 'counterclockwise':
        layer.counterclockwise = action;
        break;
      case 'chord': {
        const chord = draft.chords.find((c) => c.layer === slot.layer && c.keyA === slot.keyA && c.keyB === slot.keyB);
        if (chord) chord.action = action;
        break;
      }
    }
  }, `action:${slotMemoryKey(slot)}:${action.type}`);
}

const ACTION_MEMORY_KEY = 'universal-macropad:action-settings:v1';
type ActionMemory = Record<string, Partial<Record<Action['type'], Action>>>;
function slotMemoryKey(slot: Slot): string { return JSON.stringify(slot); }
function readActionMemory(): ActionMemory {
  try { return JSON.parse(localStorage.getItem(ACTION_MEMORY_KEY) ?? '{}') as ActionMemory; }
  catch { return {}; }
}
function rememberAction(slot: Slot, action: Action): void {
  try {
    const memory = readActionMemory();
    memory[slotMemoryKey(slot)] = { ...memory[slotMemoryKey(slot)], [action.type]: action };
    localStorage.setItem(ACTION_MEMORY_KEY, JSON.stringify(memory));
  } catch { /* Browser storage is optional. */ }
}
export function rememberedAction(slot: Slot, type: Action['type']): Action | undefined {
  return readActionMemory()[slotMemoryKey(slot)]?.[type] as Action | undefined;
}

export function addChord(layer: number, keyA: number, keyB: number): void {
  const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  updateProfile((draft) => {
    if (draft.chords.some((c) => c.layer === layer && c.keyA === a && c.keyB === b)) return;
    draft.chords.push({ layer, keyA: a, keyB: b, action: { type: 'none' } });
  });
  selectedSlot.value = { kind: 'chord', layer, keyA: a, keyB: b };
}

export function removeChord(chord: Pick<Chord, 'layer' | 'keyA' | 'keyB'>): void {
  updateProfile((draft) => {
    draft.chords = draft.chords.filter((c) => !(c.layer === chord.layer && c.keyA === chord.keyA && c.keyB === chord.keyB));
  });
  const s = selectedSlot.value;
  if (s?.kind === 'chord' && s.layer === chord.layer && s.keyA === chord.keyA && s.keyB === chord.keyB) selectedSlot.value = null;
}

export function addLayer(): void {
  const p = profile.value;
  if (!p || p.layers.length >= MAX_LAYERS) return;
  updateProfile((draft) => {
    const sourceIndex = selectedLayer.value;
    const source = draft.layers[sourceIndex];
    draft.layers.push(source ? {
      ...source,
      keys: source.keys.map((action) => ({ ...action })),
      encoderButton: { ...source.encoderButton },
      clockwise: { ...source.clockwise },
      counterclockwise: { ...source.counterclockwise },
      leds: [...source.leds],
    } : emptyLayer(draft.variant));
    if (source) {
      const newIndex = draft.layers.length - 1;
      draft.chords.push(...draft.chords
        .filter((chord) => chord.layer === sourceIndex)
        .map((chord) => ({ ...chord, layer: newIndex, action: { ...chord.action } })));
    }
  });
  selectedLayer.value = p.layers.length;
  selectedSlot.value = null;
}

/** Counts references that would break if the layer were removed. */
export function layerReferences(p: Profile, layer: number): { actions: number; chords: number } {
  let actions = 0;
  const visit = (a: Action) => {
    if ((a.type === 'setLayer' || a.type === 'momentaryLayer' || a.type === 'toggleLayer') && a.layer === layer) actions++;
  };
  p.layers.forEach((l, li) => {
    if (li === layer) return;
    l.keys.forEach(visit);
    visit(l.encoderButton);
    visit(l.clockwise);
    visit(l.counterclockwise);
  });
  p.chords.forEach((c) => c.layer !== layer && visit(c.action));
  return { actions, chords: p.chords.filter((c) => c.layer === layer).length };
}

/**
 * Removes a layer along with its chords. References to higher layers shift down;
 * references to the removed layer are left in place so validation flags them.
 */
export function removeLayer(layer: number): void {
  updateProfile((draft) => {
    if (draft.layers.length <= 1) return;
    draft.layers.splice(layer, 1);
    draft.chords = draft.chords.filter((c) => c.layer !== layer).map((c) => (c.layer > layer ? { ...c, layer: c.layer - 1 } : c));
    const shift = (a: Action): Action => {
      if ((a.type === 'setLayer' || a.type === 'momentaryLayer' || a.type === 'toggleLayer') && a.layer > layer) return { ...a, layer: a.layer - 1 };
      return a;
    };
    for (const l of draft.layers) {
      l.keys = l.keys.map(shift);
      l.encoderButton = shift(l.encoderButton);
      l.clockwise = shift(l.clockwise);
      l.counterclockwise = shift(l.counterclockwise);
    }
    for (const c of draft.chords) c.action = shift(c.action);
    if (draft.startupLayer > layer) draft.startupLayer--;
    else if (draft.startupLayer === layer) draft.startupLayer = Math.min(layer, draft.layers.length - 1);
  });
  const names = meta.value.layerNames ? [...meta.value.layerNames] : undefined;
  if (names) {
    names.splice(layer, 1);
    meta.value = { ...meta.value, layerNames: names };
  }
  selectedLayer.value = Math.min(layer, (profile.value?.layers.length ?? 1) - 1);
  selectedSlot.value = null;
}

export function layerName(index: number): string {
  return meta.value.layerNames?.[index]?.trim() || `Layer ${index + 1}`;
}

export function setLayerName(index: number, name: string): void {
  if ((meta.value.layerNames?.[index] ?? '') === name) return;
  const names = [...(meta.value.layerNames ?? [])];
  while (names.length <= index) names.push('');
  names[index] = name;
  recordHistory(`layer-name:${index}`);
  meta.value = { ...meta.value, layerNames: names };
}

// ---------------------------------------------------------------------------
// Offline editing

export function startOffline(variant: Variant): void {
  clearHistory();
  const draft = loadDraft(variant);
  profile.value = draft?.profile ?? defaultProfile(variant);
  meta.value = draft?.meta ?? {};
  baseline.value = null;
  selectedLayer.value = 0;
  selectedSlot.value = null;
  saveState.value = { phase: 'idle' };
  if (draft) notify('info', 'Restored your saved draft from this browser.');
}

export function resetToDefaults(): void {
  const p = profile.value;
  if (!p) return;
  ask({
    title: 'Reset to factory defaults?',
    body: 'All layers, chords and text in the editor will be replaced with the firmware defaults. Nothing is written to the device until you save.',
    actions: [
      { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
      {
        label: 'Reset editor',
        tone: 'danger',
        onSelect: () => {
          recordHistory();
          profile.value = defaultProfile(p.variant);
          meta.value = {};
          selectedLayer.value = 0;
          selectedSlot.value = null;
          closeDialog();
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Device connection

async function attach(transport: Transport, label: string): Promise<void> {
  connection.value = { kind: 'connecting', label };
  const client = new ConfigClient(transport);
  try {
    const info = await client.getInfo();
    if (info.transportVersion !== 1 || info.formatVersion !== 1) {
      throw new ProtocolError(`Firmware speaks transport v${info.transportVersion} / format v${info.formatVersion}; this app supports v1 only.`);
    }
    const status = await client.getStatus();
    const conn: Connection = { transport, client, info, status };
    transport.onDisconnect(() => handleDisconnect(conn));
    connection.value = { kind: 'connected', connection: conn };
    await loadFromDevice({ initial: true });
  } catch (error) {
    await transport.close().catch(() => undefined);
    connection.value = { kind: 'disconnected' };
    notify('error', `Could not connect: ${(error as Error).message}`);
  }
}

export async function connectHid(): Promise<void> {
  if (!hidSupported) {
    notify('error', 'WebHID is not available in this browser. Use desktop Chrome or Edge.');
    return;
  }
  let transport: WebHidTransport | null;
  try {
    transport = await WebHidTransport.request();
  } catch (error) {
    notify('error', `Device selection failed: ${(error as Error).message}`);
    return;
  }
  if (!transport) return; // user cancelled the chooser
  await attach(transport, transport.name);
}

export async function reconnectGranted(): Promise<boolean> {
  if (!hidSupported) return false;
  try {
    const transport = await WebHidTransport.reconnectGranted();
    if (!transport) return false;
    await attach(transport, transport.name);
    return true;
  } catch {
    return false;
  }
}

export async function connectSimulator(variant: Variant, blankFlash = false): Promise<void> {
  const device = new SimulatedDevice({ variant, blankFlash, latency: 4 });
  await attach(device, device.name);
}

export async function disconnect(): Promise<void> {
  const c = connection.value;
  if (c.kind !== 'connected') return;
  await c.connection.transport.close().catch(() => undefined);
  connection.value = { kind: 'disconnected' };
  saveState.value = { phase: 'idle' };
  notify('info', 'Disconnected. Your edits stay in the editor.');
}

function handleDisconnect(conn: Connection): void {
  const c = connection.value;
  if (c.kind !== 'connected' || c.connection !== conn) return;
  connection.value = { kind: 'disconnected' };
  if (saveState.value.phase === 'busy') saveState.value = { phase: 'error', message: 'The device disconnected during the save. Reconnect and save again.' };
  notify('error', 'The macropad was disconnected. Unsaved changes are kept in the editor.');
}

// ---------------------------------------------------------------------------
// Load & save

export async function loadFromDevice(options: { initial?: boolean } = {}): Promise<void> {
  const c = connection.value;
  if (c.kind !== 'connected') return;
  const { client, info } = c.connection;
  try {
    const status = await client.getStatus();
    c.connection.status = status;
    const flash = await client.readFlash();
    deviceFlash.value = flash;
    const decoded = decodeImage(flash, info.variant);
    deviceDecode.value = decoded;

    let fromDevice: Profile;
    if (decoded.ok) {
      fromDevice = decoded.profile;
    } else {
      const active = decodeImage(await client.readActive(), info.variant);
      if (!active.ok) throw new ProtocolError('The device reported an unreadable active configuration.');
      fromDevice = active.profile;
      const header = peekHeader(flash);
      if (decoded.reason === 'unsupported-version') {
        notify('error', `The saved profile uses format version ${header.version}, which this app cannot edit. Saving is disabled; you can export the raw bytes.`, 12000);
      } else if (decoded.reason === 'no-magic') {
        notify('info', 'No saved profile on the device. Showing the built-in defaults it is currently using.', 8000);
      } else {
        notify('error', `The saved profile is invalid (${decoded.detail}) so the device is running defaults. Save to repair it.`, 12000);
      }
    }

    const draft = options.initial ? loadDraft(info.variant) : null;
    const draftDiffers = draft && JSON.stringify(draft.profile) !== JSON.stringify(fromDevice);
    const apply = () => {
      clearHistory();
      profile.value = fromDevice;
      baseline.value = cloneProfile(fromDevice);
      selectedLayer.value = Math.min(selectedLayer.value, fromDevice.layers.length - 1);
      selectedSlot.value = null;
      saveState.value = { phase: 'idle' };
    };

    if (options.initial && profile.value && profile.value.variant === info.variant && dirty.value) {
      // Editor already holds unsaved edits (e.g. offline editing before plugging in).
      const current = profile.value;
      ask({
        title: 'Keep your unsaved edits?',
        body: 'The editor has changes that are not on the device. You can keep editing them, or replace them with the profile stored on the device.',
        actions: [
          { label: 'Keep my edits', tone: 'primary', onSelect: () => { profile.value = current; baseline.value = cloneProfile(fromDevice); closeDialog(); } },
          { label: 'Load from device', tone: 'neutral', onSelect: () => { apply(); closeDialog(); } },
        ],
      });
    } else if (draftDiffers) {
      ask({
        title: 'Restore your draft?',
        body: `This browser has a draft saved ${new Date(draft.savedAt).toLocaleString()} that differs from the device. Which one do you want to edit?`,
        actions: [
          { label: 'Load from device', tone: 'primary', onSelect: () => { apply(); closeDialog(); } },
          { label: 'Use the draft', tone: 'neutral', onSelect: () => { clearHistory(); profile.value = draft.profile; meta.value = draft.meta; baseline.value = cloneProfile(fromDevice); closeDialog(); } },
        ],
      });
    } else {
      if (draft) meta.value = draft.meta;
      apply();
      if (!options.initial) notify('success', 'Loaded the profile from the device.');
    }
  } catch (error) {
    notify('error', `Reading the device failed: ${(error as Error).message}`);
  }
}

export async function save(): Promise<void> {
  const c = connection.value;
  const p = profile.value;
  if (c.kind !== 'connected' || !p) return;
  if (p.variant !== c.connection.info.variant) {
    notify('error', 'This profile is for the other hardware variant and cannot be saved to this device.');
    return;
  }
  if (deviceDecode.value && !deviceDecode.value.ok && deviceDecode.value.reason === 'unsupported-version') {
    ask({
      title: 'Overwrite a newer-format profile?',
      body: 'The device holds a profile in a format this app cannot read. Saving will replace it with a version 1 profile. Export the raw bytes first if you want a backup.',
      actions: [
        { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
        { label: 'Overwrite', tone: 'danger', onSelect: () => { closeDialog(); deviceDecode.value = null; void save(); } },
      ],
    });
    return;
  }
  let image: Uint8Array;
  try {
    image = encodeProfile(p);
  } catch (error) {
    notify('error', (error as Error).message);
    return;
  }
  saveState.value = { phase: 'busy', step: 'uploading', fraction: 0 };
  try {
    await c.connection.client.saveImage(image, (step, fraction) => {
      saveState.value = { phase: 'busy', step, fraction };
    });
    deviceFlash.value = image;
    deviceDecode.value = { ok: true, profile: cloneProfile(p) };
    baseline.value = cloneProfile(p);
    c.connection.status = await c.connection.client.getStatus().catch(() => c.connection.status);
    saveState.value = { phase: 'saved', at: Date.now() };
    clearDraft(p.variant);
    notify('success', 'Saved and verified. All 128 bytes read back from flash match.');
  } catch (error) {
    const message = (error as Error).message;
    saveState.value = { phase: 'error', message };
    notify('error', `Save failed: ${message}`);
    if (connection.value.kind === 'connected') {
      await c.connection.client.abortWrite().catch(() => undefined);
      c.connection.status = await c.connection.client.getStatus().catch(() => c.connection.status);
    }
  }
}

// ---------------------------------------------------------------------------
// Import / export

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(): void {
  const p = profile.value;
  if (!p) return;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(`macropad-${p.variant ? 'three' : 'six'}-key-${stamp}.json`, exportProfile(p, meta.value));
}

export function exportRawFlash(): void {
  const bytes = deviceFlash.value;
  if (!bytes) return;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const blob = new Blob([new Uint8Array(bytes) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `macropad-flash-${new Date().toISOString().slice(0, 10)}.bin`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  void navigator.clipboard?.writeText(hex).catch(() => undefined);
}

export async function importJsonFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const { profile: imported, meta: importedMeta } = importProfile(text);
    const c = connection.value;
    if (c.kind === 'connected' && imported.variant !== c.connection.info.variant) {
      notify('error', `That profile is for the ${imported.variant ? 'three' : 'six'}-key variant, but the connected device has ${c.connection.info.keyCount} keys.`);
      return;
    }
    const applyImport = () => {
      recordHistory();
      profile.value = imported;
      meta.value = importedMeta;
      selectedLayer.value = 0;
      selectedSlot.value = null;
      closeDialog();
      notify('success', `Imported ${file.name}.`);
    };
    if (dirty.value) {
      ask({
        title: 'Replace unsaved edits?',
        body: `Importing ${file.name} will replace the profile in the editor. Unsaved edits will be lost.`,
        actions: [
          { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
          { label: 'Import', tone: 'danger', onSelect: applyImport },
        ],
      });
    } else {
      applyImport();
    }
  } catch (error) {
    notify('error', `Import failed: ${(error as Error).message}`, 12000);
  }
}

// ---------------------------------------------------------------------------
// Persistence of drafts

let draftTimer: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  const p = profile.value;
  const m = meta.value;
  const isDirty = dirty.value;
  if (!p) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (isDirty) storeDraft(p, m);
    else clearDraft(p.variant);
  }, 400);
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (dirty.value && connection.value.kind === 'connected') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

export function selectedKeyCount(): number {
  return profile.value ? keyCount(profile.value.variant) : 6;
}
