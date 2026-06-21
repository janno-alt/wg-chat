import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

/** pgvector erwartet das Literal "[a,b,c]"; hier zentral serialisiert. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  content: string;
  canonicalAnswer: string | null;
  title: string | null;
  sourceUrl: string | null;
  similarity: number;
}

/**
 * Cosine-Vektorsuche über die KB-Chunks eines Tenants. Strikt tenant-gescoped.
 * Liefert nach Ähnlichkeit absteigend; similarity = 1 - cosine_distance.
 */
export async function searchChunks(
  tenantId: string,
  embedding: number[],
  limit = 4,
): Promise<ChunkHit[]> {
  const vec = toVectorLiteral(embedding);
  const result = await db.execute(sql`
    SELECT c.id AS chunk_id,
           c.document_id,
           c.content,
           d.canonical_answer,
           d.title,
           d.source_url,
           1 - (c.embedding <=> ${vec}::vector) AS similarity
    FROM kb_chunks c
    JOIN kb_documents d ON d.id = c.document_id
    WHERE c.tenant_id = ${tenantId}
      AND c.embedding IS NOT NULL
      AND d.status = 'published'
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    chunkId: String(r.chunk_id),
    documentId: String(r.document_id),
    content: String(r.content),
    canonicalAnswer: (r.canonical_answer as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    similarity: Number(r.similarity),
  }));
}

export interface CacheHit {
  content: string;
  similarity: number;
}

/**
 * Semantischer Cache: war eine fast identische Frage schon einmal (teuer)
 * beantwortet? Sucht über frühere Bot-Antworten mit gespeichertem Frage-Embedding.
 */
export async function searchCache(
  tenantId: string,
  embedding: number[],
): Promise<CacheHit | null> {
  const vec = toVectorLiteral(embedding);
  const result = await db.execute(sql`
    SELECT m.content,
           1 - (m.query_embedding <=> ${vec}::vector) AS similarity
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.tenant_id = ${tenantId}
      AND m.role = 'bot'
      AND m.query_embedding IS NOT NULL
      AND m.answer_source IN ('retrieval','llm')
    ORDER BY m.query_embedding <=> ${vec}::vector
    LIMIT 1
  `);
  const row = (result.rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return { content: String(row.content), similarity: Number(row.similarity) };
}
