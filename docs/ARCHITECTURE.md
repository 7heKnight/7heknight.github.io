# Architecture and Quality Gates

BLUF: one Astro project, one content contract, one gate. Every post is generated from the schema,
rendered by shared components, and nothing reaches `main` unless `npm run verify` is green, locally
(git hooks) and in CI (same command).

## 1. Architecture

```
src/content/taxonomy.mjs   tracks, categories, difficulties        (data, shared with Node tooling)
src/content/schemas.mjs    strict Zod frontmatter schemas           (shared: Astro build + CLI + linter)
src/content/<track>/*.md   posts                                    (the only thing authors touch)
        |
        v
src/lib/posts.ts           typed Post view + sorting, tags, related, prev/next
src/lib/section-view.ts    per-track copy and behaviour             (the ONLY place tracks may differ)
src/lib/seo.ts             titles, descriptions, JSON-LD
        |
        v
src/layouts/BaseLayout     head (SEO, OG, JSON-LD), skip link, landmarks
src/layouts/PostLayout     one post layout for every track
src/components/*           PostCard, Breadcrumbs, PostDates, SectionIndexView, CategoryIndexView, CategoryView
src/pages/[section]/*      /writeups/ /pentest/ /redteam/ index, posts, categories (thin routes)
src/pages/*.ts             sitemap-index.xml, robots.txt, rss.xml  (generated from the same Post list)
        |
        v
dist/  ->  GitHub Pages     (+ IndexNow after deploy)
```

- Adding a track: one entry in `taxonomy.mjs`, one schema in `schemas.mjs` + `config.ts`, one entry in `section-view.ts`. Routes, sitemap, RSS, IndexNow, generator and linter follow.
- Content store: Markdown + YAML in git, validated by Zod. MDX and a headless CMS were rejected: no interactive content or non-developer editors exist.
- URL stability: writeup category pages stay under `/categories/` (GitHub Pages has no redirects).

## 2. Post generator

```
npm run new -- <writeups|pentest|redteam> "<Title>" [--category k] [--difficulty d] [--excerpt "..."] [--tags a,b] [--source S] [--series N --order n] [--dry-run]
```

1. Missing required options are prompted for in a terminal; in CI they are an error.
2. The slug is derived from the title (`--slug` overrides); an existing file is never overwritten.
3. The generated file is validated against the real schema and the content rules before it is written.
4. Output: `draft: true` (noindex, out of sitemap/RSS), the standard disclaimer, and a skeleton with `TODO:` placeholders.
5. The linter refuses `draft: false` while any `TODO:` remains, so a scaffold cannot be published by accident.

Validation layers (no rule is written twice):

| Layer | Owns |
|---|---|
| `schemas.mjs` (strict Zod) | field names (typos rejected), types, enums, lengths |
| `scripts/lib/content.mjs` | what a schema cannot say: kebab-case file name, `YYYY-MM-DD` dates, `updated >= date`, cover path and file, disclaimer, `TODO:` |
| `scripts/check-content.mjs` | the above for every post, plus unique titles |

## 3. Design system

Source of truth: `src/styles/tokens.css`. Rules:

- Dark only (`color-scheme: dark`), accent `#ffcc00` on `#242424`. Status colours `--ok / --warn / --danger` drive difficulty badges and future severity chips.
- Every text/background pair is checked against WCAG AA (4.5:1) by `scripts/tokens.test.mjs`. Changing a token is safe only if that test passes.
- No hard-coded colours, spacing or font sizes in components; use the tokens.
- Typography: native stacks only. A bundled webfont was measured and rejected (+20 to +200 ms FCP for glyph identity only). Each OS gets its own best monospace: Cascadia/Consolas (Windows), SF Mono/Menlo (macOS), DejaVu/Liberation (Linux).
- Components: `PostCard` (heading level is a prop: h2 under a page h1, h3 under a section h2), `Breadcrumbs` (visible trail + JSON-LD from one source), `PostDates`, `PostLayout`.
- Responsive: single column below 1000px; compact header below 640px; 44px tap targets on `pointer: coarse`; the content column is `minmax(0, 1fr)`; tables scroll inside `.table-scroll`; long URLs wrap.
- Accessibility: skip link, `:focus-visible` ring, `prefers-reduced-motion`, labelled landmarks, no heading skips, links in text are underlined.
- Cross-platform: layout is verified in Chromium at 390px and 1280px. Firefox/WebKit can be added locally with `E2E_ENGINES=chromium,firefox,webkit` (needs those browsers installed).

## 4. Quality gates

One command, `npm run verify`, in this order (fail fast):

| Step | Catches |
|---|---|
| `check` (`astro check`, warnings fail) | type errors in `.astro`/`.ts`, unused imports |
| `check:content` | invalid or inconsistent posts |
| `test:unit` | generator and rule behaviour, design-token contrast |
| `build` | schema violations, missing images |
| `check:dist` | duplicate/missing titles and descriptions, canonicals, JSON-LD, sitemap and RSS coverage, broken links, alt text, image sizes |
| `test:dist` | mutation tests proving the audit fails on 10 defect classes; Chromium at 390/1280px on every published page (overflow, console errors, failed requests); axe WCAG 2.1 AA on 19 templates |

Enforcement:

- `.githooks/pre-commit` and `.githooks/pre-push` (installed by `npm install` via `prepare`) run `scripts/gate.mjs`. A commit needs a clean tree (staged = verified, no untracked files) and a green verify; a push needs its commit to be verified (a stamp of the verified tree skips a second run).
- CI (`.github/workflows/deploy.yml`) runs the same command on every PR and push to `main`; `deploy` needs `verify`, so a red build is never published.
- `--no-verify` bypasses only the local hooks; CI still blocks the deploy. To make PRs unmergeable on red, mark the `verify` check as required in the repository's branch protection (a GitHub setting, not code).

Code review: `.github/pull_request_template.md` holds the human checklist (what machines cannot judge: excerpt quality, duplication across tracks, token use, performance cost of new assets).

Not adopted (KISS/YAGNI), with the trigger to revisit:

| Tool | Why not now | Revisit when |
|---|---|---|
| Prettier / ESLint | no defect class not already caught; Prettier would rewrite Markdown posts | more than one regular code contributor |
| Husky | `core.hooksPath` does the same without a dependency | never |
| Tailwind / UI kit | ~300 lines of token-driven CSS; would force a rewrite of every template | a second site shares this design |
| OS matrix in CI | rendering differences across OS are fonts, handled by native stacks | a platform-specific bug is reported |
| Visual regression, Lighthouse CI | flaky thresholds; axe + layout + audit cover the regressions seen | traffic or performance becomes a goal |

## 5. Exit criteria (measured on this repository)

Before = commit `77c3139` (overflow, CLS, links, axe, duplication) and the SEO release `8e2f4e3` (First Contentful Paint comparison). Performance numbers are medians of 5 runs under 1.6 Mbps / 150 ms throttling.

| Criterion | Before | After |
|---|---|---|
| Template/route code | 830 lines, 18 files (3 cards, 3 layouts, 12 pages) | 343 lines, 12 files; per-track copy isolated in `section-view.ts` |
| New post | hand-written frontmatter and boilerplate | `npm run new`, schema-valid by construction |
| Posts missing the disclaimer | 13 of 28 | 0 (linter-enforced) |
| axe violations (WCAG 2.1 AA + best practice) | 5 rule classes, 428 nodes | 0 on 19 templates x 2 viewports |
| Horizontal overflow at 390px | all 28 posts (up to 4147px) | 0 of 71 pages |
| Mobile CLS, image-heavy post | 0.54 | 0 |
| First Contentful Paint, throttled | 416 / 464 / 424 ms | 428 / 480 / 428 ms (noise level) |
| Broken internal links | 50 | 0 |
| Gate runtime | none | about 70 s locally |

Convergence: after the last change a second clean-install `npm run verify` produced identical results (0 errors, 0 warnings, 11 + 12 tests green), and the consolidation was accepted only after a token-by-token comparison of all 184 built pages against the previous build (172 identical; 12 differ by one intended change).

Rollback rule applied: the bundled webfont failed the performance criterion and was removed.
