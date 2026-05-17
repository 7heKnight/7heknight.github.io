import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('writeups');
  return rss({
    title: '7heKnight — Exploit Dev & CTF Writeups',
    description: 'Binary exploitation, exploit development and CTF writeups.',
    site: context.site!,
    items: posts
      .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
      .map((p) => ({
        title: p.data.title,
        description: p.data.excerpt,
        pubDate: p.data.date,
        link: `/writeups/${p.slug}/`,
      })),
  });
}
