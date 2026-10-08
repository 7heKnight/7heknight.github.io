// Frontmatter schemas for the three collections. They take `z` as a parameter
// so the same definitions run inside Astro (`astro:content`'s z, see config.ts)
// and in Node tooling (`astro/zod`'s z, see scripts/lib/content.mjs): the build,
// the generator and the linter validate against one contract.
// `.strict()` turns a misspelled field into an error instead of a silent drop.
import { CATEGORIES, DIFFICULTIES, PENTEST_CATEGORIES, REDTEAM_CATEGORIES } from './taxonomy.mjs';

/** @typedef {keyof typeof CATEGORIES} CategorySlug */
/** @typedef {keyof typeof PENTEST_CATEGORIES} PentestCategorySlug */
/** @typedef {keyof typeof REDTEAM_CATEGORIES} RedteamCategorySlug */
/** @typedef {typeof import('astro/zod').z} Z */

/** @param {Z} z */
const shared = (z) => ({
  title: z.string().min(1).max(110), // 110 = structured-data headline limit
  date: z.coerce.date(),
  updated: z.coerce.date().optional(), // set when a post is materially revised (feeds dateModified / sitemap lastmod)
  difficulty: z.enum(/** @type {[string, ...string[]]} */ (DIFFICULTIES)),
  tags: z.array(z.string().min(1)).min(1),
  excerpt: z.string().min(50), // feeds the meta description
  draft: z.boolean().default(false),
});

/** @param {Z} z */
export const writeupSchema = (z) =>
  z.object({
    ...shared(z),
    category: z.enum(/** @type {[CategorySlug, ...CategorySlug[]]} */ (Object.keys(CATEGORIES))),
    source: z.string().min(1), // e.g. "INE", "pwnable.kr"
    cover: z.string().optional(), // path under /writeups/<slug>/
  }).strict();

/** @param {Z} z */
export const pentestSchema = (z) =>
  z.object({
    ...shared(z),
    category: z.enum(/** @type {[PentestCategorySlug, ...PentestCategorySlug[]]} */ (Object.keys(PENTEST_CATEGORIES))),
    platform: z.string().default('Android'), // e.g. "Android <14", "Android 14+"
    // Optional series grouping so multi-part runbooks link together.
    series: z.string().optional(),
    seriesOrder: z.number().int().positive().optional(),
  }).strict();

/** @param {Z} z */
export const redteamSchema = (z) =>
  z.object({
    ...shared(z),
    category: z.enum(/** @type {[RedteamCategorySlug, ...RedteamCategorySlug[]]} */ (Object.keys(REDTEAM_CATEGORIES))),
    cover: z.string().optional(), // path under /redteam/<slug>/
  }).strict();

export const SCHEMAS = { writeups: writeupSchema, pentest: pentestSchema, redteam: redteamSchema };
