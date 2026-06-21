import { getPool } from './client.js';
import { EMBED_DIM } from './schema.js';

/**
 * Schema-pro-Tenant (Phase 8b): die sensiblen Daten jedes Kunden leben in einem
 * eigenen Postgres-Schema `t_<id>`. Typen (vector, answer_source) liegen in public
 * und werden hier qualifiziert referenziert. So kann ein Bot technisch nur sein
 * eigenes Schema sehen – kein Zugriff auf fremde Kundendaten.
 */
export function schemaNameFor(tenantId: string): string {
  return `t_${tenantId.replace(/-/g, '')}`;
}

export function isValidSchema(schema: string): boolean {
  return /^[a-z0-9_]+$/i.test(schema) && schema.length <= 63;
}

function schemaDDL(schema: string): string {
  const s = `"${schema}"`;
  return /* sql */ `
CREATE SCHEMA IF NOT EXISTS ${s};

CREATE TABLE IF NOT EXISTS ${s}.kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_type varchar(16) NOT NULL,
  source_url text,
  title text,
  raw_content text NOT NULL DEFAULT '',
  canonical_answer text,
  status varchar(16) NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${s}.kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES ${s}.kb_documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding public.vector(${EMBED_DIM}),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
  ON ${s}.kb_chunks USING hnsw (embedding public.vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ${s}.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id varchar(64) NOT NULL,
  page_url text,
  status varchar(16) NOT NULL DEFAULT 'open',
  lead_captured boolean NOT NULL DEFAULT false,
  handed_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${s}.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ${s}.conversations(id) ON DELETE CASCADE,
  role varchar(8) NOT NULL,
  content text NOT NULL,
  answer_source public.answer_source,
  query_embedding public.vector(${EMBED_DIM}),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON ${s}.messages(conversation_id);

CREATE TABLE IF NOT EXISTS ${s}.llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  conversation_id uuid,
  provider varchar(32) NOT NULL,
  model varchar(64) NOT NULL,
  purpose varchar(16) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_eur numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_usage_created_idx ON ${s}.llm_usage(created_at);

CREATE TABLE IF NOT EXISTS ${s}.knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  question text NOT NULL,
  frequency integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'open',
  suggested_answer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${s}.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  conversation_id uuid,
  name text,
  email text,
  phone text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pushed_to_crm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
}

/** Legt das Schema eines Kunden samt Tabellen an (idempotent). */
export async function provisionSchema(schema: string): Promise<void> {
  if (!isValidSchema(schema)) throw new Error(`Ungültiger Schema-Name: ${schema}`);
  await getPool().query(schemaDDL(schema));
}
