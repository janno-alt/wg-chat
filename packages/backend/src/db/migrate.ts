import '../env.js';
import { getPool } from './client.js';
import { provisionSchema, schemaNameFor } from './provision.js';

/**
 * Globale Migration: Control-Plane + Agentur-Config in `public`. Die sensiblen
 * Kundendaten (KB, Konversationen, Leads, Kosten) liegen pro Kunde in einem eigenen
 * Schema – diese Tabellen erzeugt provisionSchema() (siehe provision.ts), aufgerufen
 * beim Anlegen eines Kunden und im Backfill unten.
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
  schema_name text,
  allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan varchar(32) NOT NULL DEFAULT 'standard',
  monthly_budget_eur numeric(10,2),
  llm_provider_cfg jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS schema_name text;

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
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_webhook_url text;

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
  console.log('▶ Migration (Control-Plane) läuft …');
  await pool.query(DDL);

  // Backfill: bestehende Kunden ohne Schema bekommen eins (Daten werden NICHT
  // automatisch migriert – Alt-Tenants ggf. neu anlegen/seeden).
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE schema_name IS NULL`,
  );
  for (const row of rows) {
    const schema = schemaNameFor(row.id);
    await provisionSchema(schema);
    await pool.query(`UPDATE tenants SET schema_name = $1 WHERE id = $2`, [schema, row.id]);
    console.log(`  ↳ Schema ${schema} für Tenant ${row.id} angelegt`);
  }

  console.log('✓ Migration abgeschlossen.');
  await pool.end();
}

main().catch((err) => {
  console.error('✗ Migration fehlgeschlagen:', err);
  process.exit(1);
});
