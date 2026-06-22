import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { getConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { configRoutes } from './routes/config.js';
import { chatRoutes } from './routes/chat.js';
import { widgetRoutes } from './routes/widget.js';
import { leadRoutes } from './routes/lead.js';
import { outreachRoutes } from './routes/outreach.js';
import { adminRoutes } from './routes/admin.js';
import { wsRoutes } from './routes/ws.js';
import { authRoutes } from './routes/auth.js';

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = getConfig();
  const app = Fastify({
    logger: {
      level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        cfg.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  // Das Widget läuft cross-origin auf den Kundenseiten. Die eigentliche
  // Zugriffskontrolle ist site_key + allowedDomains (siehe chat-Route), nicht CORS.
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(sensible);
  await app.register(websocket);
  await app.register(cookie, { secret: cfg.SESSION_SECRET });

  await app.register(healthRoutes);
  await app.register(wsRoutes);
  await app.register(widgetRoutes);
  await app.register(configRoutes);
  await app.register(chatRoutes);
  await app.register(leadRoutes);
  await app.register(outreachRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes, { prefix: '/api/admin' });

  // ── Dashboard-SPA ausliefern (unter / ) ──
  const here = dirname(fileURLToPath(import.meta.url)); // …/backend/src
  const dashboardDist = cfg.DASHBOARD_DIST_DIR || resolve(here, '../../dashboard/dist');
  const indexHtml = join(dashboardDist, 'index.html');

  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: dashboardDist, index: ['index.html'] });
    // SPA-Fallback: alles, was keine API/WS/Asset-Route ist, bekommt index.html
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/ws') &&
        req.url !== '/w.js'
      ) {
        return reply.type('text/html').sendFile('index.html');
      }
      reply.code(404).send({ error: 'not_found', message: `Route ${req.method}:${req.url} not found` });
    });
    app.log.info(`Dashboard wird ausgeliefert aus ${dashboardDist}`);
  } else {
    app.log.warn(`Dashboard-Build nicht gefunden (${dashboardDist}) – / liefert kein Dashboard.`);
  }

  return app;
}
