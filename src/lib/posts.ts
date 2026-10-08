// One typed view over the three content collections, so sitemap, RSS, tag
// pages, listings and related-post logic all agree on what a "post" is.
import { getCollection, type CollectionEntry } from 'astro:content';
import { SECTIONS } from '../content/taxonomy.mjs';
import { MIN_INDEXABLE_POSTS, type Crumb } from './seo';
import { SECTION_VIEW } from './section-view';

export { SECTIONS };
export type Section = keyof typeof SECTIONS;

export interface Post {
  section: Section;
  entry: CollectionEntry<Section>;
  slug: string;
  url: string; // site-relative, trailing slash
  title: string;
  excerpt: string;
  date: Date;
  updated: Date; // `updated` frontmatter, falling back to `date`
  tags: string[];
  category: string;
  categoryLabel: string;
  difficulty: string;
  draft: boolean;
  // Track-specific fields, present only where the track's schema defines them.
  cover?: string; // writeups, redteam
  source?: string; // writeups
  platform?: string; // pentest
  series?: string; // pentest
  seriesOrder?: number; // pentest
}

function toPost(section: Section, entry: CollectionEntry<Section>): Post {
  // The three collection schemas differ only in the optional fields above, so
  // this one mapper reads them loosely instead of narrowing per collection.
  const d = entry.data as Record<string, any>;
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
    categoryLabel: (SECTIONS[section].categories as Record<string, string>)[d.category],
    difficulty: d.difficulty,
    draft: d.draft,
    cover: d.cover,
    source: d.source,
    platform: d.platform,
    series: d.series,
    seriesOrder: d.seriesOrder,
  };
}

// Newest first.
export async function getAllPosts(): Promise<Post[]> {
  const sections = Object.keys(SECTIONS) as Section[];
  const lists = await Promise.all(sections.map((s) => getCollection(s)));
  return sections
    .flatMap((s, i) => lists[i].map((e) => toPost(s, e)))
    .sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

// Listing order for a track: series order for the Android series, newest first otherwise.
export function sortForSection(section: Section, posts: Post[]): Post[] {
  const sorted = [...posts];
  return SECTION_VIEW[section].order === 'series'
    ? sorted.sort((a, b) => (a.seriesOrder ?? 99) - (b.seriesOrder ?? 99))
    : sorted.sort((a, b) => b.date.valueOf() - a.date.valueOf());
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

// Tracks whose category archive lives under /<section>/categories/ (writeups keep the legacy /categories/).
export const NESTED_CATEGORY_SECTIONS = (Object.keys(SECTIONS) as Section[]).filter(
  (s) => SECTIONS[s].categoryPath === `/${s}/categories/`,
);

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

export interface SideLink { href: string; label: string; current?: boolean }
export interface PostContext {
  nav?: { prev: SideLink | null; next: SideLink | null }; // prev/next under the article
  aside?: { heading: string; links: SideLink[] }; // sidebar block
}

// Navigation and sidebar content for one post; the strategy per track comes from SECTION_VIEW.
export function postContext(post: Post, all: Post[]): PostContext {
  const view = SECTION_VIEW[post.section];
  const track = all.filter((p) => p.section === post.section);
  const link = (p: Post, label = p.title): SideLink => ({ href: p.url, label });

  const seriesItems = (post.series
    ? track.filter((p) => p.series === post.series)
    : []
  ).sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0));
  const chronological = [...track].sort((a, b) => a.date.valueOf() - b.date.valueOf());

  const out: PostContext = {};
  if (view.nav === 'chronological') {
    const i = chronological.findIndex((p) => p.url === post.url);
    out.nav = {
      prev: chronological[i - 1] ? link(chronological[i - 1]) : null,
      next: chronological[i + 1] ? link(chronological[i + 1]) : null,
    };
  } else if (view.nav === 'series') {
    const at = post.seriesOrder ?? 0;
    const find = (order: number) => seriesItems.find((p) => (p.seriesOrder ?? 0) === order);
    const prev = find(at - 1);
    const next = find(at + 1);
    out.nav = { prev: prev ? link(prev) : null, next: next ? link(next) : null };
  }

  if (view.related === 'category') {
    const links = chronological.filter((p) => p.url !== post.url && p.category === post.category).slice(0, 4).map((p) => link(p));
    if (links.length) out.aside = { heading: 'Related', links };
  } else if (view.related === 'tags') {
    const links = relatedPosts(post, track).map((p) => link(p));
    if (links.length) out.aside = { heading: 'Related', links };
  } else if (post.series && seriesItems.length) {
    out.aside = {
      heading: post.series,
      links: seriesItems.map((p) => ({ ...link(p, `${p.seriesOrder ?? 0}. ${p.title}`), current: p.seriesOrder === post.seriesOrder })),
    };
  }
  return out;
}
