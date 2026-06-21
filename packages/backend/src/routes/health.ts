import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/db', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', db: 'up' };
    } catch (err) {
      reply.code(503);
      return { status: 'error', db: 'down', message: (err as Error).message };
    }
  });
}
