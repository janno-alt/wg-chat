import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getConfig } from '../config.js';
import * as schema from './schema.js';

/**
 * Zwei DB-Ebenen:
 *  - `db` (public): Control-Plane + Agentur-Config (tenants, users, settings, outreach).
 *  - `tdb()`: tenant-isoliertes Schema (Phase 8b) – pro Kunde ein eigener Pool, dessen
 *    Connections `search_path=t_<id>,public` gesetzt haben. So landen alle Daten-Queries
 *    automatisch im richtigen Schema; ohne aktiven Kontext wirft `tdb()` (fail-closed).
 */
const { Pool } = pg;

let poolSingleton: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolSingleton) {
    const cfg = getConfig();
    poolSingleton = new Pool({ connectionString: cfg.DATABASE_URL });
    poolSingleton.on('connect', (client) => {
      client.query(`SET hnsw.ef_search = ${Number(cfg.HNSW_EF_SEARCH)}`).catch(() => {});
    });
  }
  return poolSingleton;
}

export const db = drizzle(getPool(), { schema });
export { schema };
export type Db = NodePgDatabase<typeof schema>;
export type Database = typeof db;

// ── Tenant-Schema-Routing ──
const tenantStore = new AsyncLocalStorage<Db>();
const tenantDbCache = new Map<string, Db>();

/** Liefert (gecacht) den Drizzle-Client für ein Tenant-Schema. */
export function dbForTenant(schemaName: string): Db {
  if (!/^[a-z0-9_]+$/i.test(schemaName)) throw new Error(`Ungültiger Schema-Name: ${schemaName}`);
  let d = tenantDbCache.get(schemaName);
  if (!d) {
    const cfg = getConfig();
    const pool = new Pool({
      connectionString: cfg.DATABASE_URL,
      options: `-c search_path=${schemaName},public`,
      max: 3,
      idleTimeoutMillis: 30_000,
    });
    pool.on('connect', (client) => {
      client.query(`SET hnsw.ef_search = ${Number(cfg.HNSW_EF_SEARCH)}`).catch(() => {});
    });
    d = drizzle(pool, { schema });
    tenantDbCache.set(schemaName, d);
  }
  return d;
}

/** Führt fn im Daten-Kontext eines Kunden-Schemas aus (für Daten-Services). */
export function runForTenant<T>(schemaName: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run(dbForTenant(schemaName), fn);
}

/** Der aktive Tenant-DB-Client. Wirft, wenn kein runForTenant-Kontext aktiv ist. */
export function tdb(): Db {
  const d = tenantStore.getStore();
  if (!d) throw new Error('Kein Tenant-DB-Kontext aktiv (runForTenant fehlt).');
  return d;
}
