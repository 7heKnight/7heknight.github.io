import { defineConfig } from 'astro/config';
import rehypePostContent from './src/plugins/rehype-post-content.mjs';

// https://astro.build/config
// 7heknight.github.io is a GitHub *user* site → served at the domain root,
// so no `base` path is needed.
export default defineConfig({
  site: 'https://7heknight.github.io',
  markdown: {
    rehypePlugins: [rehypePostContent],
    shikiConfig: {
      // High-contrast dark theme: every token (comments included) meets WCAG AA on the code background.
      theme: 'github-dark-high-contrast',
      wrap: true,
    },
  },
});
