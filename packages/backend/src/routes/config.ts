import type { FastifyInstance } from 'fastify';
import { buildWidgetConfig, resolveTenantBySiteKey } from '../services/tenant.js';

/** Öffentliche Widget-Konfiguration (Theme, Begrüßung, Outreach-Trigger). */
export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { siteKey: string } }>('/api/config/:siteKey', async (req, reply) => {
    const tenant = await resolveTenantBySiteKey(req.params.siteKey);
    if (!tenant) {
      reply.code(404);
      return { error: 'not_found', message: 'Unbekannter oder inaktiver site_key.' };
    }
    // kurz cachebar: Config ändert sich selten
    reply.header('cache-control', 'public, max-age=60');
    return buildWidgetConfig(tenant);
  });
}
