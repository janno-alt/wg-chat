import { and, eq, sql } from 'drizzle-orm';
import type { ChatRequest, ChatResponse, QuickReply } from '@wg-chat/shared';
import { tdb } from '../db/client.js';
import { knowledgeGaps } from '../db/schema.js';
import { getProviderForTenant, type LlmProvider, type ChatMessage } from '../llm/index.js';
import { resolveThresholds, type ResolvedTenant } from './tenant.js';
import { matchFaq } from './faq.js';
import { searchCache, searchChunks, type ChunkHit } from './retrieval.js';
import { canGenerate, recordUsage } from './usage.js';
import {
  addBotMessage,
  addUserMessage,
  getOrCreateConversation,
  getRecentHistory,
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
  // Den angezeigten Gesprächseinstieg als ersten Bot-Turn übernehmen (nur bei neuer
  // Konversation), damit der Verlauf kohärent ist und "Nö"/"erzähl mal" Bezug haben.
  if (req.opener) {
    const prior = await getRecentHistory(conv.id, 1);
    if (!prior.length) await addBotMessage({ conversationId: conv.id, content: req.opener.slice(0, 300), source: 'rule' });
  }
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

  // ── Hoch-Intent: Terminwunsch / Kontaktwunsch (0 LLM) ──
  const intent = detectIntent(req.message);
  if (intent === 'booking') {
    if (t.settings.bookingUrl) {
      const reply = 'Sehr gern! Du kannst direkt hier einen passenden Termin auswählen:';
      await addBotMessage({ conversationId: conv.id, content: reply, source: 'rule' });
      return { conversationId: conv.id, reply, source: 'rule', booking: t.settings.bookingUrl };
    }
    const reply = 'Sehr gern! Lass mir kurz deine Kontaktdaten da, dann stimmen wir einen Termin ab.';
    await addBotMessage({ conversationId: conv.id, content: reply, source: 'rule' });
    return {
      conversationId: conv.id,
      reply,
      source: 'rule',
      escalate: true,
      quickReplies: [
        { label: 'Kontaktdaten hinterlassen', value: '__lead__' },
        { label: 'Mit Mensch sprechen', value: '__handoff__' },
      ],
    };
  }
  if (intent === 'lead') {
    const hasBooking = Boolean(t.settings.bookingUrl);
    const reply = hasBooking
      ? 'Sehr gern! Du kannst direkt einen Termin buchen oder mir kurz deine Kontaktdaten dalassen, dann meldet sich unser Team.'
      : 'Gerne! Hinterlasse mir kurz deine Kontaktdaten, dann meldet sich unser Team bei dir.';
    await addBotMessage({ conversationId: conv.id, content: reply, source: 'rule' });
    const quickReplies: QuickReply[] = [
      ...(hasBooking ? [{ label: 'Termin buchen', value: '__booking__' }] : []),
      { label: 'Kontaktdaten hinterlassen', value: '__lead__' },
      { label: 'Mit Mensch sprechen', value: '__handoff__' },
    ];
    return { conversationId: conv.id, reply, source: 'rule', escalate: true, quickReplies };
  }

  // ── Stufe 2: FAQ-Keyword-Treffer (0 LLM) ──
  const faq = await matchFaq(t.id, req.message);
  if (faq) {
    log(`faq hit score=${faq.score.toFixed(2)}`);
    await addBotMessage({ conversationId: conv.id, content: faq.answer, source: 'faq' });
    return { conversationId: conv.id, reply: faq.answer, source: 'faq' };
  }

  // Der bisherige Gesprächsverlauf (inkl. Opener) – für kontextbewusste Antworten.
  const history = (await getRecentHistory(conv.id, 8)) as ChatMessage[];

  // Ab hier brauchen wir ein Embedding. Ohne Provider/Key → direkt eskalieren.
  const provider = getProviderForTenant(t.llmProviderCfg);
  // Kontextbewusste Suchanfrage: letzte Bot-Frage + aktuelle Nachricht, damit kurze
  // Folgeantworten ("ja", "erzähl mal") beim Thema bleiben statt zufällig zu treffen.
  const priorAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content;
  const retrievalQuery = priorAssistant ? `${priorAssistant}\n${req.message}` : req.message;
  let embedding: number[] | null = null;
  try {
    const emb = await provider.embed([retrievalQuery]);
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

    // ── Stufe 4+5: Retrieval + kontextbewusste, gesprächsorientierte Antwort ──
    const hits = await searchChunks(t.id, embedding, 5);
    const ans = await answerFromHits(t, history, hits, th, provider, conv.id, log);
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

/**
 * Erkennt hoch-intentionale Wünsche per Schlüsselwort (0 LLM): Terminbuchung vor
 * allgemeinem Kontakt. So bekommt der Nutzer sofort das Buchungstool bzw. das
 * Lead-Formular, statt auf einen Button verwiesen zu werden.
 */
function detectIntent(message: string): 'booking' | 'lead' | null {
  const m = message.toLowerCase();
  if (
    /\btermin\b/.test(m) ||
    /\b(buchen|buchung)\b/.test(m) ||
    /\b(beratungsgespräch|erstgespräch|kennenlerngespräch|kennenlernen)\b/.test(m) ||
    /\bmeeting\b/.test(m) ||
    /\bvideo[- ]?call\b/.test(m) ||
    /termin.{0,12}(vereinbaren|ausmachen|machen|buchen|finden)/.test(m) ||
    /(call|gespräch).{0,12}(vereinbaren|buchen|ausmachen)/.test(m)
  ) {
    return 'booking';
  }
  if (
    /\b(kontakt|kontaktformular|formular|angebot|rückruf|zurückrufen|anrufen|telefonieren|telefonat|expressanfrage)\b/.test(m) ||
    /(ruft|meldet|melden)\s+(mich|euch|ihr|sie)/.test(m) ||
    /meine\s+(e-?mail|nummer|telefon|telefonnummer|daten|kontaktdaten)/.test(m) ||
    /(mit\s+(einem|nem|'nem|jemandem|jemand)\s+)?(echten\s+)?(menschen|mitarbeiter|mitarbeitenden|berater|kollegen|team|mensch)\b/.test(m) ||
    /(jemand|persönlich|direkt)\w*\s+(sprechen|reden|telefonieren|austauschen)/.test(m) ||
    /\banfrage\b.{0,12}(stellen|schicken|senden|machen)/.test(m)
  ) {
    return 'lead';
  }
  return null;
}

/** Chunk-Text für den LLM-Kontext säubern: Whitespace normalisieren, Länge kappen. */
function cleanContext(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

/** Macht LLM-Text menschlicher: entfernt Gedankenstriche (—/–) und selbst erfundene Links/URLs. */
function humanize(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1') // Markdown-Link → nur der Text
    .replace(/https?:\/\/\S+/g, '') // nackte URLs entfernen (Bot soll keine Links erfinden)
    .replace(/\s*—\s*/g, ', ') // Geviertstrich → Komma
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2') // Zahlbereich: Halbgeviert → Bindestrich
    .replace(/\s*–\s*/g, ', ') // sonstiger Halbgeviertstrich → Komma
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildSystemPrompt(tenantName: string, context: string, hasContext: boolean): string {
  const base =
    `Du bist ein sympathischer, kompetenter Berater/Verkäufer von "${tenantName}" im Live-Chat. ` +
    `Führe das Gespräch natürlich weiter, wie ein guter Mitarbeiter im Laden.\n` +
    `Regeln:\n` +
    `- Beziehe dich auf den bisherigen Verlauf. Kurze Antworten wie "Nö", "ja" oder "erzähl mal" ` +
    `beziehen sich auf DEINE letzte Frage – reagiere passend und frage NICHT zurück, was gemeint ist.\n` +
    `- Bleib beim aktuellen Thema des Gesprächs. Wechsle NICHT unvermittelt zu einem anderen Angebot.\n` +
    `- Konkrete Fakten (Preise, Zahlen, Leistungen, Pakete) NUR, wenn sie wörtlich im Kontext stehen. ` +
    `Erfinde nichts, nenne keine Beispiele/Branchen/Zahlen, die nicht im Kontext stehen. Trenne einmalige ` +
    `Leistungen klar von laufenden/monatlichen Kosten und vermische sie nicht.\n` +
    `- Du darfst gesprächig sein (nachfragen, einordnen, eine kurze Rückfrage stellen), aber behaupte keine ` +
    `Fakten über die Firma, die nicht im Kontext stehen.\n` +
    `- Steht etwas Konkretes nicht im Kontext, sage ehrlich, dass du das gern ans Team weitergibst, oder ` +
    `schlage ein kurzes, unverbindliches Erstgespräch vor.\n` +
    `- Gib NIEMALS selbst Links, URLs, E-Mail-Adressen oder Buchungsadressen aus und erfinde keine. Wenn ` +
    `der Nutzer einen Termin, ein Formular, Kontakt oder ein Gespräch mit einem Menschen möchte, sage nur ` +
    `kurz zu – Terminbuchung bzw. Kontaktformular werden vom System automatisch eingeblendet.\n` +
    `- Natürlich und knapp (2–4 Sätze). Keine Gedankenstriche (— oder –), kein HTML, kein Code.\n`;
  return hasContext
    ? `${base}\nKontext (Wissensbasis):\n${context}`
    : `${base}\n(Kein passender Wissens-Eintrag gefunden – bleib beim Gesprächsverlauf, werde nicht ` +
        `konkret zu Leistungen oder Preisen, sondern verstehe den Bedarf oder biete ein Erstgespräch an.)`;
}

export interface KbAnswer {
  reply: string;
  source: 'retrieval' | 'llm';
}

/**
 * Erzeugt die eigentliche Antwort und ist die EINE Quelle der Wahrheit für Bot UND
 * Dashboard-„Wissen testen". `history` ist der Gesprächsverlauf (chronologisch, endet
 * mit der aktuellen Nutzernachricht). Kuratierte FAQ-Antworten kommen direkt; sonst
 * antwortet das LLM gesprächs- und kontextbewusst. Bei laufendem Dialog wird auch ohne
 * starken KB-Treffer geantwortet (z.B. auf "Nö"), aber ohne Fakten zu erfinden.
 * null → nichts Sinnvolles möglich (→ Eskalation). Schreibt llm_usage bei Generierung.
 */
export async function answerFromHits(
  t: ResolvedTenant,
  history: ChatMessage[],
  hits: ChunkHit[],
  th: { direct: number; rag: number },
  provider: LlmProvider,
  conversationId: string | null,
  log: LogFn = () => {},
): Promise<KbAnswer | null> {
  const top = hits[0];

  // Kuratierte FAQ-Antwort bei hoher Ähnlichkeit → direkt, ohne Generierung.
  if (top?.canonicalAnswer?.trim() && top.similarity >= th.direct) {
    log(`retrieval-direct (canonical) sim=${top.similarity.toFixed(3)}`);
    return { reply: top.canonicalAnswer.trim(), source: 'retrieval' };
  }

  const hasContext = Boolean(top && top.similarity >= th.rag);
  const inConversation = history.length >= 3; // Opener + ≥1 Nutzer + … = laufender Dialog
  // Kalt + kein Treffer + kein laufendes Gespräch → eskalieren.
  if (!hasContext && !inConversation) return null;

  const within = await canGenerate(t.monthlyBudgetEur);
  if (!within) {
    log('budget exhausted → escalation statt RAG');
    return null;
  }

  const context = hasContext
    ? hits
        .filter((h) => h.similarity >= th.rag)
        .slice(0, 4)
        .map((h, i) => `[${i + 1}] ${cleanContext(h.content)}`)
        .join('\n\n')
    : '';

  try {
    const gen = await provider.generate(
      [{ role: 'system', content: buildSystemPrompt(t.name, context, hasContext) }, ...history.slice(-8)],
      { temperature: 0.3, maxTokens: 400 },
    );
    await recordUsage({
      tenantId: t.id,
      conversationId: conversationId ?? undefined,
      provider: provider.name,
      model: provider.chatModel,
      purpose: 'generate',
      usage: gen.usage,
    });
    const reply = humanize(gen.text.trim());
    if (reply) {
      log(`generated hasContext=${hasContext} sim=${top ? top.similarity.toFixed(3) : 'n/a'}`);
      return { reply, source: 'llm' };
    }
  } catch (err) {
    log(`generate failed: ${(err as Error).message}`);
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
