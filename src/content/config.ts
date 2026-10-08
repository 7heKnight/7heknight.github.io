import { defineCollection, z } from 'astro:content';
import { CATEGORIES, PENTEST_CATEGORIES, REDTEAM_CATEGORIES } from './taxonomy.mjs';
import { pentestSchema, redteamSchema, writeupSchema } from './schemas.mjs';

// Re-exported so layouts and pages keep importing taxonomy from one place.
export { CATEGORIES, PENTEST_CATEGORIES, REDTEAM_CATEGORIES };

export type CategorySlug = keyof typeof CATEGORIES;
export type PentestCategorySlug = keyof typeof PENTEST_CATEGORIES;
export type RedteamCategorySlug = keyof typeof REDTEAM_CATEGORIES;

// Schemas live in schemas.mjs so Node tooling validates against the same contract.
export const collections = {
  writeups: defineCollection({ type: 'content', schema: writeupSchema(z) }),
  pentest: defineCollection({ type: 'content', schema: pentestSchema(z) }),
  redteam: defineCollection({ type: 'content', schema: redteamSchema(z) }),
};
