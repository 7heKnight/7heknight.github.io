// Content rules shared by the post generator (scripts/new.mjs) and the linter
// (scripts/check-content.mjs). Structure is validated by the very schemas the
// Astro build uses (src/content/schemas.mjs); this file only adds what a
// schema cannot express (file name, cross-field, files on disk, body rules).
import { existsSync } from 'node:fs';
import { z } from 'astro/zod';
import { parse as parseYaml } from 'yaml';
import { SCHEMAS } from '../../src/content/schemas.mjs';
import { SECTIONS } from '../../src/content/taxonomy.mjs';

export const ROOT = new URL('../../', import.meta.url);

// Every post carries this notice near the top (project rule: educational /
// authorized-testing-only framing). The generator emits it; the linter requires it.
export const DISCLAIMER = [
  '> Educational material only. The techniques below are documented for',
  '> authorized penetration testing, security research and defensive',
  '> understanding. Do not run any of this against systems you are not',
  '> explicitly authorized to test.',
].join('\n');
const DISCLAIMER_RE = /^>\s.*\b(educational|authori[sz]ed)\b/im;

export const isKebab = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);

export function slugify(title) {
  return title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/, '');
}

export function parsePost(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing "---" frontmatter block');
  return { fm: parseYaml(m[1]) ?? {}, body: m[2] };
}

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Returns [{ level: 'error' | 'warn', msg }].
export function validatePost(section, slug, fm, body) {
  const out = [];
  const err = (msg) => out.push({ level: 'error', msg });
  const warn = (msg) => out.push({ level: 'warn', msg });

  const parsed = SCHEMAS[section](z).safeParse(fm);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(`${i.path.join('.') || 'frontmatter'}: ${i.message}`);
  }

  if (!isKebab(slug)) err(`file name "${slug}.md" must be kebab-case (it becomes the URL slug)`);
  // Dates must be written as plain YYYY-MM-DD so every tool reads them identically.
  if (!isDay(fm.date)) err('date: must be written as YYYY-MM-DD');
  if (fm.updated !== undefined && (!isDay(fm.updated) || fm.updated < fm.date)) err('updated: must be YYYY-MM-DD and not earlier than date');
  if (!(fm.category in SECTIONS[section].categories)) err(`category: "${fm.category}" is not one of ${Object.keys(SECTIONS[section].categories).join(', ')}`);
  if ((fm.series === undefined) !== (fm.seriesOrder === undefined)) err('series and seriesOrder must be set together');
  if (fm.cover !== undefined) {
    const prefix = `/${section}/${slug}/`;
    if (!String(fm.cover).startsWith(prefix)) err(`cover: must live under ${prefix}`);
    else if (!existsSync(new URL(`public${fm.cover}`, ROOT))) err(`cover: file not found: public${fm.cover}`);
  }
  if (typeof fm.excerpt === 'string' && fm.excerpt.length > 320) warn(`excerpt: ${fm.excerpt.length} chars; search snippets cut at ~160 and cards stay readable under ~320`);
  if (Array.isArray(fm.tags) && new Set(fm.tags.map((t) => String(t).toLowerCase())).size !== fm.tags.length) warn('tags: duplicates (tags are matched case-insensitively)');

  if (!DISCLAIMER_RE.test(body.split('\n').slice(0, 30).join('\n'))) err('body: missing the educational / authorized-testing disclaimer blockquote near the top');
  if (fm.draft === false && /\bTODO:/.test(body)) err('body: "TODO:" placeholder left in a published (draft: false) post');
  return out;
}

// YAML scalar helpers for rendering frontmatter.
const q = (s) => JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar
const tag = (t) => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t) ? t : q(t));

export function renderPost(section, f) {
  const lines = [
    '---',
    `title: ${q(f.title)}`,
    `date: ${f.date}`,
    `category: ${q(f.category)}`,
    `difficulty: ${q(f.difficulty)}`,
    `tags: [${f.tags.map(tag).join(', ')}]`,
  ];
  if (section === 'writeups') lines.push(`source: ${q(f.source)}`);
  if (section === 'pentest') {
    lines.push(`platform: ${q(f.platform)}`);
    if (f.series) lines.push(`series: ${q(f.series)}`, `seriesOrder: ${f.seriesOrder}`);
  }
  lines.push(`excerpt: ${q(f.excerpt)}`, `draft: ${f.draft}`, '---', '', DISCLAIMER, '',
    '## Overview', '', 'TODO: what this covers and why it matters.', '',
    '## Walkthrough', '', 'TODO: steps, commands and evidence.', '',
    '## Detection and mitigation', '', 'TODO: how defenders detect and prevent this.', '',
    '## References', '', 'TODO: sources.', '');
  return lines.join('\n');
}
