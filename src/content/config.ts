import { defineCollection, z } from 'astro:content';

// Primary technical categories for binary-exploitation writeups.
export const CATEGORIES = {
  'buffer-overflow': 'Buffer Overflow',
  'dep-nx-bypass': 'DEP / NX Bypass',
  'aslr-bypass': 'ASLR Bypass',
  'stack-canary': 'Stack Canary',
  'windows-exploit': 'Windows Exploitation',
  'shellcode': 'Shellcode',
  'web-security': 'Web Security',
  'ctf-writeup': 'CTF Writeup',
} as const;

export type CategorySlug = keyof typeof CATEGORIES;

// Categories for the mobile / Android pentest track.
export const PENTEST_CATEGORIES = {
  'fundamentals': 'Fundamentals',
  'certificate-injection': 'Certificate Injection',
  'root-detection-bypass': 'Root Detection Bypass',
  'ssl-pinning-bypass': 'SSL Pinning Bypass',
  'traffic-interception': 'Traffic Interception',
  'tools-scripts': 'Tools & Scripts',
} as const;

export type PentestCategorySlug = keyof typeof PENTEST_CATEGORIES;

const writeups = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    category: z.enum(
      Object.keys(CATEGORIES) as [CategorySlug, ...CategorySlug[]]
    ),
    tags: z.array(z.string()).default([]),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    source: z.string(), // e.g. "INE", "pwnable.kr"
    excerpt: z.string(),
    cover: z.string().optional(), // path under /writeups/<slug>/
    draft: z.boolean().default(false),
  }),
});

const pentest = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    category: z.enum(
      Object.keys(PENTEST_CATEGORIES) as [
        PentestCategorySlug,
        ...PentestCategorySlug[]
      ]
    ),
    tags: z.array(z.string()).default([]),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    platform: z.string().default('Android'), // e.g. "Android <14", "Android 14+"
    excerpt: z.string(),
    // Optional series grouping so multi-part runbooks link together.
    series: z.string().optional(),
    seriesOrder: z.number().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writeups, pentest };
