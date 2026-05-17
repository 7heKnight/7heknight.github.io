import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const writeups = (await getCollection('writeups')).map((p) => ({
    title: p.data.title,
    description: p.data.excerpt,
    pubDate: p.data.date,
    link: `/writeups/${p.slug}/`,
  }));
  const pentest = (await getCollection('pentest')).map((p) => ({
    title: p.data.title,
    description: p.data.excerpt,
    pubDate: p.data.date,
    link: `/pentest/${p.slug}/`,
  }));

  return rss({
    title: '7heKnight — Offensive Security',
    description:
      'Binary exploitation, exploit development and mobile pentest writeups.',
    site: context.site!,
    items: [...writeups, ...pentest].sort(
      (a, b) => b.pubDate.valueOf() - a.pubDate.valueOf()
    ),
  });
}
