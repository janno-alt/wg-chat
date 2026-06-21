import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { adminFetch, apiBase } from './client.js';

const server = new McpServer({ name: 'wg-chat', version: '0.1.0' });

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Registriert ein Tool mit einheitlichem Fehler-Handling + JSON-Ausgabe. */
function tool(
  name: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: Record<string, any>) => Promise<unknown>,
): void {
  server.tool(name, description, shape, async (args: Record<string, any>) => {
    try {
      return ok(await run(args));
    } catch (e) {
      return { content: [{ type: 'text', text: `Fehler: ${(e as Error).message}` }], isError: true };
    }
  });
}

const siteKey = z.string().describe('Öffentlicher site_key des Tenants/Kunden');

// ── Tenants ──
tool('list_tenants', 'Listet alle Kunden (Tenants).', {}, () => adminFetch('GET', '/tenants'));

tool(
  'create_tenant',
  'Legt einen neuen Kunden an (mit Default-Einstellungen). siteKey wird generiert, wenn nicht angegeben.',
  {
    name: z.string(),
    siteKey: z.string().regex(/^[a-z0-9-]+$/i).optional(),
    allowedDomains: z.array(z.string()).optional().describe('Freigegebene Domains für das Widget'),
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
  },
  (a) => adminFetch('POST', '/tenants', a),
);

tool(
  'update_tenant',
  'Aktualisiert Stammdaten eines Kunden (Domains, Budget, aktiv …).',
  {
    siteKey,
    name: z.string().optional(),
    allowedDomains: z.array(z.string()).optional(),
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
    active: z.boolean().optional(),
  },
  ({ siteKey, ...patch }) => adminFetch('PATCH', `/tenants/${encodeURIComponent(siteKey)}`, patch),
);

// ── Wissensbasis ──
tool('list_knowledge', 'Listet die KB-Dokumente eines Kunden.', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/kb`),
);

tool(
  'add_faq',
  'Fügt ein FAQ (Frage + Antwort) zur Wissensbasis hinzu (0-LLM-Treffer im Chat).',
  { siteKey, question: z.string(), answer: z.string() },
  ({ siteKey, question, answer }) =>
    adminFetch('POST', `/${siteKey}/kb/manual`, {
      sourceType: 'faq',
      title: question,
      content: question,
      canonicalAnswer: answer,
    }),
);

tool(
  'add_text',
  'Fügt ein freies Textdokument zur Wissensbasis hinzu (wird gechunkt + embedded).',
  { siteKey, title: z.string().optional(), content: z.string() },
  ({ siteKey, title, content }) =>
    adminFetch('POST', `/${siteKey}/kb/manual`, { sourceType: 'manual', title, content }),
);

tool(
  'ingest_url',
  'Liest eine einzelne URL aus und indexiert ihren Inhalt.',
  { siteKey, url: z.string().url() },
  ({ siteKey, url }) => adminFetch('POST', `/${siteKey}/kb/url`, { url }),
);

tool(
  'crawl_site',
  'Crawlt eine Website (Sitemap/BFS) und indexiert die Seiten als Wissensbasis.',
  { siteKey, startUrl: z.string().url(), maxPages: z.number().int().min(1).max(200).optional() },
  ({ siteKey, startUrl, maxPages }) => adminFetch('POST', `/${siteKey}/kb/crawl`, { startUrl, maxPages }),
);

tool(
  'reindex_document',
  'Indexiert ein Dokument neu (neue Embeddings).',
  { siteKey, documentId: z.string() },
  ({ siteKey, documentId }) => adminFetch('POST', `/${siteKey}/kb/${documentId}/reindex`),
);

tool(
  'publish_document',
  'Gibt einen Entwurf frei (status=published) und embeddet ihn.',
  { siteKey, documentId: z.string() },
  ({ siteKey, documentId }) => adminFetch('POST', `/${siteKey}/kb/${documentId}/publish`),
);

tool(
  'generate_faqs',
  'Erzeugt per KI FAQ-Vorschläge aus einem Dokument (als Entwürfe; Freigabe nötig).',
  { siteKey, documentId: z.string(), count: z.number().int().min(1).max(20).optional() },
  ({ siteKey, documentId, count }) => adminFetch('POST', `/${siteKey}/kb/${documentId}/faqgen`, { count }),
);

tool(
  'delete_document',
  'Löscht ein KB-Dokument (samt Chunks).',
  { siteKey, documentId: z.string() },
  ({ siteKey, documentId }) => adminFetch('DELETE', `/${siteKey}/kb/${documentId}`),
);

// ── Konversationen / Leads / Wissenslücken ──
tool('list_conversations', 'Listet jüngste Konversationen eines Kunden.', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/conversations`),
);

tool(
  'get_transcript',
  'Liefert das vollständige Transkript einer Konversation.',
  { siteKey, conversationId: z.string() },
  ({ siteKey, conversationId }) => adminFetch('GET', `/${siteKey}/conversations/${conversationId}`),
);

tool('list_leads', 'Listet erfasste Leads eines Kunden.', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/leads`),
);

tool('list_gaps', 'Listet offene Wissenslücken (unbeantwortete Fragen, nach Häufigkeit).', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/gaps`),
);

tool(
  'suggest_gap_answer',
  'Erzeugt per RAG einen Antwort-Entwurf für eine Wissenslücke.',
  { siteKey, gapId: z.string() },
  ({ siteKey, gapId }) => adminFetch('POST', `/${siteKey}/gaps/${gapId}/suggest`),
);

// ── Kosten / Einstellungen ──
tool('get_usage', 'Kostenübersicht des laufenden Monats (pro Modell/Zweck) für einen Kunden.', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/usage`),
);

tool('get_settings', 'Liest Tenant-Einstellungen (Theme, Begrüßung, Lead-Ziele …).', { siteKey }, ({ siteKey }) =>
  adminFetch('GET', `/${siteKey}/settings`),
);

tool(
  'update_settings',
  'Aktualisiert Tenant-Einstellungen (Begrüßung, Fallback, Lead-Ziele, Theme …).',
  {
    siteKey,
    greeting: z.string().optional(),
    fallbackText: z.string().optional(),
    notifyEmail: z.string().email().nullable().optional(),
    leadWebhookUrl: z.string().url().nullable().optional(),
    theme: z.record(z.unknown()).optional(),
    starterButtons: z.array(z.unknown()).optional(),
    thresholds: z.record(z.number()).optional(),
  },
  ({ siteKey, ...patch }) => adminFetch('PUT', `/${siteKey}/settings`, patch),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs NUR auf stderr (stdout ist dem MCP-Protokoll vorbehalten).
  console.error(`wg-chat MCP-Server bereit. Backend: ${apiBase}`);
}

main().catch((err) => {
  console.error('MCP-Serverstart fehlgeschlagen:', err);
  process.exit(1);
});
