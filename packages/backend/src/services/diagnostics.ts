import { sql } from 'drizzle-orm';
import { getPool, tdb } from '../db/client.js';
import { isValidSchema } from '../db/provision.js';

/**
 * Bodenwahrheit aus der LIVE-Datenbank: WO liegen die Dokumente/Chunks wirklich und
 * WAS sieht die App über ihren Tenant-Pool? Damit lässt sich der Widerspruch
 * „Crawl meldet Embeddings, Liste zeigt keine“ aus der Ferne diagnostizieren.
 */
export interface KbDiagnostics {
  schemaName: string | null;
  /** Effektiver search_path der Tenant-Verbindung (so liest/schreibt die App). */
  searchPath: string;
  /** Was die App unqualifiziert sieht (genau wie listDocuments / die Chunk-Zählung). */
  appDocs: number;
  appChunks: number;
  /** Schema-qualifiziert gezählt (umgeht den search_path) – die echte Lage der Daten. */
  tenantSchemaDocs: number | null;
  tenantSchemaChunks: number | null;
  /** Alt-Daten aus der Zeit vor Schema-pro-Kunde (Phase 8b) liegen evtl. noch hier. */
  publicDocs: number | null;
  publicChunks: number | null;
  notes: string[];
}

async function qualifiedCount(qualified: string): Promise<number | null> {
  const pool = getPool();
  const reg = await pool.query<{ r: string | null }>('select to_regclass($1) as r', [qualified]);
  if (!reg.rows[0]?.r) return null;
  // qualified entsteht ausschließlich aus validierten Schema-Namen → kein Injection-Risiko.
  const c = await pool.query<{ n: number }>(`select count(*)::int as n from ${qualified}`);
  return c.rows[0]?.n ?? 0;
}

export async function kbDiagnostics(schemaName: string | null): Promise<KbDiagnostics> {
  const t = tdb();
  const notes: string[] = [];

  const sp = (await t.execute(sql`show search_path`)) as unknown as { rows: Array<{ search_path: string }> };
  const searchPath = sp.rows[0]?.search_path ?? '(unbekannt)';

  const appDocsRes = (await t.execute(sql`select count(*)::int as n from kb_documents`)) as unknown as {
    rows: Array<{ n: number }>;
  };
  const appChunksRes = (await t.execute(sql`select count(*)::int as n from kb_chunks`)) as unknown as {
    rows: Array<{ n: number }>;
  };
  const appDocs = appDocsRes.rows[0]?.n ?? 0;
  const appChunks = appChunksRes.rows[0]?.n ?? 0;

  let tenantSchemaDocs: number | null = null;
  let tenantSchemaChunks: number | null = null;
  if (schemaName && isValidSchema(schemaName)) {
    tenantSchemaDocs = await qualifiedCount(`"${schemaName}".kb_documents`);
    tenantSchemaChunks = await qualifiedCount(`"${schemaName}".kb_chunks`);
    if (tenantSchemaChunks === null) {
      notes.push(`Tabelle "${schemaName}".kb_chunks existiert NICHT – Schema unvollständig provisioniert.`);
    }
  } else {
    notes.push('Tenant hat keinen gültigen schema_name – Daten landen evtl. im public-Schema.');
  }

  const publicDocs = await qualifiedCount('public.kb_documents');
  const publicChunks = await qualifiedCount('public.kb_chunks');

  // Interpretation
  if (appChunks === 0 && (tenantSchemaChunks ?? 0) > 0) {
    notes.push(
      `Die App sieht 0 Chunks, im Schema liegen aber ${tenantSchemaChunks}. → search_path greift beim Lesen nicht (steht: "${searchPath}").`,
    );
  }
  if (appChunks === 0 && (publicChunks ?? 0) > 0 && (tenantSchemaChunks ?? 0) === 0) {
    notes.push(
      `Chunks liegen im public-Schema (${publicChunks}), nicht im Kunden-Schema. → Beim Schreiben war search_path = public.`,
    );
  }
  if ((tenantSchemaChunks ?? 0) > 0 && appChunks === tenantSchemaChunks) {
    notes.push('App-Sicht und Schema stimmen überein – die Chunks sind sichtbar (kein Schema-Problem).');
  }

  return {
    schemaName,
    searchPath,
    appDocs,
    appChunks,
    tenantSchemaDocs,
    tenantSchemaChunks,
    publicDocs,
    publicChunks,
    notes,
  };
}
