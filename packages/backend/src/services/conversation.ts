import { and, asc, desc, eq } from 'drizzle-orm';
import type { AnswerSource } from '@wg-chat/shared';
import { tdb } from '../db/client.js';
import { conversations, messages } from '../db/schema.js';

export interface ConversationRow {
  id: string;
  tenantId: string;
  status: string;
  handedOff: boolean;
}

/** Bestehende Konversation laden oder neu anlegen (tenant-isoliertes Schema via tdb()). */
export async function getOrCreateConversation(params: {
  tenantId: string;
  sessionId: string;
  conversationId?: string;
  pageUrl?: string;
}): Promise<ConversationRow> {
  const db = tdb();
  if (params.conversationId) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, params.conversationId),
          eq(conversations.tenantId, params.tenantId),
        ),
      );
    if (existing) {
      return {
        id: existing.id,
        tenantId: existing.tenantId,
        status: existing.status,
        handedOff: existing.handedOff,
      };
    }
  }
  const [created] = await db
    .insert(conversations)
    .values({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      pageUrl: params.pageUrl ?? null,
    })
    .returning();
  return {
    id: created!.id,
    tenantId: created!.tenantId,
    status: created!.status,
    handedOff: created!.handedOff,
  };
}

export async function addUserMessage(conversationId: string, content: string): Promise<void> {
  await tdb().insert(messages).values({ conversationId, role: 'user', content });
}

/**
 * Bot-Antwort speichern. Bei retrieval/llm wird das Frage-Embedding mitgespeichert,
 * damit der semantische Cache spätere identische Fragen ohne Generierung beantwortet.
 */
export async function addBotMessage(params: {
  conversationId: string;
  content: string;
  source: AnswerSource;
  queryEmbedding?: number[] | null;
}): Promise<void> {
  await tdb().insert(messages).values({
    conversationId: params.conversationId,
    role: 'bot',
    content: params.content,
    answerSource: params.source,
    queryEmbedding:
      params.queryEmbedding && params.queryEmbedding.length ? params.queryEmbedding : null,
  });
}

export async function markEscalated(conversationId: string): Promise<void> {
  await tdb()
    .update(conversations)
    .set({ status: 'escalated' })
    .where(eq(conversations.id, conversationId));
}

/** Einzelne Konversation (tenant-gescoped) oder null. */
export async function getConversation(tenantId: string, conversationId: string) {
  const [c] = await tdb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  return c ?? null;
}

/** Live-Übernahme an/aus schalten (pausiert/aktiviert die KI für diese Konversation). */
export async function setHandedOff(
  tenantId: string,
  conversationId: string,
  value: boolean,
): Promise<void> {
  await tdb()
    .update(conversations)
    .set({ handedOff: value })
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
}

/** Nachricht eines menschlichen Agenten speichern. */
export async function addAgentMessage(conversationId: string, content: string): Promise<void> {
  await tdb()
    .insert(messages)
    .values({ conversationId, role: 'agent', content, answerSource: 'human' });
}

/** Jüngste Konversationen eines Tenants (fürs Dashboard). */
export async function listConversations(tenantId: string) {
  return tdb()
    .select({
      id: conversations.id,
      sessionId: conversations.sessionId,
      pageUrl: conversations.pageUrl,
      status: conversations.status,
      leadCaptured: conversations.leadCaptured,
      handedOff: conversations.handedOff,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.createdAt))
    .limit(100);
}

/** Vollständiges Transkript einer Konversation (tenant-gescoped). */
export async function getTranscript(tenantId: string, conversationId: string) {
  const db = tdb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  if (!conv) return null;
  const msgs = await db
    .select({
      role: messages.role,
      content: messages.content,
      answerSource: messages.answerSource,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return { conversation: conv, messages: msgs };
}
