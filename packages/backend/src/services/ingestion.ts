import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
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

/** Dokument anlegen + (falls Key vorhanden) chunken/embedden. */
export async function ingestDocument(tenantId: string, input: IngestInput): Promise<IngestResult> {
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
  const chunks = await embedAndStore(
    tenantId,
    documentId,
    input.content,
    { sourceUrl: input.sourceUrl ?? null, sourceType: input.sourceType },
    input.llmCfg ?? {},
  );
  return { documentId, chunks, embedded: chunks > 0 };
}

/** Bestehendes Dokument neu indexieren (z.B. nach Inhalts-/Provideränderung). */
export async function reindexDocument(
  tenantId: string,
  documentId: string,
  llmCfg: TenantLlmCfg = {},
): Promise<IngestResult | null> {
  const [doc] = await db
    .select()
    .from(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)));
  if (!doc) return null;

  await db
    .delete(kbChunks)
    .where(and(eq(kbChunks.documentId, documentId), eq(kbChunks.tenantId, tenantId)));

  const chunks = await embedAndStore(
    tenantId,
    documentId,
    doc.rawContent,
    { sourceUrl: doc.sourceUrl, sourceType: doc.sourceType },
    llmCfg,
  );
  return { documentId, chunks, embedded: chunks > 0 };
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
  documents: Array<{ url: string } & IngestResult>;
}

/** Website crawlen und alle Seiten als Dokumente ingesten. */
export async function crawlAndIngest(
  tenantId: string,
  startUrl: string,
  maxPages: number,
  llmCfg: TenantLlmCfg = {},
): Promise<CrawlResult> {
  const pages = await crawlSite(startUrl, maxPages);
  const documents: Array<{ url: string } & IngestResult> = [];
  for (const p of pages) {
    const res = await ingestDocument(tenantId, {
      sourceType: 'url',
      sourceUrl: p.url,
      title: p.title ?? p.url,
      content: p.text,
      llmCfg,
    });
    documents.push({ url: p.url, ...res });
  }
  return { pagesFound: pages.length, documents };
}

/** Entwurf freigeben: auf "published" setzen und (neu) embedden, damit retrievbar. */
export async function publishDocument(
  tenantId: string,
  documentId: string,
  llmCfg: TenantLlmCfg = {},
): Promise<IngestResult | null> {
  const updated = await db
    .update(kbDocuments)
    .set({ status: 'published' })
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)))
    .returning({ id: kbDocuments.id });
  if (!updated.length) return null;
  return reindexDocument(tenantId, documentId, llmCfg);
}

export async function listDocuments(tenantId: string) {
  return db
    .select({
      id: kbDocuments.id,
      sourceType: kbDocuments.sourceType,
      sourceUrl: kbDocuments.sourceUrl,
      title: kbDocuments.title,
      status: kbDocuments.status,
      createdAt: kbDocuments.createdAt,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.tenantId, tenantId))
    .orderBy(desc(kbDocuments.createdAt));
}

export async function deleteDocument(tenantId: string, documentId: string): Promise<boolean> {
  const deleted = await db
    .delete(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.tenantId, tenantId)))
    .returning({ id: kbDocuments.id });
  return deleted.length > 0;
}
