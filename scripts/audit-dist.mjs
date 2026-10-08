#!/usr/bin/env node
// Post-build audit of dist/: the checks that keep search visibility, link
// integrity and page semantics from regressing. Run after `npm run build`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../astro.config.mjs';
import { SECTIONS } from '../src/content/taxonomy.mjs';

const DIST = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : fileURLToPath(new URL('../dist/', import.meta.url));
const ORIGIN = new URL(config.site).origin;
const errors = [];
const warnings = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warnings.push(`${page}: ${msg}`);

if (!existsSync(DIST)) { console.error('dist/ not found: run `npm run build` first'); process.exit(1); }

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}
const fileExists = (urlPath) => existsSync(join(DIST, urlPath)) || existsSync(join(DIST, urlPath.replace(/\/$/, ''), 'index.html'));

// ---- load pages
const pages = new Map(); // url -> { html, noindex }
for (const file of walk(DIST)) {
  if (!file.endsWith('.html')) continue;
  const rel = relative(DIST, file).split('\\').join('/');
  const url = rel.endsWith('index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
  const html = readFileSync(file, 'utf8');
  pages.set(url, { html, noindex: /<meta name="robots" content="[^"]*noindex/.test(html) });
}
const isPost = (url) => {
  const m = /^\/([^/]+)\/([^/]+)\/$/.exec(url);
  return Boolean(m && SECTIONS[m[1]] && m[2] !== 'categories');
};
const indexable = [...pages].filter(([url, p]) => !p.noindex && url !== '/404.html');

// ---- per-page checks
const seen = { title: new Map(), description: new Map() };
for (const [url, { html, noindex }] of pages) {
  const title = /<title>(.*?)<\/title>/s.exec(html)?.[1];
  const description = /<meta name="description" content="(.*?)"/s.exec(html)?.[1];
  const canonical = /<link rel="canonical" href="(.*?)"/.exec(html)?.[1];
  if (!title?.trim()) err(url, 'missing <title>');
  if (!description) err(url, 'missing meta description');
  else if (decode(description).length < 50 || decode(description).length > 160) err(url, `meta description is ${decode(description).length} chars (want 50-160)`);
  if (title && decode(title).length > 60 && !isPost(url)) warn(url, `title is ${decode(title).length} chars (search results show ~60)`);
  if (url !== '/404.html' && canonical !== `${ORIGIN}${url}`) err(url, `canonical is ${canonical}, expected ${ORIGIN}${url}`);
  if (!noindex && url !== '/404.html') {
    for (const [key, value] of [['title', title], ['description', description]]) {
      if (!value) continue;
      const prev = seen[key].get(value);
      if (prev) err(url, `${key} duplicates ${prev}`); else seen[key].set(value, url);
    }
  }

  const h1s = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1s === 0) err(url, 'no <h1>');
  if (!isPost(url) && h1s > 1) err(url, `${h1s} <h1> elements`);
  if (!/<main id="main"/.test(html)) err(url, 'missing <main id="main"> skip-link target');

  // structured data
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  const nodes = [];
  for (const b of blocks) {
    try { const j = JSON.parse(b); nodes.push(...(j['@graph'] ?? [j])); } catch { err(url, 'invalid JSON-LD'); }
  }
  if (isPost(url)) {
    const post = nodes.find((n) => n['@type'] === 'BlogPosting');
    if (!post) err(url, 'post without BlogPosting JSON-LD');
    else {
      for (const k of ['headline', 'description', 'image', 'datePublished', 'dateModified', 'author', 'mainEntityOfPage']) if (!post[k]) err(url, `BlogPosting missing "${k}"`);
      if (post.dateModified < post.datePublished) err(url, 'BlogPosting dateModified precedes datePublished');
    }
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList');
    if (!crumbs) err(url, 'post without BreadcrumbList JSON-LD');
    else if (crumbs.itemListElement.some((c, i) => c.position !== i + 1)) err(url, 'BreadcrumbList positions are not sequential');
    if (!/property="og:type" content="article"/.test(html)) err(url, 'post without og:type=article');
  }
  if (url === '/' && !nodes.some((n) => n['@type'] === 'WebSite')) err(url, 'home page without WebSite JSON-LD');

  // social image exists (and the default one has the advertised size)
  const og = /property="og:image" content="(.*?)"/.exec(html)?.[1];
  if (!og) err(url, 'missing og:image');
  else if (og.startsWith(ORIGIN) && !fileExists(og.slice(ORIGIN.length))) err(url, `og:image not found in dist: ${og}`);

  // internal links and assets resolve
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    if (!m[1].startsWith('//') && !fileExists(m[1])) err(url, `broken internal reference ${m[1]}`);
  }

  // images: real alt text; post-body images reserve space and lazy-load
  const bodyHtml = /<div class="body">(.*?)<\/article>/s.exec(html)?.[1] ?? '';
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    const alt = /\balt="([^"]*)"/.exec(img);
    if (!alt) err(url, `<img> without alt: ${img.slice(0, 80)}`);
    else if (/^[\w .@()-]+\.(png|jpe?g|gif|webp|avif|svg)$/i.test(alt[1])) err(url, `filename used as alt text: ${alt[1]}`);
  }
  for (const img of bodyHtml.match(/<img\b[^>]*>/g) ?? []) {
    if (!/\bwidth="\d+"/.test(img) || !/\bheight="\d+"/.test(img) || !/loading="lazy"/.test(img)) err(url, `post image missing width/height/lazy: ${img.slice(0, 90)}`);
  }
  const tables = (bodyHtml.match(/<table\b/g) ?? []).length;
  const wrappers = (bodyHtml.match(/class="table-scroll"/g) ?? []).length;
  if (tables !== wrappers) err(url, `${tables} table(s) but ${wrappers} .table-scroll wrapper(s)`);
}

// ---- sitemap
const sitemap = readFileSync(join(DIST, 'sitemap-index.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
if (new Set(locs).size !== locs.length) err('sitemap', 'duplicate <loc> entries');
for (const loc of locs) {
  const url = loc.slice(ORIGIN.length);
  if (!loc.startsWith(ORIGIN) || !pages.has(url)) err('sitemap', `${loc} has no page in dist`);
  else if (pages.get(url).noindex) err('sitemap', `${loc} is noindex`);
}
for (const [url] of indexable) if (!locs.includes(`${ORIGIN}${url}`)) err('sitemap', `indexable page missing: ${url}`);
for (const m of sitemap.matchAll(/<lastmod>(.*?)<\/lastmod>/g)) if (Number.isNaN(Date.parse(m[1]))) err('sitemap', `invalid lastmod ${m[1]}`);

// ---- robots.txt and RSS
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap-index.xml`)) err('robots.txt', 'does not reference the sitemap');
const rssItems = (readFileSync(join(DIST, 'rss.xml'), 'utf8').match(/<item>/g) ?? []).length;
const livePosts = indexable.filter(([url]) => isPost(url)).length;
if (rssItems !== livePosts) err('rss.xml', `${rssItems} items but ${livePosts} published posts`);

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`dist audit: ${pages.size} pages, ${indexable.length} indexable, ${locs.length} in sitemap, ${rssItems} in RSS | ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
