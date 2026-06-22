import { and, desc, eq, sql } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { kbChunks, kbDocuments } from '../db/schema.js';
import { getConfig } from '../config.js';
import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
import { recordUsage } from './usage.js';
import { chunkText } from './chunking.js';
import { crawlSite, fetchPage } from './crawler.js';

export interface IngestResult {
  documentId: string;
  chunks: number;
  embedded: boolean;
  error?: string;
}

function batch<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Chunked, embedded und speichert kb_chunks für einen Dokumenttext. Liefert Anzahl. */
async function embedAndStore(
  tenantId: string,
  documentId: string,
  text: string,
  metadata: Record<string, unknown>,
  llmCfg: TenantLlmCfg,
): Promise<number> {
  if (!hasEmbeddings(llmCfg)) return 0;
  const cfg = getConfig();
  const chunks = chunkText(text, { maxChars: cfg.CHUNK_MAX_CHARS, overlap: cfg.CHUNK_OVERLAP });
  if (!chunks.length) return 0;

  const db = tdb();
  const provider = getProviderForTenant(llmCfg);
  let inserted = 0;
  for (const group of batch(chunks, 64)) {
    const { embeddings, usage } = await provider.embed(group);
    await recordUsage({
      tenantId,
      provider: provider.name,
      model: provider.embedModel,
      purpose: 'embed',
      usage,
    });
    const rows = group.map((content, i) => ({
      tenantId,
      documentId,
      content,
      embedding: embeddings[i] ?? null,
      metadata,
    }));
    await db.insert(kbChunks).values(rows);
    inserted += rows.length;
  }
  return inserted;
}

export interface IngestInput {
  sourceType: 'url' | 'faq' | 'file' | 'manual';
  sourceUrl?: string;
  title?: string;
  content: string;
  canonicalAnswer?: string;
  status?: 'draft' | 'published' | 'archived';
  llmCfg?: TenantLlmCfg;
}

/**
 * Embeddet einen Dokumenttext und ermittelt dabei einen klaren Fehlergrund, der am
 * Dokument (ingest_error) gespeichert wird – damit man im Dashboard sieht, WARUM
 * keine Embeddings entstanden sind.
 */
async function embedAndRecordError(
  tenantId: string,
  documentId: string,
  text: string,
  metadata: Record<string, unknown>,
  llmCfg: TenantLlmCfg,
): Promise<{ chunks: number; error?: string }> {
  let chunks = 0;
  let error: string | undefined;
  if (!hasEmbeddings(llmCfg)) {
    error = 'Kein MISTRAL_API_KEY am Backend gesetzt – es wurden keine Embeddings erzeugt.';
  } else if (!text || !text.trim()) {
    error = 'Kein Textinhalt zum Embedden (Seite leer / nur Bilder/Skripte?).';
  } else {
    try {
      chunks = await embedAndStore(tenantId, documentId, text, metadata, llmCfg);
      if (chunks === 0) error = 'Kein verwertbarer Text nach Bereinigung (zu kurz).';
    } catch (e) {
      error = `Embedding-Aufruf fehlgeschlagen: ${(e as Error).message}`;
    }
  }
  await tdb()
    .update(kbDocuments)
    .set({ ingestError: error ?? null })
    .where(eq(kbDocuments.id, documentId));
  return { chunks, error };
}

/** Dokument anlegen + (falls möglich) chunken/embedden. Fehlergrund wird gespeichert. */
export async function ingestDocument(tenantId: string, input: IngestInput): Promise<IngestResult> {
  const db = tdb();
  const [doc] = await db
    .insert(kbDocuments)
    .values({
      tenantId,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      title: input.title ?? null,
      rawContent: input.content,
      canonicalAnswer: input.canonicalAnswer ?? null,
      status: input.status ?? 'published',
    })
    .returning();

  const documentId = doc!.id;
  const { chunks, error } = await embedAndRecordError(
    tenantId,
    documentId,
    input.content,
    { sourceUrl: input.sourceUrl ?? null, sourceType: input.sourceType },
    input.llmCfg ?? {},
  );
  return { documentId, chunks, embedded: chunks > 0, error };
}

/** Bestehendes Dokument neu indexieren (z.B. nach Inhalts-/Provideränderung). */
export async function reindexDocument(
  tenantId: string,
  documentId: string,
  llmCfg: TenantLlmCfg = {},
): Promise<IngestResult | null> {
  const db = tdb();
  const [doc] = await db
    .select()
    .from(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)));
  if (!doc) return null;

  await db
    .delete(kbChunks)
    .where(and(eq(kbChunks.documentId, documentId), eq(kbChunks.tenantId, tenantId)));

  const { chunks, error } = await embedAndRecordError(
    tenantId,
    documentId,
    doc.rawContent,
    { sourceUrl: doc.sourceUrl, sourceType: doc.sourceType },
    llmCfg,
  );
  return { documentId, chunks, embedded: chunks > 0, error };
}

/** Einzelne URL holen, extrahieren und ingesten. */
export async function ingestUrl(
  tenantId: string,
  url: string,
  llmCfg: TenantLlmCfg = {},
): Promise<IngestResult> {
  const page = await fetchPage(url);
  if (!page || page.text.length < 50) {
    throw new Error(`Keine verwertbaren Inhalte unter ${url}`);
  }
  return ingestDocument(tenantId, {
    sourceType: 'url',
    sourceUrl: url,
    title: page.title ?? url,
    content: page.text,
    llmCfg,
  });
}

export interface CrawlResult {
  pagesFound: number;
  embedded: number;
  failed: number;
  errors: string[];
  documents: Array<{ url: string } & IngestResult>;
}

/** Website crawlen und alle Seiten als Dokumente ingesten – mit Fehler-Zusammenfassung. */
export async function crawlAndIngest(
  tenantId: string,
  startUrl: string,
  maxPages: number,
  llmCfg: TenantLlmCfg = {},
): Promise<CrawlResult> {
  const pages = await crawlSite(startUrl, maxPages);
  const documents: Array<{ url: string } & IngestResult> = [];
  const errors: string[] = [];
  let embedded = 0;
  let failed = 0;

  for (const p of pages) {
    let res: IngestResult;
    try {
      res = await ingestDocument(tenantId, {
        sourceType: 'url',
        sourceUrl: p.url,
        title: p.title ?? p.url,
        content: p.text,
        llmCfg,
      });
    } catch (e) {
      res = { documentId: '', chunks: 0, embedded: false, error: `Ingest-Fehler: ${(e as Error).message}` };
    }
    if (res.embedded) embedded++;
    if (res.error) {
      failed++;
      if (!errors.includes(res.error)) errors.push(res.error);
    }
    documents.push({ url: p.url, ...res });
  }

  if (pages.length === 0) {
    errors.push(
      'Keine erreichbaren Seiten gefunden – mögliche Ursachen: Sitemap leer/fehlt, keine internen Links (BFS), robots/Timeout, oder die Seite rendert Inhalte erst per JavaScript.',
    );
  }
  return { pagesFound: pages.length, embedded, failed, errors: errors.slice(0, 5), documents };
}

/** Entwurf freigeben: auf "published" setzen und (neu) embedden, damit retrievbar. */
export async function publishDocument(
  tenantId: string,
  documentId: string,
  llmCfg: TenantLlmCfg = {},
): Promise<IngestResult | null> {
  const db = tdb();
  const updated = await db
    .update(kbDocuments)
    .set({ status: 'published' })
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)))
    .returning({ id: kbDocuments.id });
  if (!updated.length) return null;
  return reindexDocument(tenantId, documentId, llmCfg);
}

export async function listDocuments(tenantId: string) {
  const db = tdb();
  const docs = await db
    .select({
      id: kbDocuments.id,
      sourceType: kbDocuments.sourceType,
      sourceUrl: kbDocuments.sourceUrl,
      title: kbDocuments.title,
      status: kbDocuments.status,
      ingestError: kbDocuments.ingestError,
      createdAt: kbDocuments.createdAt,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.tenantId, tenantId))
    .orderBy(desc(kbDocuments.createdAt));

  // Chunk-Zahl je Dokument separat (robust statt korrelierter Subquery) und in JS mergen.
  const counts = await db
    .select({ documentId: kbChunks.documentId, n: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(eq(kbChunks.tenantId, tenantId))
    .groupBy(kbChunks.documentId);
  const byDoc = new Map(counts.map((c) => [c.documentId, Number(c.n)]));

  return docs.map((d) => ({ ...d, chunkCount: byDoc.get(d.id) ?? 0 }));
}

/** Die extrahierten/embeddeten Chunks eines Dokuments (für die „Wissen"-Ansicht). */
export async function listChunks(documentId: string) {
  return tdb()
    .select({ id: kbChunks.id, content: kbChunks.content, metadata: kbChunks.metadata })
    .from(kbChunks)
    .where(eq(kbChunks.documentId, documentId))
    .limit(500);
}

export async function deleteDocument(tenantId: string, documentId: string): Promise<boolean> {
  const deleted = await tdb()
    .delete(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)))
    .returning({ id: kbDocuments.id });
  return deleted.length > 0;
}
