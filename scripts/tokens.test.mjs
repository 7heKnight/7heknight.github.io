// The design system's contrast guarantee: every foreground/background pair the UI
// uses must reach WCAG AA, computed from the values declared in tokens.css.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|[\\d.]+)\\s*;`).exec(css);
  assert.ok(m, `token --${name} not found in tokens.css`);
  return m[1];
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const AA = 4.5;
const surfaces = ['bg', 'bg-alt', 'bg-elev', 'bg-sunken'];

test('body, accent and muted text meet AA on every surface they appear on', () => {
  for (const s of surfaces) {
    for (const fg of ['text', 'accent', 'muted']) {
      assert.ok(ratio(rgb(token(fg)), rgb(token(s))) >= AA, `--${fg} on --${s}`);
    }
  }
});

test('specific pairs: inline code, quotes, active nav, hovered tag', () => {
  assert.ok(ratio(rgb(token('code-inline')), rgb(token('bg-sunken'))) >= AA, 'inline code');
  assert.ok(ratio(rgb(token('text-soft')), rgb(token('bg-alt'))) >= AA, 'blockquote text');
  assert.ok(ratio(rgb(token('text-on-accent')), rgb(token('accent'))) >= AA, 'active nav / hovered tag');
  assert.ok(ratio(rgb(token('text-strong')), rgb(token('bg-alt'))) >= AA, 'strong text');
});

test('status badges (ok / warn / danger) meet AA on their tinted fill', () => {
  const alpha = Number(token('tint-alpha'));
  for (const status of ['ok', 'warn', 'danger']) {
    for (const surface of ['bg', 'bg-alt']) { // post header, cards
      const fg = rgb(token(status));
      const fill = mix(fg, alpha, rgb(token(surface)));
      assert.ok(ratio(fg, fill) >= AA, `--${status} on its tint over --${surface} (${ratio(fg, fill).toFixed(2)})`);
    }
  }
});

test('every token the stylesheet references is defined', () => {
  const global = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const used = new Set([...global.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
  defined.add('c'); // badge-local custom property, set in global.css
  const undefinedTokens = [...used].filter((t) => !defined.has(t));
  assert.deepEqual(undefinedTokens, []);
});
