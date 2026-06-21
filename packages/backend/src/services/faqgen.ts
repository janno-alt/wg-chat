import { and, eq } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { kbDocuments } from '../db/schema.js';
import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
import { recordUsage } from './usage.js';

export interface FaqSuggestion {
  question: string;
  answer: string;
}

export interface FaqGenResult {
  suggestions: FaqSuggestion[];
  createdDocumentIds: string[];
}

/**
 * Erzeugt aus dem Text eines Dokuments per LLM FAQ-Vorschläge (Q/A) und legt sie
 * als FAQ-Entwürfe (status="draft") an – ein Mensch gibt sie später frei
 * (kein Auto-Publish). Das ist die "KI-gestützte Erweiterung" der Wissensbasis.
 */
export async function generateFaqs(
  tenantId: string,
  documentId: string,
  count = 5,
  llmCfg: TenantLlmCfg = {},
): Promise<FaqGenResult> {
  if (!hasEmbeddings(llmCfg)) {
    throw new Error('Kein LLM-API-Key konfiguriert – FAQ-Generierung nicht möglich.');
  }
  const db = tdb();
  const [doc] = await db
    .select()
    .from(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)));
  if (!doc) throw new Error('Dokument nicht gefunden.');

  const provider = getProviderForTenant(llmCfg);
  const context = doc.rawContent.slice(0, 6000); // Kontext begrenzen → Kosten begrenzen
  const gen = await provider.generate(
    [
      {
        role: 'system',
        content:
          `Erzeuge aus dem folgenden Seiteninhalt bis zu ${count} häufige Kundenfragen ` +
          `mit knappen, sachlichen Antworten – ausschließlich auf Basis des Inhalts, ` +
          `nichts erfinden. Antworte NUR mit JSON: ` +
          `{"faqs":[{"question":"…","answer":"…"}]}. Sprache: Deutsch.`,
      },
      { role: 'user', content: context },
    ],
    { temperature: 0.3, maxTokens: 900 },
  );
  await recordUsage({
    tenantId,
    provider: provider.name,
    model: provider.chatModel,
    purpose: 'generate',
    usage: gen.usage,
  });

  const suggestions = parseFaqs(gen.text).slice(0, count);
  const createdDocumentIds: string[] = [];
  for (const s of suggestions) {
    const [created] = await db
      .insert(kbDocuments)
      .values({
        tenantId,
        sourceType: 'faq',
        title: s.question,
        rawContent: s.question,
        canonicalAnswer: s.answer,
        status: 'draft', // Freigabe durch Mensch erforderlich
        sourceUrl: doc.sourceUrl,
      })
      .returning({ id: kbDocuments.id });
    createdDocumentIds.push(created!.id);
  }
  return { suggestions, createdDocumentIds };
}

/** Robustes Parsen der LLM-Antwort (mit/ohne Code-Fences, mit Fallback-Regex). */
function parseFaqs(text: string): FaqSuggestion[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const tryParse = (s: string): FaqSuggestion[] | null => {
    try {
      const obj = JSON.parse(s);
      const arr = Array.isArray(obj) ? obj : obj.faqs;
      if (!Array.isArray(arr)) return null;
      return arr
        .map((x: any) => ({
          question: String(x.question ?? x.q ?? '').trim(),
          answer: String(x.answer ?? x.a ?? '').trim(),
        }))
        .filter((x: FaqSuggestion) => x.question && x.answer);
    } catch {
      return null;
    }
  };
  return tryParse(cleaned) ?? tryParse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) ?? [];
}
