import { and, eq } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { kbDocuments } from '../db/schema.js';

// kleine deutsche/englische Stopwort-Liste – Füllwörter sollen Matches nicht verfälschen
const STOPWORDS = new Set([
  'der','die','das','und','oder','ist','sind','ein','eine','einen','wie','was','wo','wann',
  'warum','wieso','ich','du','wir','ihr','sie','es','am','an','in','im','auf','für','mit',
  'von','zu','zur','zum','den','dem','des','kann','könnt','könnte','habt','haben','hat','bei',
  'the','a','an','is','are','do','does','how','what','where','when','why','i','you','we',
  'to','of','for','with','on','at','can','could','your','my',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface FaqMatch {
  documentId: string;
  answer: string;
  score: number;
}

/**
 * Stufe 2 der Kaskade: exakter/Keyword-FAQ-Treffer ohne jeden LLM-Aufruf.
 * Heuristik: Anteil der inhaltstragenden Frage-Tokens, die in einem FAQ-Eintrag
 * vorkommen. Konservativ (min. 2 Treffer + Ratio), um Fehlauslösungen zu vermeiden.
 */
export async function matchFaq(tenantId: string, message: string): Promise<FaqMatch | null> {
  const db = tdb();
  const docs = await db
    .select()
    .from(kbDocuments)
    .where(and(eq(kbDocuments.tenantId, tenantId), eq(kbDocuments.sourceType, 'faq')));

  const qTokens = tokenize(message);
  if (qTokens.length === 0) return null;
  const qSet = new Set(qTokens);

  let best: FaqMatch | null = null;
  const normalizedMsg = message.toLowerCase().trim();

  for (const doc of docs) {
    if (doc.status !== 'published' || !doc.canonicalAnswer) continue;
    const haystack = `${doc.title ?? ''} ${doc.rawContent ?? ''}`;
    const docTokens = new Set(tokenize(haystack));

    let matched = 0;
    for (const t of qSet) if (docTokens.has(t)) matched++;
    const ratio = matched / qSet.size;

    // direkte Substring-Übereinstimmung der Frage zählt stark
    const titleLc = (doc.title ?? '').toLowerCase().trim();
    const substringHit =
      titleLc.length > 0 && (normalizedMsg.includes(titleLc) || titleLc.includes(normalizedMsg));

    const score = substringHit ? Math.max(ratio, 0.9) : ratio;
    const isHit = substringHit || (matched >= 2 && ratio >= 0.5);

    if (isHit && (!best || score > best.score)) {
      best = { documentId: doc.id, answer: doc.canonicalAnswer, score };
    }
  }
  return best;
}
