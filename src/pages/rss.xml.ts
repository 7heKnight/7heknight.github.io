import rss from '@astrojs/rss';
import { getAllPosts } from '../lib/posts';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getAllPosts()).filter((p) => !p.draft);

  return rss({
    title: '7heKnight — Offensive Security',
    description:
      'Binary exploitation, Android pentest and red team writeups by Ly Tuan Kiet.',
    site: context.site!,
    customData: '<language>en</language>',
    items: posts.map((p) => ({
      title: p.title,
      description: p.excerpt,
      pubDate: p.date,
      link: p.url,
      categories: p.tags,
    })),
  });
}
