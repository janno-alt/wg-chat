import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';

/**
 * Liefert das gebaute Widget unter GET /w.js aus – aus demselben Origin wie die
 * API. Dadurch lautet das Einbettungs-Snippet schlicht:
 *   <script async src="https://chat.kine.media/w.js" data-tenant="KEY"></script>
 * und es gibt keinerlei CORS-Thematik zwischen Widget und /api.
 */
export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url)); // …/backend/src/routes
  const distDir = process.env.WIDGET_DIST_DIR || resolve(here, '../../../widget/dist');
  const file = resolve(distDir, 'w.js');
  let cache: string | null = null;

  app.get('/w.js', async (_req, reply) => {
    try {
      // In Produktion einmalig cachen; im Dev bei jedem Request frisch lesen.
      if (cache === null || getConfig().NODE_ENV !== 'production') {
        cache = await readFile(file, 'utf8');
      }
      reply.header('content-type', 'application/javascript; charset=utf-8');
      reply.header('cache-control', 'public, max-age=300');
      return cache;
    } catch {
      reply.code(404).header('content-type', 'application/javascript; charset=utf-8');
      return '/* kine-chat: Widget nicht gebaut. Bitte `npm run widget:build` ausführen. */';
    }
  });
}
