import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getConfig } from '../config.js';
import * as schema from './schema.js';

/**
 * Ein gemeinsamer Connection-Pool + getypter Drizzle-Client.
 * pgvector liefert/erwartet Embeddings als String "[1,2,3]"; drizzle's vector()
 * übernimmt das Parsen/Serialisieren.
 */
const { Pool } = pg;

let poolSingleton: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolSingleton) {
    const cfg = getConfig();
    poolSingleton = new Pool({ connectionString: cfg.DATABASE_URL });
    // HNSW-Recall pro Verbindung setzen (Session-GUC). Wirkt auf alle
    // Vektor-Abfragen dieser Connection. Guarded: schlägt nur fehl, solange die
    // pgvector-Extension noch nicht angelegt ist (vor der ersten Migration).
    poolSingleton.on('connect', (client) => {
      client.query(`SET hnsw.ef_search = ${Number(cfg.HNSW_EF_SEARCH)}`).catch(() => {
        /* Extension evtl. noch nicht vorhanden – ignorieren */
      });
    });
  }
  return poolSingleton;
}

export const db = drizzle(getPool(), { schema });
export { schema };
export type Database = typeof db;
