import { and, eq, sql } from 'drizzle-orm';
import type { ChatRequest, ChatResponse, QuickReply } from '@wg-chat/shared';
import { tdb } from '../db/client.js';
import { knowledgeGaps } from '../db/schema.js';
import { getProviderForTenant, type LlmProvider } from '../llm/index.js';
import { resolveThresholds, type ResolvedTenant } from './tenant.js';
import { matchFaq } from './faq.js';
import { searchCache, searchChunks, type ChunkHit } from './retrieval.js';
import { canGenerate, recordUsage } from './usage.js';
import {
  addBotMessage,
  addUserMessage,
  getOrCreateConversation,
  markEscalated,
} from './conversation.js';

type LogFn = (msg: string) => void;

/**
 * Die kostenbewusste Antwort-Kaskade. Reihenfolge billig → teuer:
 *   2) FAQ-Keyword (0 LLM)          3) semantischer Cache (1 Embedding)
 *   4) KB-Retrieval direkt (0 Gen)  5) RAG-Generierung (gegated)   6) Eskalation
 * (Stufe 1 = clientseitige Buttons, passiert im Widget ohne Server-Call.)
 */
export async function runCascade(
  t: ResolvedTenant,
  req: ChatRequest,
  log: LogFn = () => {},
): Promise<ChatResponse> {
  const conv = await getOrCreateConversation({
    tenantId: t.id,
    sessionId: req.sessionId,
    conversationId: req.conversationId,
    pageUrl: req.pageUrl,
  });
  await addUserMessage(conv.id, req.message);

  // Phase 7: Wenn ein Mensch übernommen hat, antwortet die KI nicht.
  if (conv.handedOff) {
    return {
      conversationId: conv.id,
      reply: '',
      source: 'human',
      human: true,
    };
  }

  const th = resolveThresholds(t);

  // ── Stufe 2: FAQ-Keyword-Treffer (0 LLM) ──
  const faq = await matchFaq(t.id, req.message);
  if (faq) {
    log(`faq hit score=${faq.score.toFixed(2)}`);
    await addBotMessage({ conversationId: conv.id, content: faq.answer, source: 'faq' });
    return { conversationId: conv.id, reply: faq.answer, source: 'faq' };
  }

  // Ab hier brauchen wir ein Embedding. Ohne Provider/Key → direkt eskalieren.
  const provider = getProviderForTenant(t.llmProviderCfg);
  let embedding: number[] | null = null;
  try {
    const emb = await provider.embed([req.message]);
    embedding = emb.embeddings[0] ?? null;
    await recordUsage({
      tenantId: t.id,
      conversationId: conv.id,
      provider: provider.name,
      model: provider.embedModel,
      purpose: 'embed',
      usage: emb.usage,
    });
  } catch (err) {
    log(`embed unavailable: ${(err as Error).message}`);
  }

  if (embedding) {
    // ── Stufe 3: semantischer Cache (keine Generierung) ──
    const cached = await searchCache(t.id, embedding);
    if (cached && cached.similarity >= th.cache) {
      log(`cache hit sim=${cached.similarity.toFixed(3)}`);
      await addBotMessage({ conversationId: conv.id, content: cached.content, source: 'cache' });
      return { conversationId: conv.id, reply: cached.content, source: 'cache' };
    }

    // ── Stufe 4+5: Retrieval → kuratierte Antwort ODER LLM-Zusammenfassung ──
    const hits = await searchChunks(t.id, embedding, 4);
    const ans = await answerFromHits(t, req.message, hits, th, provider, conv.id, log);
    if (ans) {
      await addBotMessage({
        conversationId: conv.id,
        content: ans.reply,
        source: ans.source,
        queryEmbedding: embedding,
      });
      return { conversationId: conv.id, reply: ans.reply, source: ans.source };
    }
  }

  // ── Stufe 6: Eskalation/Fallback (0 LLM) ──
  await logKnowledgeGap(t.id, req.message);
  await markEscalated(conv.id);
  const reply = t.settings.fallbackText;
  await addBotMessage({ conversationId: conv.id, content: reply, source: 'escalation' });
  const quickReplies: QuickReply[] = [
    { label: 'Kontakt hinterlassen', value: '__lead__' },
    { label: 'Mit Mensch sprechen', value: '__handoff__' },
  ];
  return { conversationId: conv.id, reply, source: 'escalation', escalate: true, quickReplies };
}

/** Chunk-Text für den LLM-Kontext säubern: Whitespace normalisieren, Länge kappen. */
function cleanContext(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function buildSystemPrompt(tenantName: string, context: string): string {
  return (
    `Du bist der freundliche Kundenberater von "${tenantName}". Beantworte die Frage in ` +
    `eigenen Worten, natürlich und knapp (2–4 Sätze), so wie ein Mitarbeiter es mündlich sagen ` +
    `würde. Stütze dich AUSSCHLIESSLICH auf den Kontext und fasse zusammen, statt zu zitieren. ` +
    `Gib NIEMALS HTML, Code, Menüpunkte oder rohe Textfragmente aus. Steht die Antwort nicht klar ` +
    `im Kontext, sage höflich, dass du das ans Team weiterleitest – erfinde nichts.\n\n` +
    `Kontext:\n${context}`
  );
}

export interface KbAnswer {
  reply: string;
  source: 'retrieval' | 'llm';
}

/**
 * Erzeugt aus Retrieval-Treffern die eigentliche Antwort und ist die EINE Quelle der
 * Wahrheit für den Bot UND das Dashboard-„Wissen testen". Kuratierte FAQ-Antworten
 * (canonicalAnswer) kommen direkt; gecrawlte Seiteninhalte werden vom LLM zu einer
 * eigenständigen Antwort zusammengefasst. null → nichts Brauchbares (→ Eskalation).
 * Schreibt llm_usage bei Generierung (echte Kosten, auch im Test).
 */
export async function answerFromHits(
  t: ResolvedTenant,
  question: string,
  hits: ChunkHit[],
  th: { direct: number; rag: number },
  provider: LlmProvider,
  conversationId: string | null,
  log: LogFn = () => {},
): Promise<KbAnswer | null> {
  const top = hits[0];
  if (!top) return null;

  // Kuratierte FAQ-Antwort bei hoher Ähnlichkeit → direkt, ohne Generierung.
  if (top.canonicalAnswer?.trim() && top.similarity >= th.direct) {
    log(`retrieval-direct (canonical) sim=${top.similarity.toFixed(3)}`);
    return { reply: top.canonicalAnswer.trim(), source: 'retrieval' };
  }

  // Seiteninhalte → LLM-Zusammenfassung (innerhalb Budget).
  if (top.similarity >= th.rag) {
    const within = await canGenerate(t.monthlyBudgetEur);
    if (!within) {
      log('budget exhausted → escalation statt RAG');
      return null;
    }
    const context = hits
      .filter((h) => h.similarity >= th.rag)
      .slice(0, 4)
      .map((h, i) => `[${i + 1}] ${cleanContext(h.content)}`)
      .join('\n\n');
    if (!context) return null;
    try {
      const gen = await provider.generate(
        [
          { role: 'system', content: buildSystemPrompt(t.name, context) },
          { role: 'user', content: question },
        ],
        { temperature: 0.2, maxTokens: 400 },
      );
      await recordUsage({
        tenantId: t.id,
        conversationId: conversationId ?? undefined,
        provider: provider.name,
        model: provider.chatModel,
        purpose: 'generate',
        usage: gen.usage,
      });
      const reply = gen.text.trim();
      if (reply) {
        log(`rag generated sim=${top.similarity.toFixed(3)}`);
        return { reply, source: 'llm' };
      }
    } catch (err) {
      log(`generate failed: ${(err as Error).message}`);
    }
  }
  return null;
}

/** Unbeantwortete Frage als Wissenslücke protokollieren (Häufigkeit hochzählen). */
async function logKnowledgeGap(tenantId: string, question: string): Promise<void> {
  const db = tdb();
  const q = question.trim().slice(0, 1000);
  if (!q) return;
  const [existing] = await db
    .select({ id: knowledgeGaps.id })
    .from(knowledgeGaps)
    .where(
      and(
        eq(knowledgeGaps.tenantId, tenantId),
        eq(knowledgeGaps.status, 'open'),
        sql`lower(${knowledgeGaps.question}) = lower(${q})`,
      ),
    );
  if (existing) {
    await db
      .update(knowledgeGaps)
      .set({ frequency: sql`${knowledgeGaps.frequency} + 1` })
      .where(eq(knowledgeGaps.id, existing.id));
  } else {
    await db.insert(knowledgeGaps).values({ tenantId, question: q });
  }
}
