#!/usr/bin/env node
// Scaffold a new post with schema-valid frontmatter and the standard skeleton.
//
//   npm run new -- <writeups|pentest|redteam> "<Title>" [options]
//
// Missing required options are prompted for in a terminal; in CI/non-TTY they
// are an error. New posts start as `draft: true` (noindex, out of sitemap/RSS)
// with TODO markers; the content linter blocks publishing while any remain.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { DIFFICULTIES, SECTIONS } from '../src/content/taxonomy.mjs';
import { ROOT, parsePost, renderPost, slugify, validatePost } from './lib/content.mjs';

const USAGE = `Usage: npm run new -- <${Object.keys(SECTIONS).join('|')}> "<Title>" [options]
  --category <key>      one of the section's categories
  --difficulty <level>  ${DIFFICULTIES.join(' | ')}
  --excerpt "<text>"    1-2 sentences (>= 50 chars); becomes the meta description
  --tags a,b,c          comma-separated
  --source <text>       writeups only (e.g. INE, pwnable.kr)
  --platform <text>     pentest only (default: Android)
  --series <name> --order <n>   pentest series membership
  --slug <kebab-case>   default: derived from the title
  --date YYYY-MM-DD     default: today (UTC)
  --dry-run             print the file instead of writing it`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: 'string' }, difficulty: { type: 'string' }, excerpt: { type: 'string' },
    tags: { type: 'string' }, source: { type: 'string' }, platform: { type: 'string' },
    series: { type: 'string' }, order: { type: 'string' }, slug: { type: 'string' },
    date: { type: 'string' }, 'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const fail = (msg) => { console.error(`error: ${msg}\n\n${USAGE}`); process.exit(1); };
if (o.help) { console.log(USAGE); process.exit(0); }

const [section, title] = positionals;
if (!SECTIONS[section]) fail(`first argument must be one of: ${Object.keys(SECTIONS).join(', ')}`);
if (!title?.trim()) fail('second argument must be the post title');
const spec = SECTIONS[section];

const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function need(key, label, choices) {
  if (o[key]) return o[key];
  if (!rl) fail(`--${key} is required${choices ? ` (${choices.join(' | ')})` : ''}`);
  const hint = choices ? ` [${choices.join(' | ')}]` : '';
  return (await rl.question(`${label}${hint}: `)).trim();
}

const fields = {
  title: title.trim(),
  date: o.date ?? new Date().toISOString().slice(0, 10),
  category: await need('category', 'Category', Object.keys(spec.categories)),
  difficulty: await need('difficulty', 'Difficulty', DIFFICULTIES),
  excerpt: await need('excerpt', 'Excerpt (1-2 sentences)'),
  tags: (o.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
  draft: true,
};
if (fields.tags.length === 0) fields.tags = (await need('tags', 'Tags (comma-separated)')).split(',').map((t) => t.trim()).filter(Boolean);
if (spec.required.includes('source')) fields.source = await need('source', 'Source (e.g. INE, pwnable.kr)');
if (section === 'pentest') {
  fields.platform = o.platform ?? 'Android';
  if (o.series) Object.assign(fields, { series: o.series, seriesOrder: Number(o.order) });
}
rl?.close();

const slug = o.slug ?? slugify(fields.title);
const text = renderPost(section, fields);
const { fm, body } = parsePost(text);
const problems = validatePost(section, slug, fm, body).filter((p) => p.level === 'error');
if (problems.length) fail(problems.map((p) => `- ${p.msg}`).join('\n'));

const file = new URL(`src/content/${section}/${slug}.md`, ROOT);
if (o['dry-run']) { console.log(`# ${file.pathname}\n\n${text}`); process.exit(0); }
if (existsSync(file)) fail(`${file.pathname} already exists`);
writeFileSync(file, text, { flag: 'wx' });
mkdirSync(new URL(`public/${section}/${slug}/`, ROOT), { recursive: true });

console.log(`created src/content/${section}/${slug}.md (draft: true)
next:
  1. fill in the TODO sections; put images in public/${section}/${slug}/ and reference them as /${section}/${slug}/<file>
  2. set draft: false once every TODO is gone
  3. npm run verify`);
