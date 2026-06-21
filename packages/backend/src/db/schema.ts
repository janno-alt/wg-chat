import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  vector,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle-Schema = typsichere Query-Schicht. Die tatsächliche DDL wird von
 * db/migrate.ts (idempotentes SQL) erzeugt – beide werden bewusst synchron gehalten,
 * damit der Stack ohne separaten "drizzle-kit generate"-Schritt lauffähig ist.
 *
 * Embedding-Dimension 1024 = mistral-embed. Anbieterwechsel => Migration nötig.
 */
export const EMBED_DIM = 1024;

export const answerSourceEnum = pgEnum('answer_source', [
  'rule',
  'faq',
  'cache',
  'retrieval',
  'llm',
  'human',
  'escalation',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // öffentlicher Schlüssel im Widget-Snippet (data-tenant)
  siteKey: varchar('site_key', { length: 64 }).notNull().unique(),
  // Origin-Whitelist; leer + ALLOW_ALL_ORIGINS=false => alles blockiert
  allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
  plan: varchar('plan', { length: 32 }).notNull().default('standard'),
  // monatliches Budget in EUR für LLM-/Embedding-Kosten; null = unbegrenzt
  monthlyBudgetEur: numeric('monthly_budget_eur', { precision: 10, scale: 2 }),
  // pro-Tenant Provider-/Modell-Overrides (überschreiben globale ENV-Defaults)
  llmProviderCfg: jsonb('llm_provider_cfg').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  locale: varchar('locale', { length: 8 }).notNull().default('de'),
  greeting: text('greeting').notNull().default('Hallo! Wie kann ich helfen?'),
  // Theme + Starter-Buttons + Fallback-Texte als flexibles JSON
  theme: jsonb('theme').$type<Record<string, unknown>>().notNull().default({}),
  starterButtons: jsonb('starter_buttons').$type<unknown[]>().notNull().default([]),
  fallbackText: text('fallback_text')
    .notNull()
    .default('Das gebe ich an unser Team weiter. Magst du mir kurz deine Kontaktdaten dalassen?'),
  // pro-Tenant Schwellen-Overrides (sonst ENV-Defaults)
  thresholds: jsonb('thresholds').$type<Record<string, number>>().notNull().default({}),
  // Lead-Handling (Phase 4): Empfänger-E-Mail + Webhook (CRM/FormBuilder/N8N)
  notifyEmail: text('notify_email'),
  leadWebhookUrl: text('lead_webhook_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // url | faq | file | manual
    sourceType: varchar('source_type', { length: 16 }).notNull(),
    sourceUrl: text('source_url'),
    title: text('title'),
    rawContent: text('raw_content').notNull().default(''),
    // bei sourceType=faq: die kanonische Antwort (für Direkt-Treffer ohne Generierung)
    canonicalAnswer: text('canonical_answer'),
    // draft | published | archived
    status: varchar('status', { length: 16 }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('kb_documents_tenant_idx').on(t.tenantId)],
);

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBED_DIM }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('kb_chunks_tenant_idx').on(t.tenantId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    pageUrl: text('page_url'),
    // open | escalated | closed
    status: varchar('status', { length: 16 }).notNull().default('open'),
    leadCaptured: boolean('lead_captured').notNull().default(false),
    handedOff: boolean('handed_off').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_tenant_idx').on(t.tenantId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // user | bot | agent
    role: varchar('role', { length: 8 }).notNull(),
    content: text('content').notNull(),
    answerSource: answerSourceEnum('answer_source'),
    // optionaler Cache-Schlüssel: Embedding der Nutzerfrage (für semantischen Cache)
    queryEmbedding: vector('query_embedding', { dimensions: EMBED_DIM }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)],
);

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    // embed | generate
    purpose: varchar('purpose', { length: 16 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costEur: numeric('cost_eur', { precision: 12, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_usage_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export const outreachTriggers = pgTable(
  'outreach_triggers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pageMatch: text('page_match').notNull().default('/'),
    // time_on_page | scroll_depth | idle | exit_intent | element_dwell
    condition: varchar('condition', { length: 24 }).notNull(),
    threshold: integer('threshold').notNull().default(30),
    selector: text('selector'),
    message: text('message').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outreach_tenant_idx').on(t.tenantId)],
);

export const knowledgeGaps = pgTable('knowledge_gaps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  frequency: integer('frequency').notNull().default(1),
  // open | suggested | resolved | dismissed
  status: varchar('status', { length: 16 }).notNull().default('open'),
  suggestedAnswer: text('suggested_answer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id'),
  name: text('name'),
  email: text('email'),
  phone: text('phone'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  pushedToCrm: boolean('pushed_to_crm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // owner | agent
  role: varchar('role', { length: 16 }).notNull().default('agent'),
  // null = Agentur-weit; sonst auf einen Tenant beschränkt
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
