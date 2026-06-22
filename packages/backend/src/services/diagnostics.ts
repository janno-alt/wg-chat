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
  /** Chunks im Kunden-Schema, die zu KEINEM Dokument gehören (Altlast/Buggy-Phase). */
  orphanChunks: number | null;
  /** Dokumente, die tatsächlich Chunks haben. */
  docsWithChunks: number | null;
  /** Anzahl mehrfach (gleiche URL) vorhandener Dokumente. */
  duplicateUrls: number | null;
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

/** Ein einzelner ::int-Skalar aus einer (schema-validierten) Query. */
async function scalar(query: string): Promise<number | null> {
  const c = await getPool().query<{ n: number }>(query);
  return c.rows[0]?.n ?? 0;
}

export interface PurgeResult {
  schemaChunks: number;
  schemaDocs: number;
  publicChunks: number;
  publicDocs: number;
  /** geleerte Konversationen = semantischer Cache (alte, evtl. rohe Antworten). */
  conversations: number;
}

async function tableExists(qualified: string): Promise<boolean> {
  return Boolean(await getPool().query('select to_regclass($1) as r', [qualified]).then((r) => r.rows[0]?.r));
}

/**
 * Löscht ALLE Wissensbasis-Daten eines Kunden – im Kunden-Schema (komplett) und die
 * Alt-Daten im public-Schema (auf diesen Tenant beschränkt). Leert AUSSERDEM die
 * Konversationen (= semantischer Cache), damit keine alten, vor dem Fix gespeicherten
 * Roh-Antworten mehr ausgeliefert werden. Leads bleiben erhalten.
 */
export async function purgeKb(schemaName: string | null, tenantId: string): Promise<PurgeResult> {
  const pool = getPool();
  const res: PurgeResult = { schemaChunks: 0, schemaDocs: 0, publicChunks: 0, publicDocs: 0, conversations: 0 };

  if (schemaName && isValidSchema(schemaName)) {
    const s = `"${schemaName}"`;
    if (await tableExists(`${schemaName}.kb_chunks`)) {
      res.schemaChunks = (await pool.query(`delete from ${s}.kb_chunks`)).rowCount ?? 0;
    }
    if (await tableExists(`${schemaName}.kb_documents`)) {
      res.schemaDocs = (await pool.query(`delete from ${s}.kb_documents`)).rowCount ?? 0;
    }
    // Konversationen leeren → messages werden per FK-Cascade entfernt (Cache-Reset).
    if (await tableExists(`${schemaName}.conversations`)) {
      res.conversations = (await pool.query(`delete from ${s}.conversations`)).rowCount ?? 0;
    }
  }

  if (await tableExists('public.kb_chunks')) {
    res.publicChunks = (await pool.query('delete from public.kb_chunks where tenant_id = $1', [tenantId])).rowCount ?? 0;
  }
  if (await tableExists('public.kb_documents')) {
    res.publicDocs = (await pool.query('delete from public.kb_documents where tenant_id = $1', [tenantId])).rowCount ?? 0;
  }
  if (await tableExists('public.conversations')) {
    res.conversations +=
      (await pool.query('delete from public.conversations where tenant_id = $1', [tenantId])).rowCount ?? 0;
  }
  return res;
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
  let orphanChunks: number | null = null;
  let docsWithChunks: number | null = null;
  let duplicateUrls: number | null = null;
  if (schemaName && isValidSchema(schemaName)) {
    const s = `"${schemaName}"`;
    tenantSchemaDocs = await qualifiedCount(`${s}.kb_documents`);
    tenantSchemaChunks = await qualifiedCount(`${s}.kb_chunks`);
    if (tenantSchemaChunks === null) {
      notes.push(`Tabelle "${schemaName}".kb_chunks existiert NICHT – Schema unvollständig provisioniert.`);
    } else {
      orphanChunks = await scalar(
        `select count(*)::int as n from ${s}.kb_chunks c where not exists (select 1 from ${s}.kb_documents d where d.id = c.document_id)`,
      );
      docsWithChunks = await scalar(
        `select count(*)::int as n from ${s}.kb_documents d where exists (select 1 from ${s}.kb_chunks c where c.document_id = d.id)`,
      );
      duplicateUrls = await scalar(
        `select count(*)::int as n from (select source_url from ${s}.kb_documents where source_url is not null group by source_url having count(*) > 1) x`,
      );
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
  if ((orphanChunks ?? 0) > 0) {
    notes.push(
      `${orphanChunks} Chunk(s) gehören zu KEINEM Dokument (Altlast aus der Buggy-Phase). Deshalb zeigt die Tabelle „keine Embeddings". → „KB komplett leeren" und EINMAL sauber neu crawlen.`,
    );
  }
  if ((docsWithChunks ?? 0) === 0 && (tenantSchemaDocs ?? 0) > 0 && (tenantSchemaChunks ?? 0) > 0) {
    notes.push(
      'Kein einziges Dokument ist mit seinen Chunks verknüpft – Dokumente und Chunks stammen aus verschiedenen (Buggy-)Läufen. → KB leeren und neu crawlen.',
    );
  }
  if ((duplicateUrls ?? 0) > 0) {
    notes.push(`${duplicateUrls} URL(s) sind mehrfach vorhanden (mehrfaches Crawlen) – Duplikate aufräumen.`);
  }
  if ((tenantSchemaChunks ?? 0) > 0 && appChunks === tenantSchemaChunks && (orphanChunks ?? 0) === 0 && (docsWithChunks ?? 0) > 0) {
    notes.push('App-Sicht und Schema stimmen überein – die Chunks sind korrekt verknüpft (kein Problem).');
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
    orphanChunks,
    docsWithChunks,
    duplicateUrls,
    notes,
  };
}
