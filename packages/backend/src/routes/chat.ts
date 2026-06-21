import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChatResponse } from '@wg-chat/shared';
import { isOriginAllowed, resolveTenantBySiteKey } from '../services/tenant.js';
import { runCascade } from '../services/cascade.js';
import { hub } from '../services/hub.js';

const bodySchema = z.object({
  sessionId: z.string().min(1).max(64),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  pageUrl: z.string().max(2048).optional(),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (req, reply) => {
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
      return { error: 'not_found', message: 'Unbekannter oder inaktiver site_key.' };
    }

    const origin = req.headers.origin as string | undefined;
    if (!isOriginAllowed(tenant, origin)) {
      reply.code(403);
      return { error: 'origin_not_allowed', message: 'Diese Domain ist nicht freigegeben.' };
    }

    try {
      const result: ChatResponse = await runCascade(tenant, parsed.data, (m) =>
        req.log.info({ tenant: tenant.siteKey }, `[cascade] ${m}`),
      );

      // Live-Sichtbarkeit für Agenten: eingehende Besuchernachricht + (ggf.) Bot-Antwort
      hub.broadcastToAgents(tenant.id, {
        type: 'visitor_message',
        conversationId: result.conversationId,
        text: parsed.data.message,
      });
      if (result.reply && result.source !== 'human') {
        hub.broadcastToAgents(tenant.id, {
          type: 'bot_message',
          conversationId: result.conversationId,
          text: result.reply,
          source: result.source,
        });
      }

      return result;
    } catch (err) {
      req.log.error({ err }, 'cascade failed');
      reply.code(500);
      return { error: 'internal', message: 'Unerwarteter Fehler im Chat.' };
    }
  });
}
