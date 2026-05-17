import { getCollection } from 'astro:content';
import { CATEGORIES } from '../content/config';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const site = context.site!.toString().replace(/\/$/, '');
  const posts = await getCollection('writeups');

  const urls = new Set<string>([
    '/', '/about/', '/copyright/', '/categories/', '/tags/',
  ]);
  for (const p of posts) urls.add(`/writeups/${p.slug}/`);
  for (const c of Object.keys(CATEGORIES)) urls.add(`/categories/${c}/`);
  const tags = new Set<string>();
  for (const p of posts) for (const t of p.data.tags) tags.add(t.toLowerCase());
  for (const t of tags) urls.add(`/tags/${t}/`);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...urls].map((u) => `  <url><loc>${site}${u}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
