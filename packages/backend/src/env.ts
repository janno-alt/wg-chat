import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Lädt .env unabhängig vom aktuellen Arbeitsverzeichnis. Wichtig, weil
 * `npm run … --workspace` das cwd auf das Paketverzeichnis setzt, die .env aber
 * im Repo-Root liegt. Im Docker-Stack kommen die Variablen aus compose – dann
 * existiert keine .env und dotenv tut (gewollt) nichts.
 *
 * Muss als ERSTES geladen werden, bevor config.ts/db gelesen werden.
 */
const here = dirname(fileURLToPath(import.meta.url)); // …/packages/backend/src
// Repo-Root: src -> backend -> packages -> root
config({ path: resolve(here, '../../../.env') });
// zusätzlich evtl. paket-/cwd-lokale .env (überschreibt nichts bereits Gesetztes)
config();
