// Browser gate on the built site (dist/): every published page must render
// without horizontal scroll at phone and desktop widths and without console
// errors or failed requests, and a template sample must pass axe (WCAG 2.1 AA).
// Set CHROMIUM_PATH to use an existing Chromium (e.g. a sandbox without the
// Playwright download); E2E_ENGINES=chromium,firefox,webkit to widen locally.
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import playwright from 'playwright';
import config from '../astro.config.mjs';
import { SECTIONS } from '../src/content/taxonomy.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ORIGIN = new URL(config.site).origin;
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

// Minimal static host that behaves like GitHub Pages: directory index, 404.html on a miss.
function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(DIST, path));
    let status = 200;
    try {
      if (!file.startsWith(DIST)) throw new Error('outside dist');
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      file = join(DIST, '404.html'); status = 404;
    }
    res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// Published URLs come from the sitemap, so the gate follows whatever the site really exposes.
const sitemap = readFileSync(join(DIST, 'sitemap-index.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].slice(ORIGIN.length));
urls.push('/404.html');

// axe sample: every non-post page template, plus the two heaviest posts per track (tables, code, images).
const sizeOf = (u) => statSync(join(DIST, u.endsWith('/') ? `${u}index.html` : u)).size;
const isPost = (u) => { const m = /^\/([^/]+)\/([^/]+)\/$/.exec(u); return m && SECTIONS[m[1]] && m[2] !== 'categories'; };
const heaviest = Object.keys(SECTIONS).flatMap((s) => urls.filter((u) => isPost(u) && u.startsWith(`/${s}/`)).sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 2));
const templates = ['/', '/tags/', '/about/', '/copyright/', '/404.html', ...Object.values(SECTIONS).flatMap((s) => [s.path, s.categoryPath]),
  urls.find((u) => u.startsWith('/tags/') && u !== '/tags/'), urls.find((u) => u.startsWith('/categories/') && u !== '/categories/')].filter(Boolean);
const axeSample = [...new Set([...templates, ...heaviest])];

const engines = (process.env.E2E_ENGINES ?? 'chromium').split(',');
let server, base;
before(async () => { server = await serve(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => { for (let u; (u = queue.shift()); ) await fn(u); }));
}

for (const engine of engines) {
  test(`[${engine}] layout, console and requests are clean on ${urls.length} pages x ${VIEWPORTS.length} viewports; axe passes on ${axeSample.length} templates`, async () => {
    const browser = await playwright[engine].launch(process.env.CHROMIUM_PATH && engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const problems = [];
    try {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        await pool(urls, 4, async (url) => {
          const page = await ctx.newPage();
          const tag = `${vp.name} ${url}`;
          page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
          page.on('console', (m) => m.type() === 'error' && problems.push(`${tag}: console error: ${m.text()}`));
          page.on('response', (r) => r.url().startsWith(base) && r.status() >= 400 && !r.url().endsWith(url) && problems.push(`${tag}: ${r.status()} ${r.url()}`));
          await page.goto(base + url, { waitUntil: 'load' });
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
          if (scrollWidth > clientWidth) problems.push(`${tag}: horizontal overflow (${scrollWidth}px > ${clientWidth}px)`);
          if (axeSample.includes(url)) {
            const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
            for (const v of violations) problems.push(`${tag}: axe ${v.impact} ${v.id} (${v.nodes.length} node(s)) ${v.nodes[0].html.slice(0, 80)}`);
          }
          await page.close();
        });
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
    assert.deepEqual(problems, []);
  });
}
