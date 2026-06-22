import { getProviderForTenant, hasEmbeddings } from '../llm/index.js';
import { recordUsage } from './usage.js';
import { searchChunks, type ChunkHit } from './retrieval.js';
import { answerFromHits } from './cascade.js';
import { resolveThresholds, type ResolvedTenant } from './tenant.js';

export interface KnowledgeTestResult {
  hits: ChunkHit[];
  thresholds: { direct: number; rag: number };
  /** Die tatsächliche Antwort, die der Bot geben würde (inkl. LLM-Formulierung). */
  answer: { reply: string; source: 'retrieval' | 'llm' | 'escalation' };
}

/**
 * „Wissen testen" fürs Dashboard: embeddet die Testfrage, zeigt die besten KB-Treffer
 * mit Score UND – das ist der Punkt – die ECHTE Antwort des Bots (über denselben
 * Helfer wie der Live-Chat, d.h. mit LLM-Zusammenfassung). Muss im Tenant-Schema laufen.
 */
export async function testKnowledge(t: ResolvedTenant, query: string): Promise<KnowledgeTestResult> {
  if (!hasEmbeddings(t.llmProviderCfg)) {
    throw new Error('Kein LLM-API-Key konfiguriert – Suche/Embedding nicht möglich.');
  }
  const provider = getProviderForTenant(t.llmProviderCfg);
  const emb = await provider.embed([query]);
  await recordUsage({
    tenantId: t.id,
    provider: provider.name,
    model: provider.embedModel,
    purpose: 'embed',
    usage: emb.usage,
  });

  const hits = await searchChunks(t.id, emb.embeddings[0] ?? [], 8);
  const th = resolveThresholds(t);
  const ans = await answerFromHits(t, query, hits, { direct: th.direct, rag: th.rag }, provider, null);
  const answer = ans ?? { reply: t.settings.fallbackText, source: 'escalation' as const };

  return { hits, thresholds: { direct: th.direct, rag: th.rag }, answer };
}
