#!/usr/bin/env node
// Lints every post under src/content against the build schemas plus the
// project's content conventions. Exit 1 on any error; warnings are listed only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { SECTIONS } from '../src/content/taxonomy.mjs';
import { ROOT, parsePost, validatePost } from './lib/content.mjs';

let errors = 0;
let warnings = 0;
let posts = 0;
const titles = new Map();

for (const section of Object.keys(SECTIONS)) {
  const dir = new URL(`src/content/${section}/`, ROOT);
  for (const name of readdirSync(dir).sort()) {
    const file = `src/content/${section}/${name}`;
    const report = (level, msg) => {
      level === 'error' ? errors++ : warnings++;
      console.log(`${level === 'error' ? 'error' : 'warn '} ${file}: ${msg}`);
    };
    if (!name.endsWith('.md') || statSync(new URL(name, dir)).isDirectory()) {
      report('error', 'only flat .md files are allowed in a content collection');
      continue;
    }
    posts++;
    let parsed;
    try {
      parsed = parsePost(readFileSync(new URL(name, dir), 'utf8'));
    } catch (e) {
      report('error', e.message);
      continue;
    }
    for (const { level, msg } of validatePost(section, name.slice(0, -3), parsed.fm, parsed.body)) report(level, msg);

    const title = String(parsed.fm.title ?? '').trim().toLowerCase();
    if (titles.has(title)) report('error', `title duplicates ${titles.get(title)} (titles must be unique)`);
    titles.set(title, file);
  }
}

console.log(`content check: ${posts} posts, ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
