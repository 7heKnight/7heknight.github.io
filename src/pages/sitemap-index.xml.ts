import { CATEGORIES, PENTEST_CATEGORIES, REDTEAM_CATEGORIES } from '../content/config';
import {
  SECTIONS, getAllPosts, groupByTag, isIndexableListing, lastModified, type Section,
} from '../lib/posts';
import type { APIContext } from 'astro';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET(context: APIContext) {
  const origin = context.site!.origin;
  const all = (await getAllPosts()).filter((p) => !p.draft); // drafts are noindex
  const entries = new Map<string, Date | undefined>();
  const add = (path: string, posts: typeof all) => entries.set(path, lastModified(posts));

  // `lastmod` is the newest `updated ?? date` among the posts a page lists, so
  // it only moves when that page's content really changes. Static pages with
  // no such signal omit it rather than guess.
  add('/', all);
  add('/tags/', all);
  entries.set('/about/', undefined);
  entries.set('/copyright/', undefined);

  for (const key of Object.keys(SECTIONS) as Section[]) {
    const { path, categoryPath, categories } = SECTIONS[key];
    const posts = all.filter((p) => p.section === key);
    add(path, posts);
    add(categoryPath, posts);
    for (const p of posts) add(p.url, [p]);
    for (const c of Object.keys(categories)) {
      const inCat = posts.filter((p) => p.category === c);
      if (isIndexableListing(inCat.length)) add(`${categoryPath}${c}/`, inCat);
    }
  }
  for (const [tag, posts] of groupByTag(all)) {
    if (isIndexableListing(posts.length)) add(`/tags/${tag}/`, posts);
  }

  const urls = [...entries].map(([path, mod]) =>
    `  <url><loc>${esc(origin + path)}</loc>${mod ? `<lastmod>${mod.toISOString()}</lastmod>` : ''}</url>`,
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
