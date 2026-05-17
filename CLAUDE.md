# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- All assistant output must be in English, even when the user writes in Vietnamese.

## What this is

A static personal cybersecurity blog deployed via **GitHub Pages** (repo `7heKnight/7heknight.github.io`, served at the repo root). Hand-authored HTML/CSS/JS — there is **no build step, no framework, no bundler**. Files are served as-is. `package.json` exists only to pull in Playwright for local QA screenshots; the `test` script is a stub and does not run anything.

## Local development

```bash
python3 -m http.server 8765      # serve the site at http://127.0.0.1:8765
node .playwright-demo.mjs        # QA pass: screenshots + 404/JS-error report (server must be running on :8765)
```

`.playwright-demo.mjs` loads every page (desktop 1366×900 + mobile 390×844), writes screenshots to `.playwright-shots/`, and flags non-200 responses, failed requests, and page JS errors. Run it after any markup/style/path change — it is the closest thing to a test suite. Add new pages to its `pages` array so they get checked. `.playwright-shots/` is throwaway output, not committed source.

## Page architecture

Every page is a standalone HTML document that repeats the same skeleton: `<head>` (stylesheet + favicon + `js/script.js`), a `<header>` nav, a `<main>`, and a shared `<footer>` with social icons. There is no templating — **the nav and footer are copy-pasted into every file**, so a nav/footer change must be applied to all HTML files consistently.

Path convention is the load-bearing rule:
- Root-level pages (`index.html`, `about.html`, `category.html`, `copyright.html`) reference assets with relative paths (`css/...`, `js/...`, `icon/...`).
- Posts live in `post/` (one level down) and reference assets with `../` prefixes.

Getting this wrong produces 404s that only the Playwright QA pass will catch.

### Layout contract (driven by `css/style.css`)

`css/style.css` styles pages by **structural class names**, not per-page CSS. Reusing the right wrapper class is what makes a new page match the site:
- Home post list: `.main_page_panel` > `article` > `.index_post`.
- Post / about pages: a three-column `main` of `.left_panel` (table of contents) · `.center_panel` (body) · `.right_panel` (related). `about.html` uses this layout with empty side panels.
- Category page: `.cat_main` with `.cat_sidebar` + `.cat_content`.
- Content cards use `.about_card`; in-page nav lists use `.toc_list`; post metadata uses `.post_meta` / `.post_tags` / `.post_body`.

Theme is a fixed dark palette: background `#242424`, accent `#ffcc00`. `css/copyright.css` is scoped to `copyright.html` only.

### `js/script.js`

The only JavaScript. `window.onload` sets the `#title` element in the nav based on `window.location.pathname` (a `titles` map for known root pages; anything under `post` shows "Reading blog"). `show_table_category` / `hide_table_category` are category-table hover helpers. If you add a root page, add it to the `titles` map so the nav title renders.

## Adding a new post

1. Copy `post/_template.html` into `post/`, rename it to a kebab-case slug (e.g. `my-post.html`), and replace every `[PLACEHOLDER]`. Keep the structure intact so shared styles/nav apply.
2. Add a card to the home list in `index.html` (`.main_page_panel`).
3. Add a `<li>` to the matching category section in `category.html` (the `#kill-chain` / `#web-security` / `#network` / `#ctf` sections, and the sidebar `.toc_list`).
4. Add the new path to the `pages` array in `.playwright-demo.mjs` and run the QA pass.

Existing posts (`post/cyber-kill-chain.html`, `http-methods-web-security.html`, `network-protocols-recon.html`, `ctf-writeup-web-101.html`) are the working examples to follow over the bare template.

## Conventions

- Dates: human text plus a machine `<time datetime="...Z">` attribute — keep both in sync.
- Content is security-education material; the site explicitly states everything is for educational/authorized testing only (see `about.html` / `copyright.html`) — keep that framing in new posts.
