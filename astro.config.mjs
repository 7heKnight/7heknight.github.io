import { defineConfig } from 'astro/config';

// https://astro.build/config
// 7heknight.github.io is a GitHub *user* site → served at the domain root,
// so no `base` path is needed.
export default defineConfig({
  site: 'https://7heknight.github.io',
  markdown: {
    shikiConfig: {
      // Dark theme that pairs well with the #242424 / #ffcc00 brand colors.
      theme: 'github-dark',
      wrap: true,
    },
  },
});
