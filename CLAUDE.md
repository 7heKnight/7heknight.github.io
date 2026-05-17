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

## Conventions

- Dates: `date:` frontmatter is a real date (`z.coerce.date()`); layouts render it ISO-sliced. Keep dates accurate to the source material.
- Content is security-education material; every post must keep the educational / authorized-testing-only framing (a blockquote disclaimer near the top is the established pattern) — see existing `redteam` posts.
