import { extractLinks, extractText, type ExtractedPage } from './html.js';

const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|ico|zip|rar|gz|mp4|mp3|css|js|json|woff2?|ttf|eot)(\?|$)/i;
const USER_AGENT = 'kine-chat-crawler/0.1 (+https://kine.media)';

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html') && !ct.includes('xml')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Eine einzelne Seite holen und in Text wandeln. */
export async function fetchPage(url: string): Promise<ExtractedPage | null> {
  const html = await fetchHtml(url);
  if (!html) return null;
  return extractText(html);
}

export interface CrawledPage {
  url: string;
  title: string | null;
  text: string;
}

/**
 * Crawlt eine Website: bevorzugt /sitemap.xml (schnell, vollständig), sonst BFS
 * ab der Start-URL – strikt same-host, mit Seiten-Limit. Liefert nur Seiten mit
 * nennenswertem Textinhalt.
 */
export async function crawlSite(startUrl: string, maxPages = 20): Promise<CrawledPage[]> {
  const start = new URL(startUrl);
  const host = start.host;
  const origin = start.origin;
  const pages: CrawledPage[] = [];

  // Sitemap-Fastpath
  const sitemap = await fetchHtml(`${origin}/sitemap.xml`);
  if (sitemap) {
    const locs = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
      .map((m) => m[1]!.trim())
      .filter((u) => sameHost(u, host) && !SKIP_EXT.test(u));
    const unique = [...new Set(locs)].slice(0, maxPages);
    if (unique.length) {
      for (const url of unique) {
        const page = await fetchPage(url);
        if (page && page.text.length >= 200) pages.push({ url, title: page.title, text: page.text });
      }
      if (pages.length) return pages;
    }
  }

  // BFS-Fallback
  const seen = new Set<string>();
  const queue: string[] = [start.toString()];
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await fetchHtml(url);
    if (!html) continue;
    const { title, text } = extractText(html);
    if (text.length >= 200) pages.push({ url, title, text });
    for (const link of extractLinks(html, url)) {
      try {
        const u = new URL(link);
        u.hash = '';
        const s = u.toString();
        if (u.host === host && !seen.has(s) && !SKIP_EXT.test(u.pathname)) queue.push(s);
      } catch {
        /* ignore */
      }
    }
  }
  return pages;
}

function sameHost(url: string, host: string): boolean {
  try {
    return new URL(url).host === host;
  } catch {
    return false;
  }
}
