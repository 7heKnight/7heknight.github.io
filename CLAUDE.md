# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- All assistant output must be in English, even when the user writes in Vietnamese.
- Commit directly to `main` (no feature branches or PRs) — but only after `npm run verify` is green locally. The git hooks enforce this on commit and push; never use `--no-verify`, never commit with a red gate.

## What this is

A personal cybersecurity blog built with **Astro** and deployed to **GitHub Pages** as a user site (repo `7heKnight/7heknight.github.io`, served at the domain root, so `astro.config.mjs` needs no `base`). Content is authored as Markdown in content collections; Astro builds static HTML into `dist/`. CI and deployment are the `.github/workflows/deploy.yml` workflow: `verify` (the quality gate) runs on every PR and push to `main`, and `deploy` runs only after `verify` is green. The GitHub Pages source must be set to "GitHub Actions" (not "Deploy from a branch"; set on 2026-10-08). If a `pages build and deployment` run (event `dynamic`, Jekyll) appears on a push, the setting has regressed: that builder fails on every `.astro` file, and no repo change can make it pass safely, since a passing legacy build would publish the raw repo over the Astro site. Re-running an old legacy run proves nothing; only a new push shows the current setting. `public/.nojekyll` keeps Pages from reprocessing the `_astro/` assets.

## Local development

```bash
npm ci                  # install dependencies (also installs the git hooks)
npm run dev             # local dev server with hot reload
npm run new -- <writeups|pentest|redteam> "<Title>"   # scaffold a post (see below)
npm run verify          # the full quality gate: exactly what CI runs
```

`npm run verify` = `check` (astro check) → `check:content` (post linter) → `test:unit` → `build` → `check:dist` (SEO/link/structured-data audit of `dist/`) → `test:dist` (audit mutation tests + Chromium layout and axe accessibility checks). Run the pieces individually while iterating; run `verify` before every commit. The hooks run it for you and block the commit/push on failure.

In a sandbox without the Playwright browser download, point the browser test at an existing Chromium: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run verify`.

Architecture, design-system rules and the gate table are in `docs/ARCHITECTURE.md`.

## Architecture

Astro project. Key directories:

- `src/content/taxonomy.mjs` — tracks (`SECTIONS`), category maps and difficulties as plain data, shared by the site and the Node scripts. `src/content/schemas.mjs` — the strict Zod frontmatter schemas; `config.ts` wires them into the three collections: **`writeups`** (binary-exploitation / CTF), **`pentest`** (Android pentest series), **`redteam`** (cyber kill-chain research). `category` must be a key of the track's category map.
- `src/content/<collection>/*.md` — the posts, one Markdown file per post.
- `src/lib/posts.ts` — one typed `Post` view over the collections (sorting, tag grouping, related posts, prev/next); sitemap, RSS, tag pages and listings are built from it. `src/lib/section-view.ts` — the only place the three tracks differ (copy, sort order, contents depth, nav/related strategy). `src/lib/seo.ts` — site constants and pure helpers for titles, descriptions and JSON-LD.
- `src/layouts/` — `BaseLayout.astro` (shell, head, skip link) and `PostLayout.astro` (the one post layout for every track).
- `src/components/` — `Header`, `Footer`, `PostCard`, `Breadcrumbs`, `PostDates`, and the listing views `SectionIndexView`, `CategoryIndexView`, `CategoryView`.
- `src/pages/[section]/` — thin routes for `/writeups/`, `/pentest/`, `/redteam/`: `index.astro`, `[...slug].astro`, `categories/`. Writeup categories keep their legacy `/categories/` URLs (`src/pages/categories/`). `tags/`, `sitemap-index.xml.ts`, `robots.txt.ts`, `rss.xml.ts` are generated from the same data.
- `src/styles/tokens.css` — design tokens (single source of truth); `global.css` consumes them.
- `src/plugins/rehype-post-content.mjs` — Markdown pass: image alt text, lazy-loading, width/height; scrollable tables.
- `scripts/` — `new.mjs` (post generator), `check-content.mjs`, `audit-dist.mjs`, `gate.mjs` + `install-hooks.mjs` (git gate), `indexnow.mjs` (post-deploy), and the `*.test.mjs` suites.
- `public/` — static assets served as-is. Post images live under `public/<collection>/<slug>/` and are referenced from Markdown as `/<collection>/<slug>/<file>`.

The three tracks share every component; never copy markup or logic between them. A track-specific difference belongs in `section-view.ts` (presentation) or `taxonomy.mjs` + `schemas.mjs` (data).

Theme is a fixed dark palette defined in `src/styles/tokens.css` (background `#242424`, accent `#ffcc00`). Use the tokens; do not hard-code colours, spacing or font sizes.

## Adding a new post

1. `npm run new -- <writeups|pentest|redteam> "<Title>"` (add `--category`, `--difficulty`, `--excerpt`, `--tags`, plus `--source` for writeups; it prompts for anything missing). If no category fits, add one to the track's map in `src/content/taxonomy.mjs` first.
2. It creates `src/content/<collection>/<slug>.md` as a `draft: true` skeleton with the standard disclaimer and `TODO:` placeholders. Fill them in.
3. Put images in `public/<collection>/<slug>/` and reference them as `/<collection>/<slug>/<file>` with real alt text.
4. Set `draft: false` (the linter blocks this while any `TODO:` remains) and run `npm run verify`. No manual index/nav edits are needed.

Existing posts are the working examples to follow:
- `writeups`: `src/content/writeups/linux-bo-foundation.md`
- `pentest`: `src/content/pentest/android-pentest-overview.md`
- `redteam`: `src/content/redteam/windows-host-persistence.md`

## SEO

SEO is handled in code, with no dependency on any webmaster console. All of it derives from frontmatter, so a new post needs nothing extra.

- **Head metadata** is built once in `BaseLayout.astro`: title (brand suffix dropped when it would exceed ~60 chars), description (`excerpt` trimmed to ~160 chars at a sentence boundary), canonical, Open Graph, `og:type=article` + dates on posts. Posts also get `BlogPosting` + `BreadcrumbList` JSON-LD; the home page gets `WebSite` + `Person`.
- **Dates:** `date` is first publication. Set the optional `updated` frontmatter when a post is materially revised; it drives `dateModified`, the sitemap `lastmod`, and the visible "updated" stamp. Never bump it for typo fixes.
- **Thin archives:** tag/category pages listing fewer than `MIN_INDEXABLE_POSTS` (2) posts are `noindex,follow` and left out of the sitemap. `draft: true` posts are `noindex` and excluded from sitemap/RSS.
- **Images:** write real alt text in Markdown; filename-style alt (`![image1.png](...)`) is replaced by the post title + nearest heading. The build fails if a `/path` image is missing from `public/`. Post images get width/height and lazy-loading automatically.
- **Sitemap / robots / RSS:** `sitemap-index.xml` (keep the URL; it is referenced from `robots.txt`), `robots.txt` and `rss.xml` are generated from the collections. Adding a content track means adding it to `SECTIONS` in `src/content/taxonomy.mjs` (IndexNow, the generator and the linter read it from there) and to `src/lib/section-view.ts`.
- **IndexNow:** `public/<key>.txt` is the protocol's ownership proof and is public by design. After each deploy the `indexnow` job submits only the posts changed in that push (Bing, Yandex, Naver, Seznam; not Google). Keep post file names kebab-case so the URL derived from the path matches the slug.
- **Mobile:** Google indexes the mobile view. The mobile grid column is `minmax(0, 1fr)` and wide tables / long URLs are contained; check there is no horizontal scroll at 390px after layout or CSS changes.

## Conventions

- Dates: write `date:` / `updated:` as plain `YYYY-MM-DD`; the schema coerces them to dates and layouts render them ISO-sliced. Keep dates accurate to the source material.
- Content is security-education material; every post carries the educational / authorized-testing-only blockquote near the top (the generator emits it and the linter requires it).
- Frontmatter is strict: an unknown field is a build error, not a silent drop.
- Quality gate: `npm run verify` must be green before any commit or push. If a gate is wrong, fix the gate (with a test), never bypass it.
