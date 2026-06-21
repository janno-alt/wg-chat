import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
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
 * Gesicherte Admin-/Ingestion-API (Header `x-admin-key` === ADMIN_API_KEY).
 * Brücke bis zum Web-Dashboard (Phase 5) und Andockpunkt für den MCP-Server
 * (Phase 6). Als eigenes Plugin registriert → der Auth-Hook gilt nur hier.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req, reply) => {
    const key = getConfig().ADMIN_API_KEY;
    if (!key) {
      return reply.code(503).send({ error: 'admin_disabled', message: 'ADMIN_API_KEY nicht gesetzt.' });
    }
    if (req.headers['x-admin-key'] !== key) {
      return reply.code(401).send({ error: 'unauthorized', message: 'x-admin-key fehlt oder falsch.' });
    }
  });

  const tenantOr404 = async (siteKey: string, reply: FastifyReply): Promise<ResolvedTenant | null> => {
    const t = await resolveTenantBySiteKey(siteKey);
    if (!t) {
      reply.code(404).send({ error: 'not_found', message: 'Unbekannter site_key.' });
      return null;
    }
    return t;
  };

  // ── Tenants (Agentur-weit) ──
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

  // ── KB lesen ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/kb', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return { documents: await listDocuments(t.id) };
  });

  // ── Manuelles Dokument / FAQ ──
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
    return ingestDocument(t.id, { ...body, llmCfg: t.llmProviderCfg });
  });

  // ── Einzelne URL ──
  app.post<{ Params: { siteKey: string } }>('/:siteKey/kb/url', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    try {
      return await ingestUrl(t.id, url, t.llmProviderCfg);
    } catch (err) {
      reply.code(422);
      return { error: 'ingest_failed', message: (err as Error).message };
    }
  });

  // ── Website crawlen ──
  app.post<{ Params: { siteKey: string } }>('/:siteKey/kb/crawl', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const cfg = getConfig();
    const { startUrl, maxPages } = z
      .object({
        startUrl: z.string().url(),
        maxPages: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.body);
    return crawlAndIngest(t.id, startUrl, maxPages ?? cfg.CRAWL_MAX_PAGES, t.llmProviderCfg);
  });

  // ── Reindex ──
  app.post<{ Params: { siteKey: string; docId: string } }>(
    '/:siteKey/kb/:docId/reindex',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
      const res = await reindexDocument(t.id, req.params.docId, t.llmProviderCfg);
      if (!res) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return res;
    },
  );

  // ── Entwurf freigeben (publish + embed) ──
  app.post<{ Params: { siteKey: string; docId: string } }>(
    '/:siteKey/kb/:docId/publish',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
      const res = await publishDocument(t.id, req.params.docId, t.llmProviderCfg);
      if (!res) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return res;
    },
  );

  // ── KI-FAQ-Generierung (Entwürfe) ──
  app.post<{ Params: { siteKey: string; docId: string } }>(
    '/:siteKey/kb/:docId/faqgen',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
      const { count } = z.object({ count: z.coerce.number().int().min(1).max(20).optional() }).parse(req.body ?? {});
      try {
        return await generateFaqs(t.id, req.params.docId, count ?? 5, t.llmProviderCfg);
      } catch (err) {
        reply.code(422);
        return { error: 'faqgen_failed', message: (err as Error).message };
      }
    },
  );

  // ── Dokument löschen ──
  app.delete<{ Params: { siteKey: string; docId: string } }>(
    '/:siteKey/kb/:docId',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
      const ok = await deleteDocument(t.id, req.params.docId);
      if (!ok) {
        reply.code(404);
        return { error: 'not_found', message: 'Dokument nicht gefunden.' };
      }
      return { deleted: true };
    },
  );

  // ── Kostenübersicht (pro Kunde) ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/usage', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return { tenant: t.name, budgetEur: t.monthlyBudgetEur, ...(await getUsageSummary(t.id)) };
  });

  // ── Wissenslücken ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/gaps', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    const gaps = await db
      .select()
      .from(knowledgeGaps)
      .where(and(eq(knowledgeGaps.tenantId, t.id), eq(knowledgeGaps.status, 'open')))
      .orderBy(desc(knowledgeGaps.frequency))
      .limit(100);
    return { gaps };
  });

  // ── KI-Antwortvorschlag für eine Wissenslücke (RAG über die KB) ──
  app.post<{ Params: { siteKey: string; gapId: string } }>(
    '/:siteKey/gaps/:gapId/suggest',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
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
    },
  );

  // ── Leads (Phase 4) ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/leads', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return { leads: await listLeads(t.id) };
  });

  // ── Tenant-Einstellungen aktualisieren (Theme, Begrüßung, Lead-Ziele …) ──
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

  // ── Konversationen + Transkript ──
  app.get<{ Params: { siteKey: string } }>('/:siteKey/conversations', async (req, reply) => {
    const t = await tenantOr404(req.params.siteKey, reply);
    if (!t) return;
    return { conversations: await listConversations(t.id) };
  });

  app.get<{ Params: { siteKey: string; id: string } }>(
    '/:siteKey/conversations/:id',
    async (req, reply) => {
      const t = await tenantOr404(req.params.siteKey, reply);
      if (!t) return;
      const transcript = await getTranscript(t.id, req.params.id);
      if (!transcript) {
        reply.code(404);
        return { error: 'not_found', message: 'Konversation nicht gefunden.' };
      }
      return transcript;
    },
  );
}
