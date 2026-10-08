// Single source of truth for site-wide SEO constants and helpers.
// Pure functions only (no Astro imports) so they stay trivially testable.

export const SITE = {
  name: '7heKnight',
  homeTitle: '7heKnight — Binary Exploitation, Android Pentest & Red Team',
  description:
    'Offensive security notes by Ly Tuan Kiet (7heKnight): binary exploitation and CTF writeups, Android pentest runbooks, and red team research with CVE analyses.',
  ogImage: '/og-default.png', // 1200x630
  twitter: '@7heKnight',
} as const;

export const AUTHOR = { name: 'Ly Tuan Kiet', alias: '7heKnight' } as const;

export const SOCIAL_LINKS = [
  { label: 'GitHub', href: 'https://github.com/7heKnight' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/7heknight/' },
  { label: 'Twitter', href: 'https://twitter.com/7heKnight' },
  { label: 'Facebook', href: 'https://www.facebook.com/7heknight/' },
] as const;

// Tag / category archives that list fewer posts than this only repeat a single
// post card: they are served `noindex,follow` and left out of the sitemap.
export const MIN_INDEXABLE_POSTS = 2;

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

// "Post title — 7heKnight", but drop the brand when it would push the title
// past the ~60 characters search engines display.
export function pageTitle(title: string): string {
  const branded = `${title} — ${SITE.name}`;
  return branded.length <= TITLE_MAX ? branded : title;
}

// Fit a description into the ~160 characters shown in a result snippet:
// prefer ending on a sentence boundary, otherwise on a word boundary with "…".
export function metaDescription(text: string, max = DESCRIPTION_MAX): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (stop >= 70) return s.slice(0, stop + 1);
  let cut = s.slice(0, max - 1);
  if (s[max - 1] !== ' ') cut = cut.slice(0, cut.lastIndexOf(' '));
  return `${cut.replace(/[\s,;:—–-]+$/, '')}…`;
}

// JSON for an inline <script type="application/ld+json">; `<` is escaped so
// post titles can never close the script element.
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export interface Crumb {
  name: string;
  href?: string; // omitted on the current page
}

export interface ArticleMeta {
  published: Date;
  modified: Date;
  tags: readonly string[];
  section: string;
}

export function websiteLd(site: URL) {
  const root = site.origin;
  return [
    {
      '@type': 'WebSite',
      '@id': `${root}/#website`,
      url: `${root}/`,
      name: SITE.name,
      alternateName: AUTHOR.name,
      inLanguage: 'en',
      publisher: { '@id': `${root}/#author` },
    },
    {
      '@type': 'Person',
      '@id': `${root}/#author`,
      name: AUTHOR.name,
      alternateName: AUTHOR.alias,
      url: `${root}/about/`,
      sameAs: SOCIAL_LINKS.map((l) => l.href),
    },
  ];
}

export function articleLd(
  a: ArticleMeta & { title: string; description: string; url: URL; image: URL },
) {
  return {
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url.href },
    headline: a.title.length > 110 ? `${a.title.slice(0, 109)}…` : a.title,
    description: a.description,
    image: [a.image.href],
    datePublished: a.published.toISOString(),
    dateModified: a.modified.toISOString(),
    author: {
      '@type': 'Person',
      name: AUTHOR.name,
      alternateName: AUTHOR.alias,
      url: new URL('/about/', a.url).href,
    },
    articleSection: a.section,
    keywords: a.tags.join(', '),
    inLanguage: 'en',
  };
}

export function breadcrumbLd(crumbs: Crumb[], site: URL) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: new URL(c.href, site).href } : {}),
    })),
  };
}
