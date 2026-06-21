import '../env.js';
import { getPool } from './client.js';
import { EMBED_DIM } from './schema.js';

/**
 * Idempotente Migration in reinem SQL. Bewusst ohne drizzle-kit, damit
 * `docker compose up` + `npm run migrate` ohne Codegen-Schritt funktioniert.
 * DDL hier MUSS zum Drizzle-Schema (schema.ts) passen.
 */
const DDL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'answer_source') THEN
    CREATE TYPE answer_source AS ENUM
      ('rule','faq','cache','retrieval','llm','human','escalation');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  site_key varchar(64) NOT NULL UNIQUE,
  allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan varchar(32) NOT NULL DEFAULT 'standard',
  monthly_budget_eur numeric(10,2),
  llm_provider_cfg jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  locale varchar(8) NOT NULL DEFAULT 'de',
  greeting text NOT NULL DEFAULT 'Hallo! Wie kann ich helfen?',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  starter_buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_text text NOT NULL DEFAULT 'Das gebe ich an unser Team weiter. Magst du mir kurz deine Kontaktdaten dalassen?',
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_email text,
  lead_webhook_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Nachträgliche Spalten für bereits bestehende DBs (idempotent):
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_webhook_url text;

CREATE TABLE IF NOT EXISTS kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type varchar(16) NOT NULL,
  source_url text,
  title text,
  raw_content text NOT NULL DEFAULT '',
  canonical_answer text,
  status varchar(16) NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_documents_tenant_idx ON kb_documents(tenant_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(${EMBED_DIM}),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_chunks_tenant_idx ON kb_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id varchar(64) NOT NULL,
  page_url text,
  status varchar(16) NOT NULL DEFAULT 'open',
  lead_captured boolean NOT NULL DEFAULT false,
  handed_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON conversations(tenant_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role varchar(8) NOT NULL,
  content text NOT NULL,
  answer_source answer_source,
  query_embedding vector(${EMBED_DIM}),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid,
  provider varchar(32) NOT NULL,
  model varchar(64) NOT NULL,
  purpose varchar(16) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_eur numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_usage_tenant_created_idx ON llm_usage(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS outreach_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_match text NOT NULL DEFAULT '/',
  condition varchar(24) NOT NULL,
  threshold integer NOT NULL DEFAULT 30,
  selector text,
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_tenant_idx ON outreach_triggers(tenant_id);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question text NOT NULL,
  frequency integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'open',
  suggested_answer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid,
  name text,
  email text,
  phone text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pushed_to_crm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'agent',
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

async function main() {
  const pool = getPool();
  console.log('▶ Migration läuft …');
  await pool.query(DDL);
  console.log('✓ Migration abgeschlossen.');
  await pool.end();
}

main().catch((err) => {
  console.error('✗ Migration fehlgeschlagen:', err);
  process.exit(1);
});
