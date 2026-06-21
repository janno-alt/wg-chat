import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LeadResponse } from '@wg-chat/shared';
import { isOriginAllowed, resolveTenantBySiteKey } from '../services/tenant.js';
import { createLead, dispatchLeadNotifications } from '../services/lead.js';

const bodySchema = z
  .object({
    sessionId: z.string().min(1).max(64),
    conversationId: z.string().uuid().optional(),
    name: z.string().max(200).optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(60).optional(),
    message: z.string().max(2000).optional(),
    pageUrl: z.string().max(2048).optional(),
  })
  .refine((d) => Boolean(d.email || d.phone), {
    message: 'E-Mail oder Telefon erforderlich.',
  });

/** Öffentliche Lead-Erfassung aus dem Widget (Eskalations-/Kontaktformular). */
export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/lead', async (req, reply) => {
    const siteKey = req.headers['x-site-key'];
    if (typeof siteKey !== 'string' || !siteKey) {
      reply.code(400);
      return { error: 'missing_site_key', message: 'Header x-site-key fehlt.' };
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Ungültig.' };
    }

    const tenant = await resolveTenantBySiteKey(siteKey);
    if (!tenant) {
      reply.code(404);
      return { error: 'not_found', message: 'Unbekannter site_key.' };
    }
    if (!isOriginAllowed(tenant, req.headers.origin as string | undefined)) {
      reply.code(403);
      return { error: 'origin_not_allowed', message: 'Diese Domain ist nicht freigegeben.' };
    }

    const lead = await createLead(tenant, parsed.data);

    // Benachrichtigungen nicht-blockierend – schnelle Antwort fürs Widget.
    void dispatchLeadNotifications(tenant, lead, (m) =>
      req.log.info({ tenant: tenant.siteKey }, `[lead] ${m}`),
    ).catch((err) => req.log.error({ err }, 'lead dispatch failed'));

    const res: LeadResponse = { ok: true, leadId: lead.id };
    return res;
  });
}
