import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { knowledgeGaps } from '../db/schema.js';
import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
import { recordUsage } from './usage.js';
import { searchChunks } from './retrieval.js';

export interface GapSuggestion {
  answer: string;
  sources: Array<string | null>;
}

/**
 * Erzeugt für eine offene Wissenslücke einen Antwort-Entwurf per RAG über die
 * bestehende KB. Speichert ihn an der Lücke (status="suggested") – ein Mensch
 * gibt ihn später frei und überführt ihn in einen FAQ-Eintrag.
 */
export async function suggestGapAnswer(
  tenantId: string,
  gapId: string,
  llmCfg: TenantLlmCfg = {},
): Promise<GapSuggestion | null> {
  const [gap] = await db
    .select()
    .from(knowledgeGaps)
    .where(and(eq(knowledgeGaps.id, gapId), eq(knowledgeGaps.tenantId, tenantId)));
  if (!gap) return null;
  if (!hasEmbeddings(llmCfg)) {
    throw new Error('Kein LLM-API-Key konfiguriert – Vorschlag nicht möglich.');
  }

  const provider = getProviderForTenant(llmCfg);
  const emb = await provider.embed([gap.question]);
  await recordUsage({
    tenantId,
    provider: provider.name,
    model: provider.embedModel,
    purpose: 'embed',
    usage: emb.usage,
  });

  const hits = await searchChunks(tenantId, emb.embeddings[0] ?? [], 5);
  const context = hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n\n');

  const gen = await provider.generate(
    [
      {
        role: 'system',
        content:
          `Formuliere einen kurzen, sachlichen FAQ-Antwort-Entwurf auf die Kundenfrage – ` +
          `ausschließlich auf Basis des Kontexts. Steht es nicht im Kontext, schreibe ` +
          `"(Antwort recherchieren – nicht aus den Inhalten ableitbar)". Nichts erfinden.\n\n` +
          `Kontext:\n${context || '(kein Kontext gefunden)'}`,
      },
      { role: 'user', content: gap.question },
    ],
    { temperature: 0.2, maxTokens: 350 },
  );
  await recordUsage({
    tenantId,
    provider: provider.name,
    model: provider.chatModel,
    purpose: 'generate',
    usage: gen.usage,
  });

  const answer = gen.text.trim();
  await db
    .update(knowledgeGaps)
    .set({ suggestedAnswer: answer, status: 'suggested' })
    .where(eq(knowledgeGaps.id, gapId));

  return { answer, sources: hits.map((h) => h.sourceUrl) };
}
