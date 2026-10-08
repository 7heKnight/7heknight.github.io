## What and why
<!-- One or two lines: the change and the reason. -->

## Gates
- [ ] `npm run verify` is green (the git hooks run it on commit and push; CI runs it again)

## Review checklist
**Content**
- [ ] New posts come from `npm run new` and keep the educational / authorized-testing disclaimer
- [ ] `excerpt` is a real 1-2 sentence summary (it becomes the meta description); `updated` is set only for material revisions
- [ ] Images are under `public/<track>/<slug>/` with meaningful alt text

**Code**
- [ ] No logic or markup copied between tracks: shared behaviour lives in `src/components`, `src/layouts` or `src/lib`
- [ ] Colours, spacing and type use tokens from `src/styles/tokens.css` (no new hard-coded values)
- [ ] A new content track is added only to `src/content/taxonomy.mjs` (+ its schema) and `src/lib/section-view.ts`
- [ ] No horizontal scroll at 390px; keyboard focus is visible; headings do not skip levels

**Performance and SEO**
- [ ] No new render-blocking requests, fonts or scripts without a measured benefit
- [ ] New or moved URLs keep their old path working (GitHub Pages has no redirects)
