/**
 * Minimale, dependency-freie HTML→Text-Extraktion. Bewusst regex-basiert –
 * ausreichend für Marketing-/Content-Seiten. Für anspruchsvollere Fälle lässt
 * sich später ein echter Parser (z.B. readability/cheerio) dahinter tauschen.
 */
export interface ExtractedPage {
  title: string | null;
  text: string;
}

// Tag-Erkennung, die `>` INNERHALB von Attribut-Anführungszeichen überspringt –
// nötig für Elementor/WordPress, die JSON (mit `>`) in data-Attribute schreiben.
const TAG_RE = /<[a-zA-Z!/][^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g;

export function extractText(html: string): ExtractedPage {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Titel aus <head> holen, BEVOR der Kopfbereich entfernt wird.
  const titleMatch = noScript.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, ' ').trim() : null;

  // Nicht-Inhalt entfernen (Kopf, SVG-Pfade, eingebettete iframes/Formulare),
  // dann Block-Elemente in Zeilenumbrüche wandeln, damit Wörter nicht verkleben.
  const body = noScript
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|th|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Tags strippen → Entities dekodieren → erneut strippen (entfernt als Text
  // maskiertes HTML wie &lt;div&gt;, das sonst im Wissens-Chunk landen würde).
  const text = decodeEntities(body.replace(TAG_RE, ' '))
    .replace(TAG_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  return { title, text };
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1]!, baseUrl);
      u.hash = '';
      out.push(u.toString());
    } catch {
      /* ungültige URL ignorieren */
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&#0?34;/g, '"');
}
