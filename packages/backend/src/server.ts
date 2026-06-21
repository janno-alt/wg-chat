import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { getConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { configRoutes } from './routes/config.js';
import { chatRoutes } from './routes/chat.js';
import { widgetRoutes } from './routes/widget.js';
import { leadRoutes } from './routes/lead.js';
import { adminRoutes } from './routes/admin.js';
import { wsRoutes } from './routes/ws.js';

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(sensible);
  await app.register(websocket);

  await app.register(healthRoutes);
  await app.register(wsRoutes);
  await app.register(widgetRoutes);
  await app.register(configRoutes);
  await app.register(chatRoutes);
  await app.register(leadRoutes);
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}
