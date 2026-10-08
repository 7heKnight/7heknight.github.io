#!/usr/bin/env node
// Tells IndexNow-enabled search engines (Bing, Yandex, Naver, Seznam, Yep; not
// Google) about posts added, changed or removed between two commits. Runs in
// CI after a successful Pages deploy; needs no webmaster account because the
// key file in public/ is the proof of ownership (it is public by design).
//
//   node scripts/indexnow.mjs --base <sha> --head <sha> [--dry-run]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { SECTIONS } from '../src/content/taxonomy.mjs';

const ORIGIN = 'https://7heknight.github.io';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const POST_PATH = new RegExp(`^src/content/(${Object.keys(SECTIONS).join('|')})/([^/]+)\\.md$`);

// `git diff --name-only` lines -> absolute URLs whose content changed: each
// post plus its section index and the home page (both list it).
export function urlsFor(paths) {
  const urls = new Set();
  for (const path of paths) {
    const m = POST_PATH.exec(path);
    if (!m) continue;
    urls.add(`${ORIGIN}/${m[1]}/${m[2]}/`); // slug == kebab-case file name (see CLAUDE.md)
    urls.add(`${ORIGIN}/${m[1]}/`);
    urls.add(`${ORIGIN}/`);
  }
  return [...urls];
}

function findKey() {
  const file = readdirSync('public').find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
  if (!file) throw new Error('No IndexNow key file (public/<32 hex>.txt) found');
  const key = file.slice(0, -4);
  if (readFileSync(`public/${file}`, 'utf8').trim() !== key)
    throw new Error(`public/${file} must contain exactly its own file name`);
  return key;
}

// The deploy step can return before the CDN serves the key file; engines
// reject the submission if they cannot fetch it, so wait for it first.
async function waitForKey(url, attempts = 12, delayMs = 10_000) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Key file not reachable: ${url}`);
}

async function main() {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const base = arg('--base');
  const head = arg('--head') ?? 'HEAD';
  if (!base || /^0+$/.test(base)) return console.log('No base commit (first push or manual run); nothing to submit.');

  const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', base, head, '--', 'src/content'], {
    encoding: 'utf8',
  }).split('\n').filter(Boolean);
  const urlList = urlsFor(changed);
  if (urlList.length === 0) return console.log('No content changes; nothing to submit.');

  const key = findKey();
  const payload = { host: new URL(ORIGIN).host, key, keyLocation: `${ORIGIN}/${key}.txt`, urlList };
  console.log(`Submitting ${urlList.length} URL(s):\n  ${urlList.join('\n  ')}`);
  if (process.argv.includes('--dry-run')) return;

  await waitForKey(payload.keyLocation);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  console.log(`IndexNow responded ${res.status} ${res.statusText}`);
  if (res.status !== 200 && res.status !== 202) throw new Error(await res.text());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
