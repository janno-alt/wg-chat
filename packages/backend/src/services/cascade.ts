import { and, eq, sql } from 'drizzle-orm';
import type { ChatRequest, ChatResponse, QuickReply } from '@kine-chat/shared';
import { db } from '../db/client.js';
import { knowledgeGaps } from '../db/schema.js';
import { getProviderForTenant } from '../llm/index.js';
import { resolveThresholds, type ResolvedTenant } from './tenant.js';
import { matchFaq } from './faq.js';
import { searchCache, searchChunks } from './retrieval.js';
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

    // ── Stufe 4: KB-Retrieval ──
    const hits = await searchChunks(t.id, embedding, 4);
    const top = hits[0];
    if (top && top.similarity >= th.direct) {
      // sehr hohe Ähnlichkeit → hinterlegte/kanonische Antwort direkt, ohne Generierung
      const answer = top.canonicalAnswer?.trim() || top.content.trim();
      log(`retrieval-direct sim=${top.similarity.toFixed(3)}`);
      await addBotMessage({
        conversationId: conv.id,
        content: answer,
        source: 'retrieval',
        queryEmbedding: embedding,
      });
      return { conversationId: conv.id, reply: answer, source: 'retrieval' };
    }

    // ── Stufe 5: RAG-Generierung (nur bei mittlerer Konfidenz UND innerhalb Budget) ──
    if (top && top.similarity >= th.rag) {
      const within = await canGenerate(t.id);
      if (!within) {
        log('budget exhausted → escalation statt RAG');
      } else {
        const context = hits
          .filter((h) => h.similarity >= th.rag)
          .map((h, i) => `[${i + 1}] ${h.content}`)
          .join('\n\n');
        try {
          const gen = await provider.generate(
            [
              {
                role: 'system',
                content:
                  `Du bist der Assistent von "${t.name}". Antworte kurz, freundlich und ` +
                  `AUSSCHLIESSLICH auf Basis des folgenden Kontexts. Wenn die Antwort nicht ` +
                  `eindeutig im Kontext steht, sage höflich, dass du das ans Team weiterleitest. ` +
                  `Erfinde nichts.\n\nKontext:\n${context}`,
              },
              { role: 'user', content: req.message },
            ],
            { temperature: 0.2, maxTokens: 400 },
          );
          await recordUsage({
            tenantId: t.id,
            conversationId: conv.id,
            provider: provider.name,
            model: provider.chatModel,
            purpose: 'generate',
            usage: gen.usage,
          });
          const reply = gen.text.trim();
          if (reply) {
            log(`rag generated sim=${top.similarity.toFixed(3)}`);
            await addBotMessage({
              conversationId: conv.id,
              content: reply,
              source: 'llm',
              queryEmbedding: embedding,
            });
            return { conversationId: conv.id, reply, source: 'llm' };
          }
        } catch (err) {
          log(`generate failed: ${(err as Error).message}`);
        }
      }
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

/** Unbeantwortete Frage als Wissenslücke protokollieren (Häufigkeit hochzählen). */
async function logKnowledgeGap(tenantId: string, question: string): Promise<void> {
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
