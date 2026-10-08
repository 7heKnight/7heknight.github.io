// One typed view over the three content collections, so sitemap, RSS, tag
// pages and related-post logic all agree on what a "post" is.
import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORIES, PENTEST_CATEGORIES, REDTEAM_CATEGORIES } from '../content/config';
import { MIN_INDEXABLE_POSTS, type Crumb } from './seo';

// Adding a content track means adding it here (and in the sitemap/IndexNow
// section list); everything else derives from this map.
export const SECTIONS = {
  writeups: { label: 'Writeups', path: '/writeups/', categoryPath: '/categories/', categories: CATEGORIES },
  pentest: { label: 'Pentest', path: '/pentest/', categoryPath: '/pentest/categories/', categories: PENTEST_CATEGORIES },
  redteam: { label: 'Red Team', path: '/redteam/', categoryPath: '/redteam/categories/', categories: REDTEAM_CATEGORIES },
} as const;

export type Section = keyof typeof SECTIONS;

interface Common {
  slug: string;
  url: string; // site-relative, trailing slash
  title: string;
  excerpt: string;
  date: Date;
  updated: Date; // `updated` frontmatter, falling back to `date`
  tags: string[];
  category: string;
  draft: boolean;
}

export type Post =
  | (Common & { section: 'writeups'; entry: CollectionEntry<'writeups'> })
  | (Common & { section: 'pentest'; entry: CollectionEntry<'pentest'> })
  | (Common & { section: 'redteam'; entry: CollectionEntry<'redteam'> });

function toPost<S extends Section>(section: S, entry: CollectionEntry<S>): Post {
  const d = entry.data;
  return {
    section,
    entry,
    slug: entry.slug,
    url: `${SECTIONS[section].path}${entry.slug}/`,
    title: d.title,
    excerpt: d.excerpt,
    date: d.date,
    updated: d.updated ?? d.date,
    tags: d.tags,
    category: d.category,
    draft: d.draft,
  } as Post;
}

// Newest first.
export async function getAllPosts(): Promise<Post[]> {
  const [writeups, pentest, redteam] = await Promise.all([
    getCollection('writeups'),
    getCollection('pentest'),
    getCollection('redteam'),
  ]);
  return [
    ...writeups.map((e) => toPost('writeups', e)),
    ...pentest.map((e) => toPost('pentest', e)),
    ...redteam.map((e) => toPost('redteam', e)),
  ].sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

export function groupByTag(posts: Post[]): Map<string, Post[]> {
  const groups = new Map<string, Post[]>();
  for (const p of posts) {
    for (const tag of new Set(p.tags.map((t) => t.toLowerCase()))) {
      groups.set(tag, [...(groups.get(tag) ?? []), p]);
    }
  }
  return groups;
}

export function lastModified(posts: Post[]): Date | undefined {
  return posts.length
    ? new Date(Math.max(...posts.map((p) => p.updated.valueOf())))
    : undefined;
}

// Whether a tag/category archive deserves to be indexed (see MIN_INDEXABLE_POSTS).
export function isIndexableListing(count: number): boolean {
  return count >= MIN_INDEXABLE_POSTS;
}

// Home › Section › current post.
export function postCrumbs(section: Section, title: string): Crumb[] {
  return [
    { name: 'Home', href: '/' },
    { name: SECTIONS[section].label, href: SECTIONS[section].path },
    { name: title },
  ];
}

// Other posts ranked by shared tags (+2 for the same category).
export function relatedPosts(current: Post, pool: Post[], limit = 3): Post[] {
  const tags = new Set(current.tags.map((t) => t.toLowerCase()));
  return pool
    .filter((p) => p.url !== current.url)
    .map((p) => ({
      p,
      score:
        p.tags.filter((t) => tags.has(t.toLowerCase())).length +
        (p.category === current.category ? 2 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.date.valueOf() - a.p.date.valueOf())
    .slice(0, limit)
    .map((x) => x.p);
}
