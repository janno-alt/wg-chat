import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  let etag: string | null = null;

  app.get('/w.js', async (req, reply) => {
    try {
      // In Produktion einmalig in den Speicher lesen; im Dev bei jedem Request frisch.
      if (cache === null || getConfig().NODE_ENV !== 'production') {
        cache = await readFile(file, 'utf8');
        etag = `"${createHash('sha1').update(cache).digest('hex').slice(0, 16)}"`;
      }
      reply.header('content-type', 'application/javascript; charset=utf-8');
      // no-cache = Browser darf cachen, MUSS aber vor Nutzung per ETag revalidieren.
      // So zieht jede neue Version nach dem Deploy sofort (sonst hängt altes w.js fest).
      reply.header('cache-control', 'no-cache');
      if (etag) reply.header('etag', etag);
      if (etag && req.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return cache;
    } catch {
      reply.code(404).header('content-type', 'application/javascript; charset=utf-8');
      return '/* wg-chat: Widget nicht gebaut. Bitte `npm run widget:build` ausführen. */';
    }
  });
}
