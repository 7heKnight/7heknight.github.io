import { defineCollection, z } from 'astro:content';

// Primary technical categories (one per writeup).
export const CATEGORIES = {
  'buffer-overflow': 'Buffer Overflow',
  'dep-nx-bypass': 'DEP / NX Bypass',
  'aslr-bypass': 'ASLR Bypass',
  'stack-canary': 'Stack Canary',
  'windows-exploit': 'Windows Exploitation',
  'shellcode': 'Shellcode',
  'ctf-writeup': 'CTF Writeup',
} as const;

export type CategorySlug = keyof typeof CATEGORIES;

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

export const collections = { writeups };
