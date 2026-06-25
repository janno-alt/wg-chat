import { z } from 'zod';

/**
 * Zentrale, validierte Laufzeit-Konfiguration. Wirft beim Start, wenn etwas fehlt –
 * besser ein klarer Fehler beim Boot als ein stiller Fehlschlag mitten im Request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),

  LLM_PROVIDER: z.enum(['mistral']).default('mistral'),
  MISTRAL_API_KEY: z.string().default(''),
  MISTRAL_CHAT_MODEL: z.string().default('mistral-small-latest'),
  // Stärkeres Modell nur für die (seltene) Einstiegs-Generierung – bessere deutsche
  // Grammatik & Verkaufs-Copy. Pro Crawl je Seite ein Aufruf, daher vernachlässigbar.
  MISTRAL_OPENER_MODEL: z.string().default('mistral-large-latest'),
  MISTRAL_EMBED_MODEL: z.string().default('mistral-embed'),
  MISTRAL_BASE_URL: z.string().url().default('https://api.mistral.ai'),

  EMBEDDING_DIMENSIONS: z.coerce.number().default(1024),

  // Cosine-Ähnlichkeit (0..1). mistral-embed liefert eher niedrigere Werte –
  // daher bewusst moderate Schwellen, sonst eskaliert der Bot zu früh.
  SIMILARITY_DIRECT_THRESHOLD: z.coerce.number().default(0.8),
  SIMILARITY_RAG_THRESHOLD: z.coerce.number().default(0.4),
  SIMILARITY_CACHE_THRESHOLD: z.coerce.number().default(0.95),

  // pgvector HNSW: Recall/Speed-Tradeoff der ANN-Suche (höher = genauer, etwas langsamer).
  HNSW_EF_SEARCH: z.coerce.number().int().min(1).max(1000).default(100),

  // KB-Ingestion
  ADMIN_API_KEY: z.string().default(''),
  CRAWL_MAX_PAGES: z.coerce.number().default(20),
  CHUNK_MAX_CHARS: z.coerce.number().default(1000),
  CHUNK_OVERLAP: z.coerce.number().default(150),

  // Dashboard-Login (Session-Cookie, kein Key im Link)
  SESSION_SECRET: z.string().min(16).default('dev-insecure-session-secret-change-me'),
  ADMIN_EMAIL: z.string().default(''), // Bootstrap-Admin beim Start (optional)
  ADMIN_PASSWORD: z.string().default(''),
  // Pfad zum gebauten Dashboard (leer = aus dem Image: ../../dashboard/dist)
  DASHBOARD_DIST_DIR: z.string().default(''),

  // SMTP für Lead-Benachrichtigungen (optional; ohne SMTP_HOST = E-Mail deaktiviert)
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('wg-chat <no-reply@kine.media>'),

  ALLOW_ALL_ORIGINS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
