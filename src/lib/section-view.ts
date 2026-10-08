// Per-track presentation: the only place where the three tracks are allowed to
// differ in copy or behaviour. Shared components read from here instead of
// being copied per track.
import type { Section } from './posts';

export interface SectionView {
  order: 'date' | 'series'; // how listings are sorted
  toc: { depths: number[]; indent: boolean }; // which body headings feed the contents list
  nav: 'chronological' | 'series' | 'none'; // prev/next links under a post
  related: 'category' | 'tags' | 'series'; // sidebar block under a post
  index: { title: string; description: string; heroCmd: string; heroText: string; more?: { href: string; label: string } };
  categories: { title: string; description: string; heroCmd: string; heroText: string };
  category: { title: (label: string) => string; heroCmd: (label: string) => string; noun: string };
}

export const SECTION_VIEW: Record<Section, SectionView> = {
  writeups: {
    order: 'date',
    toc: { depths: [1, 2], indent: true },
    nav: 'chronological',
    related: 'category',
    index: {
      title: 'Binary Exploitation Writeups',
      description: 'Binary exploitation and CTF writeups: stack overflows, NX/DEP and ASLR bypass, ret2libc, stack canaries, shellcode, plus web-security CVE analyses.',
      heroCmd: '$ ./writeups --all',
      heroText: 'Binary exploitation & CTF — stack smashing, DEP/NX & ASLR bypasses, ret2libc, stack canaries, shellcode and more.',
      more: { href: '/categories/', label: 'Browse by category' },
    },
    categories: {
      title: 'Writeup Categories',
      description: 'Binary exploitation writeups grouped by technique: buffer overflow, DEP/NX bypass, ASLR bypass, stack canary, shellcode, Windows exploitation and web security.',
      heroCmd: '$ ls categories/',
      heroText: 'Writeups grouped by exploitation technique.',
    },
    category: {
      title: (label) => `Category: ${label}`,
      heroCmd: (label) => `$ grep -r category=${label}`,
      noun: 'writeup',
    },
  },
  pentest: {
    order: 'series',
    toc: { depths: [2], indent: false },
    nav: 'series',
    related: 'series',
    index: {
      title: 'Android Pentest Series',
      description: 'Hands-on Android pentest series: BurpSuite and Frida HTTPS interception, CA certificate injection (Android 14 APEX), root detection and SSL pinning bypass.',
      heroCmd: '$ ./pentest --android',
      heroText: 'A hands-on Android pentest series: BurpSuite + Frida for HTTPS interception, certificate injection (pre-14 & APEX), root detection & SSL pinning bypass, and the reusable scripts behind it.',
    },
    categories: {
      title: 'Pentest Categories',
      description: 'Android pentest guides grouped by topic: fundamentals, certificate injection, root detection bypass, SSL pinning bypass, traffic interception, tools and scripts.',
      heroCmd: '$ ls pentest/categories/',
      heroText: 'Android pentest guides grouped by topic.',
    },
    category: {
      title: (label) => `Pentest: ${label}`,
      heroCmd: (label) => `$ grep category=${label}`,
      noun: 'guide',
    },
  },
  redteam: {
    order: 'date',
    toc: { depths: [2], indent: false },
    nav: 'none',
    related: 'tags',
    index: {
      title: 'Red Team Research',
      description: 'Red team research across the cyber kill chain: OSINT recon, Windows persistence, lateral movement, insecure deserialization and cloud attack chains, with detection guidance.',
      heroCmd: '$ ./redteam --kill-chain',
      heroText: 'Offensive research across the cyber kill chain: OSINT recon & enumeration, Windows host persistence, lateral movement over SMB/RPC, and an insecure-deserialization deep dive (CVE-2020-0688). For educational use and authorized testing only.',
    },
    categories: {
      title: 'Red Team Categories',
      description: 'Red team research grouped by kill-chain phase: recon and enumeration, host persistence, lateral movement and insecure deserialization.',
      heroCmd: '$ ls redteam/categories/',
      heroText: 'Kill-chain research grouped by phase.',
    },
    category: {
      title: (label) => `Red Team: ${label}`,
      heroCmd: (label) => `$ grep category=${label}`,
      noun: 'article',
    },
  },
};
