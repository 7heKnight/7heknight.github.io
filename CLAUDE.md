# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- All assistant output must be in English, even when the user writes in Vietnamese.

## What this is

A personal cybersecurity blog built with **Astro** and deployed to **GitHub Pages** as a user site (repo `7heKnight/7heknight.github.io`, served at the domain root, so `astro.config.mjs` needs no `base`). Content is authored as Markdown in content collections; Astro builds static HTML into `dist/`. Deployment is via the `.github/workflows/deploy.yml` Actions workflow, which triggers on push to `main` — the GitHub Pages source must be set to "GitHub Actions" (not "Deploy from a branch") or the legacy Jekyll builder runs instead. `public/.nojekyll` keeps Pages from reprocessing the `_astro/` assets.

## Local development

```bash
npm ci                  # install dependencies
npm run dev             # local dev server with hot reload
npm run build           # build static site into dist/ (run this to verify changes)
npm run preview         # serve the built dist/ locally
```

`npm run build` is the closest thing to a test suite — it type-checks content frontmatter against the collection schemas and fails the build on any mismatch. Always run it after changing content or `src/`.

## Architecture

Astro project. Key directories:

- `src/content/config.ts` — defines the content collections and their Zod schemas. Three collections exist: **`writeups`** (binary-exploitation / CTF), **`pentest`** (Android pentest series), **`redteam`** (cyber kill-chain research). Each has its own `*_CATEGORIES` map; `category` frontmatter must be one of the map keys.
- `src/content/<collection>/*.md` — the posts, one Markdown file per post with YAML frontmatter matching that collection's schema.
- `src/layouts/` — `BaseLayout.astro` (shared shell), plus one layout per collection (`WriteupLayout`, `PentestLayout`, `RedteamLayout`).
- `src/components/` — `Header.astro` / `Footer.astro` (nav is centralized here, not copy-pasted), and one card component per collection.
- `src/pages/<collection>/` — routes: `index.astro` (listing), `[...slug].astro` (post pages via `getStaticPaths`), `categories/index.astro` + `categories/[category].astro`.
- `src/lib/seo.ts` — site-wide SEO constants (name, author, socials, `MIN_INDEXABLE_POSTS`) plus pure helpers for titles, descriptions and JSON-LD. `src/lib/posts.ts` — one typed view over the three collections (`SECTIONS`, `getAllPosts`, tag grouping, related posts); sitemap, RSS and tag pages are built from it.
- `src/plugins/rehype-image-seo.mjs` — Markdown image pass (alt text, lazy-loading, width/height); `scripts/indexnow.mjs` — post-deploy search-engine notification (run by `deploy.yml`).
- `public/` — static assets served as-is. Post images live under `public/<collection>/<slug>/` and are referenced from Markdown as `/<collection>/<slug>/<file>`.

The three tracks are structurally parallel: `pentest` and `redteam` were both modeled on the same layout/route pattern. When adding a feature to one track, mirror it across the others for consistency.

Theme is a fixed dark palette: background `#242424`, accent `#ffcc00` (see `src/styles/global.css`).

## Adding a new post

1. Pick the collection: `writeups`, `pentest`, or `redteam`.
2. Create `src/content/<collection>/<kebab-case-slug>.md` with frontmatter matching that collection's schema in `src/content/config.ts`. The `category` value **must** be a key in the collection's `*_CATEGORIES` map — add a new category there first if none fit.
3. Put any images in `public/<collection>/<slug>/` and reference them as `/<collection>/<slug>/<file>`.
4. Run `npm run build` — it will fail loudly if the frontmatter does not match the schema. No manual index/nav edits are needed; listing and category pages are generated from the collection.

Existing posts are the working examples to follow:
- `writeups`: `src/content/writeups/linux-bo-foundation.md`
- `pentest`: `src/content/pentest/android-pentest-overview.md`
- `redteam`: `src/content/redteam/windows-host-persistence.md`

## SEO

SEO is handled in code, with no dependency on any webmaster console. All of it derives from frontmatter, so a new post needs nothing extra.

- **Head metadata** is built once in `BaseLayout.astro`: title (brand suffix dropped when it would exceed ~60 chars), description (`excerpt` trimmed to ~160 chars at a sentence boundary), canonical, Open Graph, `og:type=article` + dates on posts. Posts also get `BlogPosting` + `BreadcrumbList` JSON-LD; the home page gets `WebSite` + `Person`.
- **Dates:** `date` is first publication. Set the optional `updated` frontmatter when a post is materially revised; it drives `dateModified`, the sitemap `lastmod`, and the visible "updated" stamp. Never bump it for typo fixes.
- **Thin archives:** tag/category pages listing fewer than `MIN_INDEXABLE_POSTS` (2) posts are `noindex,follow` and left out of the sitemap. `draft: true` posts are `noindex` and excluded from sitemap/RSS.
- **Images:** write real alt text in Markdown; filename-style alt (`![image1.png](...)`) is replaced by the post title + nearest heading. The build fails if a `/path` image is missing from `public/`.
- **Sitemap / robots / RSS:** `sitemap-index.xml` (keep the URL; it is referenced from `robots.txt`), `robots.txt` and `rss.xml` are generated from the collections. Adding a content track means adding it to `SECTIONS` in `src/lib/posts.ts` and to `SECTIONS` in `scripts/indexnow.mjs`.
- **IndexNow:** `public/<key>.txt` is the protocol's ownership proof and is public by design. After each deploy the `indexnow` job submits only the posts changed in that push (Bing, Yandex, Naver, Seznam; not Google). Keep post file names kebab-case so the URL derived from the path matches the slug.
- **Mobile:** Google indexes the mobile view. The mobile grid column is `minmax(0, 1fr)` and wide tables / long URLs are contained; check there is no horizontal scroll at 390px after layout or CSS changes.

## Conventions

- Dates: `date:` frontmatter is a real date (`z.coerce.date()`); layouts render it ISO-sliced. Keep dates accurate to the source material.
- Content is security-education material; every post must keep the educational / authorized-testing-only framing (a blockquote disclaimer near the top is the established pattern) — see existing `redteam` posts.
