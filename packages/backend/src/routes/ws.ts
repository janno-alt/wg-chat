import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { resolveTenantBySiteKey } from '../services/tenant.js';
import { addAgentMessage, getConversation, setHandedOff } from '../services/conversation.js';
import { hub, type WsLike } from '../services/hub.js';
import { getSessionUser } from './auth.js';
import { runForTenant } from '../db/client.js';

interface AgentQuery {
  siteKey?: string;
  key?: string;
}
interface VisitorQuery {
  siteKey?: string;
  conversationId?: string;
  sessionId?: string;
}

/**
 * WebSocket-Endpunkte für die Live-Übernahme.
 *  - /ws/agent   : Dashboard-Agent (Auth via Admin-Key). Empfängt visitor_/bot_/agent_message
 *                  + handoff; sendet takeover / agent_message / release.
 *  - /ws/visitor : Widget des Besuchers. Empfängt handoff-Status + Agenten-Nachrichten.
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AgentQuery }>('/ws/agent', { websocket: true }, async (socket, req) => {
    const { siteKey, key } = req.query;
    if (!siteKey) {
      socket.close();
      return;
    }
    // Auth per Session-Cookie (Dashboard) ODER x-admin-key (kept for MCP/Tools).
    const cfg = getConfig();
    const keyOk = Boolean(cfg.ADMIN_API_KEY) && key === cfg.ADMIN_API_KEY;
    if (!keyOk && !(await getSessionUser(req))) {
      socket.close();
      return;
    }
    const tenant = await resolveTenantBySiteKey(siteKey);
    if (!tenant || !tenant.schemaName) {
      socket.close();
      return;
    }
    const schema = tenant.schemaName;
    const s = socket as unknown as WsLike;
    hub.addAgent(tenant.id, s);

    socket.on('message', async (raw: Buffer) => {
      let msg: { type?: string; conversationId?: string; text?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const convId = msg.conversationId;
      if (!convId) return;
      await runForTenant(schema, async () => {
        // Konversation muss zum Tenant gehören
        const conv = await getConversation(tenant.id, convId);
        if (!conv) return;

        if (msg.type === 'takeover' || msg.type === 'release') {
          const active = msg.type === 'takeover';
          await setHandedOff(tenant.id, convId, active);
          hub.sendToVisitor(convId, { type: 'handoff', active });
          hub.broadcastToAgents(tenant.id, { type: 'handoff', conversationId: convId, active });
        } else if (msg.type === 'agent_message') {
          const text = String(msg.text ?? '').slice(0, 4000).trim();
          if (!text) return;
          await addAgentMessage(convId, text);
          hub.sendToVisitor(convId, { type: 'message', role: 'agent', text });
          hub.broadcastToAgents(tenant.id, { type: 'agent_message', conversationId: convId, text });
        }
      });
    });

    socket.on('close', () => hub.removeAgent(tenant.id, s));
  });

  app.get<{ Querystring: VisitorQuery }>('/ws/visitor', { websocket: true }, async (socket, req) => {
    const { siteKey, conversationId, sessionId } = req.query;
    if (!siteKey || !conversationId || !sessionId) {
      socket.close();
      return;
    }
    const tenant = await resolveTenantBySiteKey(siteKey);
    if (!tenant || !tenant.schemaName) {
      socket.close();
      return;
    }
    const conv = await runForTenant(tenant.schemaName, () => getConversation(tenant.id, conversationId));
    // Nur der Eigentümer der Session darf mithören
    if (!conv || conv.sessionId !== sessionId) {
      socket.close();
      return;
    }
    const s = socket as unknown as WsLike;
    hub.addVisitor(conversationId, s);
    s.send(JSON.stringify({ type: 'handoff', active: conv.handedOff }));

    socket.on('close', () => hub.removeVisitor(conversationId, s));
  });
}
