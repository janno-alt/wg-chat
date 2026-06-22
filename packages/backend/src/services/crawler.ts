import { extractLinks, extractText, type ExtractedPage } from './html.js';

const SKIP_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|ico|zip|rar|gz|mp4|mp3|css|js|json|xml|woff2?|ttf|eot)(\?|$)/i;
const USER_AGENT = 'wg-chat-crawler/0.1 (+https://kine.media)';

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html') && !ct.includes('xml') && !ct.includes('text')) return null;
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

/** Sitemap-Verweise aus robots.txt lesen (zuverlässigster Einstieg). */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  const txt = await fetchHtml(`${origin}/robots.txt`, 6000);
  if (!txt) return [];
  return [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!.trim());
}

/**
 * Sammelt rekursiv die ECHTEN Seiten-URLs aus einer Sitemap. Behandelt den
 * WordPress-/Yoast-/RankMath-Fall „sitemapindex" (eine Sitemap, die auf weitere
 * Sitemaps verweist) korrekt – sonst würden die Sub-Sitemap-XML-Dateien selbst
 * als Inhaltsseiten eingelesen.
 */
async function collectSitemapUrls(
  sitemapUrl: string,
  host: string,
  limit: number,
  depth: number,
  seen: Set<string>,
): Promise<string[]> {
  if (depth > 3 || limit <= 0 || seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);
  const xml = await fetchHtml(sitemapUrl);
  if (!xml) return [];

  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((m) => m[1]!.trim())
    .filter((u) => sameHost(u, host));

  // Sitemap-Index → jede <loc> ist eine weitere Sitemap, in die wir absteigen.
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const out: string[] = [];
    for (const sub of locs) {
      if (out.length >= limit) break;
      const more = await collectSitemapUrls(sub, host, limit - out.length, depth + 1, seen);
      for (const u of more) if (!out.includes(u)) out.push(u);
    }
    return out;
  }

  // urlset → echte Seiten; XML/Assets herausfiltern (nie Sitemaps ingesten).
  return locs.filter((u) => !SKIP_EXT.test(u));
}

/**
 * Crawlt eine Website: bevorzugt Sitemaps (robots.txt + gängige Pfade, inkl.
 * Sitemap-Index-Rekursion), sonst BFS ab der Start-URL – strikt same-host, mit
 * Seiten-Limit. Liefert nur Seiten mit nennenswertem Textinhalt.
 */
export async function crawlSite(startUrl: string, maxPages = 20): Promise<CrawledPage[]> {
  const start = new URL(startUrl);
  const host = start.host;
  const origin = start.origin;
  const pages: CrawledPage[] = [];

  // 1) Sitemap-Einstiegspunkte: robots.txt + WordPress-/Standardpfade.
  const candidates = [
    ...(await sitemapsFromRobots(origin)),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];
  const seenSitemaps = new Set<string>();
  const urls: string[] = [];
  for (const sm of candidates) {
    if (urls.length >= maxPages) break;
    if (!sameHost(sm, host)) continue;
    const found = await collectSitemapUrls(sm, host, maxPages - urls.length, 0, seenSitemaps);
    for (const u of found) if (!urls.includes(u)) urls.push(u);
  }

  const unique = [...new Set(urls)].slice(0, maxPages);
  if (unique.length) {
    for (const url of unique) {
      const page = await fetchPage(url);
      if (page && page.text.length >= 200) pages.push({ url, title: page.title, text: page.text });
    }
    if (pages.length) return pages;
  }

  // 2) BFS-Fallback (keine nutzbare Sitemap gefunden).
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
