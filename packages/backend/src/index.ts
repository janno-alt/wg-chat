import './env.js';
import { buildServer } from './server.js';
import { getConfig } from './config.js';
import { ensureAdminFromEnv } from './services/auth.js';

async function main() {
  const cfg = getConfig();
  const app = await buildServer();
  try {
    await ensureAdminFromEnv(); // Bootstrap-Admin (ADMIN_EMAIL/ADMIN_PASSWORD), falls gesetzt
  } catch (e) {
    app.log.warn(`ensureAdminFromEnv: ${(e as Error).message}`);
  }
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  app.log.info(`wg-chat backend läuft auf ${cfg.PUBLIC_BASE_URL}`);
}

main().catch((err) => {
  console.error('Serverstart fehlgeschlagen:', err);
  process.exit(1);
});
