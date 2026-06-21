import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
import { recordUsage } from './usage.js';
import { searchChunks, type ChunkHit } from './retrieval.js';

/**
 * Diagnose-/Einsicht-Suche fürs Dashboard: embeddet eine Testfrage und liefert die
 * besten KB-Treffer inkl. Ähnlichkeits-Score. Zeigt, was der Bot „weiß" und warum
 * er ggf. eskaliert (Score unter der RAG-Schwelle). Muss im Tenant-Schema laufen.
 */
export async function searchKnowledge(
  tenantId: string,
  query: string,
  llmCfg: TenantLlmCfg = {},
  limit = 8,
): Promise<ChunkHit[]> {
  if (!hasEmbeddings(llmCfg)) {
    throw new Error('Kein LLM-API-Key konfiguriert – Suche/Embedding nicht möglich.');
  }
  const provider = getProviderForTenant(llmCfg);
  const emb = await provider.embed([query]);
  await recordUsage({
    tenantId,
    provider: provider.name,
    model: provider.embedModel,
    purpose: 'embed',
    usage: emb.usage,
  });
  return searchChunks(tenantId, emb.embeddings[0] ?? [], limit);
}
