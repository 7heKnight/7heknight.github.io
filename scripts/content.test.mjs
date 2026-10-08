import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { SECTIONS } from '../src/content/taxonomy.mjs';
import { parsePost, renderPost, slugify, validatePost } from './lib/content.mjs';

const base = (section) => ({
  title: 'A "quoted" title: with & symbols',
  date: '2026-01-02',
  category: Object.keys(SECTIONS[section].categories)[0],
  difficulty: 'beginner',
  tags: ['alpha', 'CVE-2026-0001', 'two words'],
  excerpt: 'An excerpt that is comfortably longer than the fifty character minimum.',
  draft: true,
  source: 'INE',
  platform: 'Android',
});
const errors = (section, slug, fm, body) => validatePost(section, slug, fm, body).filter((i) => i.level === 'error');

test('slugify produces kebab-case URL slugs', () => {
  assert.equal(slugify('Tools & Scripts'), 'tools-and-scripts');
  assert.equal(slugify('  Héllo,  Wörld!! '), 'hello-world');
  assert.equal(slugify('CVE-2025-54309: CrushFTP AS2 Auth Bypass'), 'cve-2025-54309-crushftp-as2-auth-bypass');
});

for (const section of Object.keys(SECTIONS)) {
  test(`generated ${section} post is valid against the build schema`, () => {
    const { fm, body } = parsePost(renderPost(section, base(section)));
    assert.deepEqual(errors(section, 'a-quoted-title', fm, body), []);
    assert.equal(fm.title, 'A "quoted" title: with & symbols'); // round-trips through YAML
    assert.deepEqual(fm.tags, ['alpha', 'CVE-2026-0001', 'two words']);
  });
}

test('linter rejects what the build schema or conventions forbid', () => {
  const ok = parsePost(renderPost('writeups', base('writeups')));
  const bad = (patch) => errors('writeups', 'x', { ...ok.fm, ...patch }, ok.body).map((e) => e.msg).join('\n');
  assert.match(bad({ category: 'nope' }), /category/);
  assert.match(bad({ difficulty: 'expert' }), /difficulty/);
  assert.match(bad({ date: '02/01/2026' }), /date/);
  assert.match(bad({ updated: '2025-12-31' }), /updated/);
  assert.match(bad({ excerpt: 'too short' }), /excerpt/);
  assert.match(bad({ tags: [] }), /tags/);
  assert.match(bad({ tag: ['typo'] }), /Unrecognized key/); // strict schema: typos are errors
  assert.match(bad({ source: undefined }), /source/);
  assert.match(bad({ cover: '/writeups/other/pic.png' }), /cover/);
  assert.match(errors('writeups', 'Not_Kebab', ok.fm, ok.body).map((e) => e.msg).join(), /kebab-case/);
  assert.match(errors('pentest', 'x', { ...base('pentest'), series: 'S' }, ok.body).map((e) => e.msg).join(), /seriesOrder/);
});

test('body rules: disclaimer required, TODO placeholders block publishing', () => {
  const { fm, body } = parsePost(renderPost('redteam', base('redteam')));
  assert.match(errors('redteam', 'x', fm, '## Overview\n\ntext').map((e) => e.msg).join(), /disclaimer/);
  assert.deepEqual(errors('redteam', 'x', { ...fm, draft: true }, body), []);
  assert.match(errors('redteam', 'x', { ...fm, draft: false }, body).map((e) => e.msg).join(), /TODO/);
});

test('CLI: scaffolds via --dry-run and rejects invalid input without writing', () => {
  const run = (...args) => spawnSync(process.execPath, ['scripts/new.mjs', ...args], { encoding: 'utf8', stdin: 'ignore' });
  const ok = run('pentest', 'CLI Smoke Test', '--category', 'fundamentals', '--difficulty', 'beginner',
    '--excerpt', 'A generated post used to prove the CLI output is accepted by the validator.', '--tags', 'android,cli', '--dry-run');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /src\/content\/pentest\/cli-smoke-test\.md/);
  assert.match(ok.stdout, /draft: true/);
  const badCategory = run('pentest', 'X Y', '--category', 'nope', '--difficulty', 'beginner', '--excerpt', 'long enough excerpt '.repeat(4), '--tags', 'a', '--dry-run');
  assert.equal(badCategory.status, 1);
  assert.match(badCategory.stderr, /category/);
  assert.equal(run('nonsense', 'Title').status, 1);
  assert.equal(run('writeups', 'No Options').status, 1); // non-TTY: missing required options is an error, never a prompt
});
