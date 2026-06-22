import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isOriginAllowed, resolveTenantBySiteKey } from '../services/tenant.js';
import { runForTenant } from '../db/client.js';
import { pickOpenerForPath, recordEngagement, toPath } from '../services/outreach.js';
import type { ResolvedTenant } from '../services/tenant.js';

/**
 * Öffentliche Outreach-Endpunkte fürs Widget: liefert einen seitenpassenden
 * Gesprächseinstieg (A/B, zählt Impression) und nimmt das Engagement (Klick) entgegen.
 */
export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  async function resolve(req: FastifyRequest, reply: FastifyReply): Promise<ResolvedTenant | null> {
    const siteKey = req.headers['x-site-key'];
    if (typeof siteKey !== 'string' || !siteKey) {
      reply.code(400);
      return null;
    }
    const tenant = await resolveTenantBySiteKey(siteKey);
    if (!tenant) {
      reply.code(404);
      return null;
    }
    if (!isOriginAllowed(tenant, req.headers.origin as string | undefined)) {
      reply.code(403);
      return null;
    }
    if (!tenant.schemaName) {
      reply.code(503);
      return null;
    }
    return tenant;
  }

  app.get<{ Querystring: { path?: string } }>('/api/outreach', async (req, reply) => {
    const tenant = await resolve(req, reply);
    if (!tenant) return { opener: null };
    const path = toPath(req.query?.path ?? '/');
    try {
      const opener = await runForTenant(tenant.schemaName!, () => pickOpenerForPath(tenant.id, path));
      return { opener };
    } catch (err) {
      req.log.error({ err }, 'outreach pick failed');
      return { opener: null };
    }
  });

  app.post('/api/outreach/engage', async (req, reply) => {
    const tenant = await resolve(req, reply);
    if (!tenant) return { ok: false };
    const parsed = z.object({ openerId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false };
    }
    try {
      await runForTenant(tenant.schemaName!, () => recordEngagement(tenant.id, parsed.data.openerId));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}
