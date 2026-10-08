import type { APIContext } from 'astro';

// Everything is crawlable; thin archives opt out per page with <meta robots>.
// The Sitemap line is how Bing, DuckDuckGo and Yandex discover the sitemap
// without any webmaster-console registration.
export function GET(context: APIContext) {
  const site = context.site!.origin;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap-index.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
