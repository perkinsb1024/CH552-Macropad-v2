import { computed, effect, signal } from '@preact/signals';
import type { Action, Chord, Issue, Profile, Slot } from '../model/types';
import { actionNeedsRelease } from '../model/actions';
import { FORMAT_VERSION, MAX_LAYERS, isSupportedFormatVersion, keyCount, type ConfigFormatVersion, type Variant } from '../model/constants';
import { cloneProfile, defaultProfile, emptyLayer } from '../model/defaults';
import { actionProblem, validateProfile } from '../model/validate';
import { layerReachabilityWarnings } from '../model/reachability';
import { selfReferentialLayerWarnings } from '../model/layerWarnings';
import { computeCapacity } from '../model/capacity';
import { encodeProfile } from '../codec/encode';
import { decodeImage, peekHeader, type DecodeResult } from '../codec/decode';
import { ConfigClient, ProtocolError, type SavePhase } from '../protocol/client';
import { WebHidTransport, webHidSupported, type Transport } from '../protocol/transport';
import { SimulatedDevice } from '../protocol/simulator';
import { TRANSPORT_VERSION, type DeviceInfo, type DeviceStatus } from '../protocol/packet';
import { exportProfile, importProfile, type LocalMetadata } from '../io/json';
import { clearDraft, loadDraft, storeDraft } from '../io/drafts';

// ---------------------------------------------------------------------------
// Connection

export interface Connection {
  transport: Transport;
  client: ConfigClient;
  info: DeviceInfo;
  status: DeviceStatus;
  previewSupported: boolean | null;
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
/** The binding currently being moved with native drag and drop. */
export const draggedSlot = signal<Slot | null>(null);
/** The layer currently being moved with native drag and drop. */
export const draggedLayer = signal<number | null>(null);
export type DropPosition = 'before' | 'after' | 'swap';
export const slotDrop = signal<{ slot: Slot; position: DropPosition; rowBoundary?: boolean } | null>(null);
export const layerDrop = signal<{ index: number; position: DropPosition } | null>(null);

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

export const targetFormatVersion = computed(() => {
  const c = connection.value;
  return c.kind === 'connected' ? c.connection.info.formatVersion : FORMAT_VERSION;
});
export const issues = computed<Issue[]>(() => (profile.value ? validateProfile(profile.value, targetFormatVersion.value) : []));
export const reachabilityWarnings = computed(() => (profile.value ? layerReachabilityWarnings(profile.value) : []));
export const layerChangeWarnings = computed(() => (profile.value ? selfReferentialLayerWarnings(profile.value) : []));
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
  return c.kind === 'connected' && isSupportedFormatVersion(c.connection.info.formatVersion) && !!profile.value && encodable.value && profile.value.variant === c.connection.info.variant && saveState.value.phase !== 'busy';
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

export function clearSelectedAction(): void {
  const slot = selectedSlot.value;
  const p = profile.value;
  if (!slot || !p) return;
  const action = getAction(p, slot);
  if (!action) return;
  if (action.type !== 'none') {
    rememberAction(slot, action);
    setAction(slot, { type: 'none' });
  } else if (slot.kind === 'key') {
    updateProfile((draft) => { draft.layers[slot.layer]!.leds[slot.index] = 15; });
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

function sameSlot(a: Slot, b: Slot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRotationSlot(slot: Slot): boolean {
  return slot.kind === 'clockwise' || slot.kind === 'counterclockwise';
}

function slotOrder(p: Profile, slot: Slot): Slot[] | null {
  if (!p.layers[slot.layer]) return null;
  if (slot.kind === 'key') return p.layers[slot.layer]!.keys.map((_, index) => ({ kind: 'key', layer: slot.layer, index }));
  if (slot.kind === 'chord') return p.chords.filter((chord) => chord.layer === slot.layer)
    .sort((a, b) => a.keyA - b.keyA || a.keyB - b.keyB)
    .map((chord) => ({ kind: 'chord', layer: slot.layer, keyA: chord.keyA, keyB: chord.keyB }));
  return [
    { kind: 'clockwise', layer: slot.layer },
    { kind: 'encoderButton', layer: slot.layer },
    { kind: 'counterclockwise', layer: slot.layer },
  ];
}

function insertionOrder<T>(items: T[], source: number, target: number, position: 'before' | 'after'): T[] {
  const next = [...items];
  const [moved] = next.splice(source, 1);
  next.splice(target + (position === 'after' ? 1 : 0) - (source < target + (position === 'after' ? 1 : 0) ? 1 : 0), 0, moved!);
  return next;
}

function insertionIndex(source: number, target: number, position: 'before' | 'after'): number {
  const boundary = target + (position === 'after' ? 1 : 0);
  return boundary - (source < boundary ? 1 : 0);
}

function putAction(p: Profile, slot: Slot, action: Action): void {
  const layer = p.layers[slot.layer];
  if (!layer) return;
  switch (slot.kind) {
    case 'key': layer.keys[slot.index] = action; break;
    case 'encoderButton': layer.encoderButton = action; break;
    case 'clockwise': layer.clockwise = action; break;
    case 'counterclockwise': layer.counterclockwise = action; break;
    case 'chord': {
      const chord = p.chords.find((c) => c.layer === slot.layer && c.keyA === slot.keyA && c.keyB === slot.keyB);
      if (chord) chord.action = action;
    }
  }
}

const ACTION_CLIPBOARD_FORMAT = 'universal-macropad-action';

export function copySelectedConfiguration(): string | null {
  const p = profile.value;
  const slot = selectedSlot.value;
  if (!p || !slot) return null;
  const action = getAction(p, slot);
  if (!action) return null;
  return JSON.stringify({
    format: ACTION_CLIPBOARD_FORMAT,
    version: 1,
    action,
    led: slot.kind === 'key' ? p.layers[slot.layer]!.leds[slot.index] : undefined,
  });
}

export function cutSelectedConfiguration(): void {
  const p = profile.value;
  const slot = selectedSlot.value;
  if (!p || !slot) return;
  const action = getAction(p, slot);
  if (!action) return;
  rememberAction(slot, action);
  updateProfile((draft) => {
    putAction(draft, slot, { type: 'none' });
    if (slot.kind === 'key') draft.layers[slot.layer]!.leds[slot.index] = 15;
  });
}

/** Returns false for clipboard text belonging to another application. */
export function pasteSelectedConfiguration(text: string): boolean {
  const p = profile.value;
  const slot = selectedSlot.value;
  if (!p || !slot || !getAction(p, slot)) return false;
  let copied: { format?: string; version?: number; action?: Action; led?: number };
  try {
    copied = JSON.parse(text);
    if (!copied || copied.format !== ACTION_CLIPBOARD_FORMAT || copied.version !== 1 || !copied.action) return false;
    if (copied.led !== undefined && (!Number.isInteger(copied.led) || copied.led < 0 || copied.led > 15)) return false;
    const problem = actionProblem(copied.action, { layerCount: p.layers.length, rotation: isRotationSlot(slot) });
    if (problem) {
      notify('error', `Cannot paste here: ${problem}`);
      return true;
    }
  } catch {
    return false;
  }
  const action = copied.action;
  rememberAction(slot, getAction(p, slot)!);
  updateProfile((draft) => {
    putAction(draft, slot, action);
    if (slot.kind === 'key' && copied.led !== undefined) draft.layers[slot.layer]!.leds[slot.index] = copied.led;
  });
  return true;
}

/** Whether moving either binding to the other input would be valid. */
export function canSwapSlots(source: Slot, target: Slot): boolean {
  const p = profile.value;
  if (!p || sameSlot(source, target)) return false;
  const sourceAction = getAction(p, source);
  const targetAction = getAction(p, target);
  if (!sourceAction || !targetAction) return false;
  return !(isRotationSlot(target) && actionNeedsRelease(sourceAction)) &&
    !(isRotationSlot(source) && actionNeedsRelease(targetAction));
}

export function canInsertSlot(source: Slot, target: Slot, position: 'before' | 'after'): boolean {
  const p = profile.value;
  if (!p || source.layer !== target.layer || source.kind !== target.kind &&
      !(source.kind !== 'key' && source.kind !== 'chord' && target.kind !== 'key' && target.kind !== 'chord')) return false;
  const order = slotOrder(p, source);
  if (!order) return false;
  const sourceIndex = order.findIndex((slot) => sameSlot(slot, source));
  const targetIndex = order.findIndex((slot) => sameSlot(slot, target));
  if (sourceIndex < 0 || targetIndex < 0 || insertionIndex(sourceIndex, targetIndex, position) === sourceIndex) return false;
  const actions = order.map((slot) => getAction(p, slot));
  if (actions.some((action) => !action)) return false;
  return insertionOrder(actions as Action[], sourceIndex, targetIndex, position)
    .every((action, index) => !isRotationSlot(order[index]!) || !actionNeedsRelease(action));
}

export function insertSlotAction(source: Slot, target: Slot, position: 'before' | 'after'): void {
  if (!canInsertSlot(source, target, position)) return;
  const order = slotOrder(profile.value!, source)!;
  const sourceIndex = order.findIndex((slot) => sameSlot(slot, source));
  const targetIndex = order.findIndex((slot) => sameSlot(slot, target));
  const destination = insertionIndex(sourceIndex, targetIndex, position);
  updateProfile((draft) => {
    const actions = insertionOrder(order.map((slot) => getAction(draft, slot)!), sourceIndex, targetIndex, position);
    order.forEach((slot, index) => putAction(draft, slot, actions[index]!));
    if (source.kind === 'key') {
      const layer = draft.layers[source.layer]!;
      layer.leds = insertionOrder(layer.leds, sourceIndex, targetIndex, position);
    }
  });
  selectedSlot.value = order[destination]!;
}

/** Swaps the actions on two inputs. Key-to-key moves include their LED colors. */
export function swapSlotActions(source: Slot, target: Slot): void {
  if (!canSwapSlots(source, target)) return;
  updateProfile((draft) => {
    const get = (slot: Slot): Action | undefined => getAction(draft, slot);
    const sourceAction = get(source);
    const targetAction = get(target);
    if (!sourceAction || !targetAction) return;
    putAction(draft, source, targetAction);
    putAction(draft, target, sourceAction);
    if (source.kind === 'key' && target.kind === 'key') {
      const sourceLayer = draft.layers[source.layer]!;
      const targetLayer = draft.layers[target.layer]!;
      [sourceLayer.leds[source.index], targetLayer.leds[target.index]] = [targetLayer.leds[target.index]!, sourceLayer.leds[source.index]!];
    }
  });
  selectedSlot.value = target;
}

function layerOrder(count: number, source: number, target: number, position: 'before' | 'after'): number[] {
  return insertionOrder(Array.from({ length: count }, (_, index) => index), source, target, position);
}

function applyLayerOrder(order: number[]): void {
  const p = profile.value;
  if (!p || order.every((oldIndex, newIndex) => oldIndex === newIndex)) return;
  const remap = (oldIndex: number) => {
    const mapped = order.indexOf(oldIndex);
    return mapped < 0 ? oldIndex : mapped;
  };
  updateProfile((draft) => {
    draft.layers = order.map((oldIndex) => draft.layers[oldIndex]!);
    draft.chords = draft.chords.map((chord) => ({ ...chord, layer: remap(chord.layer) }));
    const updateTarget = (action: Action): Action => (
      action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer'
        ? { ...action, layer: remap(action.layer) }
        : action
    );
    for (const layer of draft.layers) {
      layer.keys = layer.keys.map(updateTarget);
      layer.encoderButton = updateTarget(layer.encoderButton);
      layer.clockwise = updateTarget(layer.clockwise);
      layer.counterclockwise = updateTarget(layer.counterclockwise);
    }
    for (const chord of draft.chords) chord.action = updateTarget(chord.action);
    draft.startupLayer = remap(draft.startupLayer);
  });
  selectedLayer.value = remap(selectedLayer.value);
  if (selectedSlot.value) selectedSlot.value = { ...selectedSlot.value, layer: remap(selectedSlot.value.layer) } as Slot;
}

export function canInsertLayer(source: number, target: number, position: 'before' | 'after'): boolean {
  const p = profile.value;
  return !!p && !!p.layers[source] && !!p.layers[target] && insertionIndex(source, target, position) !== source;
}

export function insertLayer(source: number, target: number, position: 'before' | 'after'): void {
  if (!canInsertLayer(source, target, position)) return;
  applyLayerOrder(layerOrder(profile.value!.layers.length, source, target, position));
}

/** Swaps two layer configurations while keeping layer-targeting actions attached to those configurations. */
export function swapLayers(source: number, target: number): void {
  const p = profile.value;
  if (!p || source === target || !p.layers[source] || !p.layers[target]) return;
  const order = Array.from({ length: p.layers.length }, (_, index) => index);
  [order[source], order[target]] = [order[target]!, order[source]!];
  applyLayerOrder(order);
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

export function setChordGlobal(chord: Pick<Chord, 'layer' | 'keyA' | 'keyB'>, global: boolean, layer: number): void {
  const p = profile.value;
  if (!p) return;
  const samePair = (c: Chord) => c.keyA === chord.keyA && c.keyB === chord.keyB;
  if (global && p.chords.some((c) => c.global && samePair(c))) return;
  if (!global && p.chords.some((c) => c.layer === layer && samePair(c) && c.layer !== chord.layer)) return;
  updateProfile((draft) => {
    const target = draft.chords.find((c) => c.layer === chord.layer && samePair(c));
    if (target) { target.global = global; if (!global) target.layer = layer; }
  });
  selectedSlot.value = { kind: 'chord', layer: global ? chord.layer : layer, keyA: chord.keyA, keyB: chord.keyB };
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
        .filter((chord) => chord.layer === sourceIndex && !chord.global)
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
    if ((a.type === 'setLayer' || a.type === 'oneShotSetLayer' || a.type === 'momentaryLayer') && a.layer === layer) actions++;
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
      if ((a.type === 'setLayer' || a.type === 'oneShotSetLayer' || a.type === 'momentaryLayer') && a.layer > layer) return { ...a, layer: a.layer - 1 };
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
  return `Layer ${index + 1}`;
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
    title: 'Reset to the starter profile?',
    body: 'All layers, chords and text in the editor will be replaced with the starter profile. Nothing is written to the device until you save.',
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

/** Publish status through the signal, and ignore replies from an old connection. */
function updateDeviceStatus(conn: Connection, status: DeviceStatus): void {
  const c = connection.peek();
  if (c.kind !== 'connected' || c.connection !== conn) return;
  conn.status = status;
  connection.value = { ...c };
}

// Poll serially so slow replies cannot accumulate queued status requests.
// Signal updates restart this effect; disconnect/reconnect cancels the old loop.
effect(() => {
  const c = connection.value;
  if (c.kind !== 'connected') return;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      if (saveState.peek().phase !== 'busy') {
        const status = await c.connection.client.getStatus();
        if (!stopped) updateDeviceStatus(c.connection, status);
      }
    } catch {
      // Keep the last known status on a transient failure and try again later.
    } finally {
      if (!stopped) timer = setTimeout(poll, 500);
    }
  };
  timer = setTimeout(poll, 500);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
});

async function attach(transport: Transport, label: string): Promise<void> {
  connection.value = { kind: 'connecting', label };
  const client = new ConfigClient(transport);
  try {
    const info = await client.getInfo();
    if (info.transportVersion !== TRANSPORT_VERSION || !isSupportedFormatVersion(info.formatVersion)) {
      throw new ProtocolError(`Firmware speaks transport v${info.transportVersion} / format v${info.formatVersion}; this app reads formats 2 and ${FORMAT_VERSION} over transport v${TRANSPORT_VERSION}.`);
    }
    const status = await client.getStatus();
    const previewSupported = await client.detectPreviewSupport();
    const conn: Connection = { transport, client, info, status, previewSupported };
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

export async function connectSimulator(variant: Variant, blankFlash = false, formatVersion: ConfigFormatVersion = FORMAT_VERSION): Promise<void> {
  const device = new SimulatedDevice({ variant, blankFlash, formatVersion, latency: 4 });
  await attach(device, device.name);
}

export async function previewColor(color: number, fullBrightness = true, rainbow = false): Promise<void> {
  const c = connection.value;
  if (c.kind !== 'connected' || c.connection.previewSupported === false) return;
  try {
    await c.connection.client.previewColor(color, fullBrightness, rainbow);
  } catch (error) {
    notify('error', `Color preview failed: ${(error as Error).message}`);
  }
}

export async function cancelPreview(): Promise<void> {
  const c = connection.value;
  if (c.kind !== 'connected' || c.connection.previewSupported === false) return;
  try {
    await c.connection.client.cancelPreview();
  } catch (error) {
    notify('error', `Cancel preview failed: ${(error as Error).message}`);
  }
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
    updateDeviceStatus(c.connection, status);
    const flash = await client.readFlash();
    deviceFlash.value = flash;
    const decoded = decodeImage(flash, info.variant);
    deviceDecode.value = decoded;

    let fromDevice: Profile;
    if (decoded.ok) {
      fromDevice = decoded.profile;
      if (peekHeader(flash).version === 2 && info.formatVersion === FORMAT_VERSION) {
        notify('info', 'Version 2 profile upgraded in the editor: Blink once becomes On for 1.5 seconds, and transparency is off. Save to apply it to this format 3 device.', 12000);
      }
    } else {
      fromDevice = defaultProfile(info.variant);
      const header = peekHeader(flash);
      if (decoded.reason === 'unsupported-version') {
        notify('error', `The saved profile uses format version ${header.version}, which this app cannot edit. You can export the raw bytes or replace the profile when saving.`, 12000);
      } else if (decoded.reason === 'no-magic') {
        notify('info', 'No profile is saved. The device is inactive until you save one; the editor loaded a starter profile.', 8000);
      } else {
        notify('error', `The saved profile is invalid (${decoded.detail}). The device is inactive; the editor loaded a starter profile that you can save to repair it.`, 12000);
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
  if (!isSupportedFormatVersion(c.connection.info.formatVersion)) {
    notify('error', `This editor supports saving configuration formats v2 and v${FORMAT_VERSION}.`);
    return;
  }
  if (p.variant !== c.connection.info.variant) {
    notify('error', 'This profile is for the other hardware variant and cannot be saved to this device.');
    return;
  }
  if (deviceDecode.value && !deviceDecode.value.ok && deviceDecode.value.reason === 'unsupported-version' &&
      deviceFlash.value && peekHeader(deviceFlash.value).version > FORMAT_VERSION) {
    ask({
      title: 'Overwrite a newer profile?',
      body: `The device holds a profile in a format this app cannot read. Saving will replace it with a version ${FORMAT_VERSION} profile. Export the raw bytes first if you want a backup.`,
      actions: [
        { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
        { label: 'Overwrite', tone: 'danger', onSelect: () => { closeDialog(); deviceDecode.value = null; void save(); } },
      ],
    });
    return;
  }
  let image: Uint8Array;
  try {
    image = encodeProfile(p, c.connection.info.formatVersion);
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
    updateDeviceStatus(c.connection, await c.connection.client.getStatus().catch(() => c.connection.status));
    saveState.value = { phase: 'saved', at: Date.now() };
    clearDraft(p.variant);
    notify('success', 'Saved and verified. All 128 bytes read back from flash match.');
  } catch (error) {
    const message = (error as Error).message;
    saveState.value = { phase: 'error', message };
    notify('error', `Save failed: ${message}`);
    if (connection.value.kind === 'connected') {
      await c.connection.client.abortWrite().catch(() => undefined);
      updateDeviceStatus(c.connection, await c.connection.client.getStatus().catch(() => c.connection.status));
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
