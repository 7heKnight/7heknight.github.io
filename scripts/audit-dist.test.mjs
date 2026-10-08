// Mutation test: the dist audit must fail on each class of defect it claims to
// catch, otherwise a green audit would prove nothing. Runs on a temp copy of dist/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const audit = (dir) => spawnSync(process.execPath, ['scripts/audit-dist.mjs'], { encoding: 'utf8', env: { ...process.env, DIST_DIR: dir } });
const post = 'writeups/hidden-function/index.html';
const other = 'writeups/aslr-bruteforce/index.html';

const mutations = {
  'removed sitemap entry': (d) => edit(d, 'sitemap-index.xml', (s) => s.replace(/<url><loc>[^<]*hidden-function\/<\/loc>.*?<\/url>\n?/, '')),
  'wrong canonical': (d) => edit(d, post, (s) => s.replace(/(rel="canonical" href=")[^"]*/, '$1https://example.com/')),
  'duplicate description': (d) => {
    const desc = /<meta name="description" content="(.*?)"/.exec(readFileSync(join(d, other), 'utf8'))[1];
    edit(d, post, (s) => s.replace(/(<meta name="description" content=")[^"]*/, `$1${desc}`));
  },
  'broken internal link': (d) => edit(d, post, (s) => s.replace('</main>', '<a href="/no-such-page/">x</a></main>')),
  'filename alt text': (d) => edit(d, post, (s) => s.replace(/alt="[^"]*"/, 'alt="image1.png"')),
  'image without dimensions': (d) => edit(d, post, (s) => s.replace(/ width="\d+" height="\d+"/, '')),
  'missing BlogPosting': (d) => edit(d, post, (s) => s.replaceAll('BlogPosting', 'Thing')),
  'noindex page left in sitemap': (d) => edit(d, 'about/index.html', (s) => s.replace('<link rel="canonical"', '<meta name="robots" content="noindex,follow"><link rel="canonical"')),
  'robots.txt without sitemap': (d) => edit(d, 'robots.txt', () => 'User-agent: *\nAllow: /\n'),
  'RSS missing a post': (d) => edit(d, 'rss.xml', (s) => s.replace(/<item>.*?<\/item>/s, '')),
};
const edit = (dir, file, fn) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));

test('the unmodified build passes the audit', () => {
  const r = audit('dist');
  assert.equal(r.status, 0, r.stdout);
});

for (const [name, mutate] of Object.entries(mutations)) {
  test(`audit fails on: ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-audit-'));
    try {
      cpSync('dist', dir, { recursive: true });
      mutate(dir);
      const r = audit(dir);
      assert.equal(r.status, 1, `audit did not fail for "${name}"\n${r.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
