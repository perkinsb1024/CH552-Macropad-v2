import { describe, expect, it } from 'vitest';
import { profileChanges as changesWithUndo } from '../src/model/changes';
import { cloneProfile, defaultProfile, emptyLayer } from '../src/model/defaults';
import { LayerIndicatorBehavior } from '../src/model/constants';
import { baseline, profile, undo, updateProfile } from '../src/ui/store';

// Compare display text separately from the callbacks exercised below.
const profileChanges = (...args: Parameters<typeof changesWithUndo>) =>
  changesWithUndo(...args).map(({ undo: _undo, ...description }) => description);

describe('unsaved profile changes', () => {
  it('shows net edits and removes changes after they are reverted or saved', () => {
    const saved = defaultProfile(0);
    saved.layers[0]!.leds[0] = 0;
    const edited = cloneProfile(saved);
    edited.layers[0]!.leds[0] = 1;
    expect(profileChanges(saved, edited)).toContainEqual({ where: 'Layer 1 · Key 1 color', before: 'Red', after: 'Coral' });
    edited.layers[0]!.leds[0] = saved.layers[0]!.leds[0]!;
    expect(profileChanges(saved, edited)).toEqual([]);
    expect(profileChanges(edited, cloneProfile(edited))).toEqual([]);
  });

  it('covers bindings, encoder actions and every layer option', () => {
    const saved = defaultProfile(0);
    saved.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.None;
    const edited = cloneProfile(saved);
    const layer = edited.layers[0]!;
    layer.keys[0] = { type: 'string', text: 'A long string that should appear in full\nwith a newline' };
    layer.encoderButton = { type: 'none' };
    layer.clockwise = { type: 'mouseX', delta: 10 };
    layer.counterclockwise = { type: 'mouseY', delta: -10, hold: true };
    layer.indicatorBehavior = LayerIndicatorBehavior.AlwaysOn;
    layer.indicatorColor = 15;
    layer.indicatorFullBrightness = !saved.layers[0]!.indicatorFullBrightness;
    layer.bootloaderFromRun = !saved.layers[0]!.bootloaderFromRun;
    const changes = profileChanges(saved, edited);
    expect(changes.map((change) => change.where)).toEqual([
      'Layer 1 · Key 1', 'Layer 1 · Encoder button', 'Layer 1 · Clockwise',
      'Layer 1 · Counterclockwise', 'Layer 1 · Layer selection LEDs',
      'Layer 1 · Indicator color', 'Layer 1 · Indicator brightness',
      'Layer 1 · Encoder bootloader entry',
    ]);
    expect(changes[0]!.after).toBe(`Type ${JSON.stringify(layer.keys[0].text)}`);
    expect(changes.find((change) => change.where.endsWith('Indicator color'))!.after).toBe('Rainbow');
  });

  it('describes profile settings and added or removed layers', () => {
    const saved = defaultProfile(0);
    saved.layers = [saved.layers[0]!];
    const edited = cloneProfile(saved);
    edited.layers.push(emptyLayer(0));
    edited.startupLayer = 1;
    edited.transparentBlack = !saved.transparentBlack;
    edited.chordWindow = 0;
    expect(profileChanges(saved, edited)).toEqual(expect.arrayContaining([
      { where: 'Startup layer', before: 'Layer 1', after: 'Layer 2' },
      { where: 'Chord window', before: `${saved.chordWindow * 5} ms`, after: 'Disabled' },
      { where: 'Layer 2', after: 'Added' },
    ]));
    expect(profileChanges(edited, saved)).toContainEqual({ where: 'Layer 2', before: 'Removed' });
  });

  it('matches chords by scope and key pair, independent of list order', () => {
    const saved = defaultProfile(0);
    saved.chords = [
      { layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } },
      { layer: 0, keyA: 1, keyB: 2, global: true, action: { type: 'none' } },
    ];
    const edited = cloneProfile(saved);
    edited.chords.reverse();
    expect(profileChanges(saved, edited)).toEqual([{ where: 'Chord order updated' }]);
    edited.chords[0]!.action = { type: 'string', text: 'Hello' };
    edited.chords[1]!.global = true;
    const changes = profileChanges(saved, edited);
    expect(changes).toContainEqual({ where: 'All layers · Chord 2 + 3', before: 'Nothing', after: 'Type "Hello"' });
    expect(changes).toContainEqual({ where: 'Layer 1 · Chord 1 + 2', before: 'Nothing', after: 'Removed' });
    expect(changes).toContainEqual({ where: 'All layers · Chord 1 + 2', before: 'Not assigned', after: 'Nothing' });
  });

  it('explains when no comparison baseline exists', () => {
    expect(profileChanges(null, defaultProfile(1))).toEqual([
      { where: 'Entire profile is unsaved. No saved device profile is available to compare with.' },
    ]);
  });

  it('undoes each field independently without modifying the baseline', () => {
    const saved = defaultProfile(0);
    const original = cloneProfile(saved);
    const edited = cloneProfile(saved);
    edited.startupLayer = 1;
    edited.chordWindow = 0;
    edited.transparentBlack = !saved.transparentBlack;
    const layer = edited.layers[0]!;
    layer.keys[0] = { type: 'none' };
    layer.leds[0] = 1;
    layer.encoderButton = { type: 'none' };
    layer.clockwise = { type: 'none' };
    layer.counterclockwise = { type: 'none' };
    layer.indicatorColor = 15;
    layer.indicatorBehavior = LayerIndicatorBehavior.None;
    layer.indicatorFullBrightness = !saved.layers[0]!.indicatorFullBrightness;
    layer.bootloaderFromRun = !saved.layers[0]!.bootloaderFromRun;
    const entries = changesWithUndo(saved, edited);
    for (const entry of entries) {
      const draft = cloneProfile(edited);
      expect(entry.undo).toBeTypeOf('function');
      entry.undo!(draft);
      const remaining = changesWithUndo(saved, draft);
      expect(remaining.map((change) => change.where)).toEqual(entries.filter((change) => change.where !== entry.where).map((change) => change.where));
    }
    expect(saved).toEqual(original);
  });

  it('restores removed layers and removes added layers with their chords', () => {
    const saved = defaultProfile(0);
    const edited = cloneProfile(saved);
    edited.layers.push(emptyLayer(0));
    edited.chords.push({ layer: 2, keyA: 0, keyB: 1, action: { type: 'none' } });
    changesWithUndo(saved, edited).find((change) => change.where === 'Layer 3')!.undo!(edited);
    expect(edited).toEqual(saved);
    const reduced = cloneProfile(saved);
    reduced.layers.pop();
    reduced.layers[0]!.leds[0] = 1;
    changesWithUndo(saved, reduced).find((change) => change.where === 'Layer 2')!.undo!(reduced);
    expect(reduced.layers[1]).toEqual(saved.layers[1]);
    expect(reduced.layers[0]!.leds[0]).toBe(1);
  });

  it('undoes chord edits, additions, removals and scope changes', () => {
    const saved = defaultProfile(0);
    saved.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'string', text: 'saved' } }];
    const edited = cloneProfile(saved);
    edited.chords[0]!.action = { type: 'none' };
    edited.chords.push({ layer: 1, keyA: 1, keyB: 2, action: { type: 'none' } });
    changesWithUndo(saved, edited).find((change) => change.where === 'Layer 1 · Chord 1 + 2')!.undo!(edited);
    expect(edited.chords[0]!.action).toEqual(saved.chords[0]!.action);
    expect(edited.chords).toHaveLength(2);
    changesWithUndo(saved, edited)[0]!.undo!(edited);
    expect(edited).toEqual(saved);
    edited.chords[0]!.global = true;
    changesWithUndo(saved, edited).find((change) => change.after === 'Removed')!.undo!(edited);
    expect(edited).toEqual(saved);
    edited.chords = [];
    changesWithUndo(saved, edited)[0]!.undo!(edited);
    expect(edited).toEqual(saved);
  });

  it('does not show a second color edit solely because Off became Rainbow', () => {
    const saved = defaultProfile(0);
    saved.layers[0]!.indicatorColor = 15;
    saved.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.None;
    const edited = cloneProfile(saved);
    edited.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.AlwaysOn;
    expect(changesWithUndo(saved, edited).map((change) => change.where)).toEqual(['Layer 1 · Layer selection LEDs']);
  });

  it('records a row revert in the main undo history', () => {
    const saved = defaultProfile(0);
    baseline.value = cloneProfile(saved);
    profile.value = cloneProfile(saved);
    updateProfile((draft) => { draft.layers[0]!.leds[0] = 1; });
    updateProfile(changesWithUndo(baseline.value, profile.value!)[0]!.undo!);
    expect(profile.value).toEqual(saved);
    undo();
    expect(profile.value!.layers[0]!.leds[0]).toBe(1);
    expect(baseline.value).toEqual(saved);
  });
});
