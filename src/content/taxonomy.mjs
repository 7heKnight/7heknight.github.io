// Content taxonomy: the one definition shared by the Astro site (config.ts,
// lib/posts.ts) and the Node tooling in scripts/ (generator, linter, IndexNow).
// Plain ESM with no Astro imports so Node can load it directly.

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

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
};

// Categories for the mobile / Android pentest track.
export const PENTEST_CATEGORIES = {
  'fundamentals': 'Fundamentals',
  'certificate-injection': 'Certificate Injection',
  'root-detection-bypass': 'Root Detection Bypass',
  'ssl-pinning-bypass': 'SSL Pinning Bypass',
  'traffic-interception': 'Traffic Interception',
  'tools-scripts': 'Tools & Scripts',
};

// Categories for the red-team / cyber kill-chain research track.
export const REDTEAM_CATEGORIES = {
  'recon-enum': 'Recon & Enumeration',
  'persistence': 'Host Persistence',
  'lateral-movement': 'Lateral Movement',
  'deserialization': 'Insecure Deserialization',
};

// The three content tracks. Adding a track = one entry here plus its
// collection schema in config.ts; routes, sitemap, RSS, IndexNow, the post
// generator and the content linter all derive from this map.
// Fields shared by every track: title, date, updated, category, difficulty,
// tags, excerpt, draft.
export const SECTIONS = {
  writeups: {
    label: 'Writeups',
    path: '/writeups/',
    categoryPath: '/categories/',
    categories: CATEGORIES,
    required: ['source'], // mandatory frontmatter beyond the shared fields
    optional: ['cover'],
  },
  pentest: {
    label: 'Pentest',
    path: '/pentest/',
    categoryPath: '/pentest/categories/',
    categories: PENTEST_CATEGORIES,
    required: [],
    optional: ['platform', 'series', 'seriesOrder'],
  },
  redteam: {
    label: 'Red Team',
    path: '/redteam/',
    categoryPath: '/redteam/categories/',
    categories: REDTEAM_CATEGORIES,
    required: [],
    optional: ['cover'],
  },
};
