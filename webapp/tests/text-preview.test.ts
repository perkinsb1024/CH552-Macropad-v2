import { expect, it } from 'vitest';
import { visibleText } from '../src/model/strings';
import { summarize, actionTooltip } from '../src/model/actions';

it('leaves isolated internal spaces plain', () => {
  expect(visibleText('hello world')).toBe('hello world');
  expect(visibleText('hello\tworld')).toBe('hello⇥world');
  expect(visibleText('')).toBe('');
});

it('reveals all spaces for boundary whitespace or consecutive whitespace', () => {
  for (const [text, expected] of [
    [' hello world', '␣hello␣world'],
    ['hello world ', 'hello␣world␣'],
    ['hello  wide world', 'hello␣␣wide␣world'],
    ['hello world\n', 'hello␣world↵'],
    ['\thello world', '⇥hello␣world'],
    ['hello \twide world', 'hello␣⇥wide␣world'],
    ['hello\n\twide world', 'hello↵⇥wide␣world'],
    ['hello world\r\n', 'hello␣world↵'],
  ]) expect(visibleText(text!)).toBe(expected);
});

it('uses the full string to decide visibility before truncating summaries', () => {
  const action = { type: 'string', text: 'hello world with trailing whitespace ' } as const;
  expect(summarize(action)).toBe('“hello␣world␣w…”');
  expect(actionTooltip(action)).toBe('Type text: “hello␣world␣with␣trailing␣whitespace␣”');
  expect(summarize({ type: 'string', text: 'hello world longer' })).toBe('“hello world l…”');
});
