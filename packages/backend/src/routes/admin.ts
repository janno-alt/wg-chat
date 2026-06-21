import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { runForTenant, tdb } from '../db/client.js';
import { knowledgeGaps } from '../db/schema.js';
import { getConfig } from '../config.js';
import {
  createTenant,
  listTenants,
  resolveTenantBySiteKey,
  updateTenant,
  updateTenantSettings,
  type ResolvedTenant,
} from '../services/tenant.js';
import { getUsageSummary } from '../services/usage.js';
import { listLeads } from '../services/lead.js';
import { suggestGapAnswer } from '../services/gapsuggest.js';
import { getTranscript, listConversations } from '../services/conversation.js';
import { getSessionUser } from './auth.js';
import {
  crawlAndIngest,
  deleteDocument,
  ingestDocument,
  ingestUrl,
  listDocuments,
  publishDocument,
  reindexDocument,
} from '../services/ingestion.js';
import { generateFaqs } from '../services/faqgen.js';

/**
 * Gesicherte Admin-API. Zugang per Dashboard-Session-Cookie ODER x-admin-key (MCP).
 * Control-Plane-Endpunkte (tenants, settings) laufen in `public`; Daten-Endpunkte
 * (KB, Konversationen, Leads, Gaps, Kosten) laufen via inTenant() im Kunden-Schema.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req, reply) => {
    const key = getConfig().ADMIN_API_KEY;
    if (key && req.headers['x-admin-key'] === key) return;
    const user = await getSessionUser(req);
    if (user) return;
    return reply.code(401).send({ error: 'unauthorized', message: 'Anmeldung erforderlich.' });
  });

  const tenantOr404 = async (siteKey: string, reply: FastifyReply): Promise<ResolvedTenant | null> => {
    const t = await resolveTenantBySiteKey(siteKey);
    if (!t) {
      reply.code(404).send({ error: 'not_found', message: 'Unbekannter site_key.' });
      return null;
    }
    return t;
  };

  /** Führt einen Daten-Handler im Schema des Kunden aus (Isolation). */
  function inTenant<T>(t: ResolvedTenant, reply: FastifyReply, fn: () => Promise<T>) {
    if (!t.schemaName) {
      reply.code(503);
      return Promise.resolve({ error: 'not_provisioned', message: 'Tenant ist noch nicht eingerichtet.' });
    }
    return runForTenant(t.schemaName, fn);
  }

  // ── Tenants (Control-Plane, public) ──
  app.get('/tenants', async () => ({ tenants: await listTenants() }));

  const newTenantSchema = z.object({
    name: z.string().min(1).max(200),
    siteKey: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/i).optional(),
    allowedDomains: z.array(z.string()).optional(),
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
    plan: z.string().max(32).optional(),
  });
  app.post('/tenants', async (req, reply) => {
    const body = newTenantSchema.parse(req.body);
    try {
      return await createTenant(body);
    } catch (err) {
      reply.code(409);
      return { error: 'create_failed', message: (err as Error).message };
    }
  });

  const patchTenantSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    allowedDomains: z.array(z.string()).optional(),
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
    active: z.boolean().optional(),
    plan: z.string().max(32).optional(),
  });
  app.patch<{ Params: { siteKey: string } }>('/tenants/:siteKey', async (req, reply) => {
    const patch = patchTenantSchema.parse(req.body ?? {});
    const ok = await updateTenant(req.params.siteKey, patch);
    if (!ok) {
      reply.code(404);
      return { error: 'not_found', message: 'Unbekannter site_key.' };
    }
    return { ok: true };
  });

  // ── Wissensbasis (Daten-Plane, Kunden-Schema) ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/kb', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => ({ documents: await listDocuments(t.id) }));
  });

  const manualSchema = z.object({
    sourceType: z.enum(['manual', 'faq']).default('manual'),
    title: z.string().max(500).optional(),
    content: z.string().min(1),
    canonicalAnswer: z.string().optional(),
    status: z.enum(['draft', 'published', 'archived']).default('published'),
  });
  app.post<{ Params: { siteKey: string } }>('/:siteKey/kb/manual', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const body = manualSchema.parse(req.body);
    return inTenant(t, reply, () => ingestDocument(t.id, { ...body, llmCfg: t.llmProviderCfg }));
  });

  app.post<{ Params: { siteKey: string } }>('/:siteKey/kb/url', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    return inTenant(t, reply, async () => {
      try {
        return await ingestUrl(t.id, url, t.llmProviderCfg);
      } catch (err) {
        reply.code(422);
        return { error: 'ingest_failed', message: (err as Error).message };
      }
    });
  });

  app.post<{ Params: { siteKey: string } }>('/:siteKey/kb/crawl', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const cfg = getConfig();
    const { startUrl, maxPages } = z
      .object({ startUrl: z.string().url(), maxPages: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.body);
    return inTenant(t, reply, () =>
      crawlAndIngest(t.id, startUrl, maxPages ?? cfg.CRAWL_MAX_PAGES, t.llmProviderCfg),
    );
  });

  app.post<{ Params: { siteKey: string; docId: string } }>('/:siteKey/kb/:docId/reindex', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      const res = await reindexDocument(t.id, req.params.docId, t.llmProviderCfg);
      if (!res) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return res;
    });
  });

  app.post<{ Params: { siteKey: string; docId: string } }>('/:siteKey/kb/:docId/publish', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      const res = await publishDocument(t.id, req.params.docId, t.llmProviderCfg);
      if (!res) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return res;
    });
  });

  app.post<{ Params: { siteKey: string; docId: string } }>('/:siteKey/kb/:docId/faqgen', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const { count } = z.object({ count: z.coerce.number().int().min(1).max(20).optional() }).parse(req.body ?? {});
    return inTenant(t, reply, async () => {
      try {
        return await generateFaqs(t.id, req.params.docId, count ?? 5, t.llmProviderCfg);
      } catch (err) {
        reply.code(422);
        return { error: 'faqgen_failed', message: (err as Error).message };
      }
    });
  });

  app.delete<{ Params: { siteKey: string; docId: string } }>('/:siteKey/kb/:docId', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      const ok = await deleteDocument(t.id, req.params.docId);
      if (!ok) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return { deleted: true };
    });
  });

  // ── Kostenübersicht (pro Kunde) ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/usage', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => ({
      tenant: t.name,
      budgetEur: t.monthlyBudgetEur,
      ...(await getUsageSummary()),
    }));
  });

  // ── Wissenslücken ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/gaps', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      const gaps = await tdb()
        .select()
        .from(knowledgeGaps)
        .where(and(eq(knowledgeGaps.tenantId, t.id), eq(knowledgeGaps.status, 'open')))
        .orderBy(desc(knowledgeGaps.frequency))
        .limit(100);
      return { gaps };
    });
  });

  app.post<{ Params: { siteKey: string; gapId: string } }>('/:siteKey/gaps/:gapId/suggest', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      try {
        const res = await suggestGapAnswer(t.id, req.params.gapId, t.llmProviderCfg);
        if (!res) {
          reply.code(404);
          return { error: 'not_found', message: 'Wissenslücke nicht gefunden.' };
        }
        return res;
      } catch (err) {
        reply.code(422);
        return { error: 'suggest_failed', message: (err as Error).message };
      }
    });
  });

  // ── Leads ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/leads', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => ({ leads: await listLeads(t.id) }));
  });

  // ── Tenant-Einstellungen (Control-Plane, public) ──
  const settingsSchema = z.object({
    locale: z.string().max(8).optional(),
    greeting: z.string().max(1000).optional(),
    fallbackText: z.string().max(1000).optional(),
    theme: z.record(z.unknown()).optional(),
    starterButtons: z.array(z.unknown()).optional(),
    thresholds: z.record(z.number()).optional(),
    notifyEmail: z.string().email().nullable().optional(),
    leadWebhookUrl: z.string().url().nullable().optional(),
  });
  app.get<{ Params: { siteKey: string } }>('/:siteKey/settings', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return {
      tenant: {
        name: t.name,
        siteKey: t.siteKey,
        allowedDomains: t.allowedDomains,
        monthlyBudgetEur: t.monthlyBudgetEur,
        active: t.active,
      },
      settings: t.settings,
    };
  });

  app.put<{ Params: { siteKey: string } }>('/:siteKey/settings', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const patch = settingsSchema.parse(req.body ?? {});
    await updateTenantSettings(t.id, patch);
    return { ok: true };
  });

  // ── Konversationen + Transkript (Daten-Plane) ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/conversations', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => ({ conversations: await listConversations(t.id) }));
  });

  app.get<{ Params: { siteKey: string; id: string } }>('/:siteKey/conversations/:id', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return inTenant(t, reply, async () => {
      const transcript = await getTranscript(t.id, req.params.id);
      if (!transcript) {
        reply.code(404);
        return { error: 'not_found', message: 'Konversation nicht gefunden.' };
      }
      return transcript;
    });
  });
}
