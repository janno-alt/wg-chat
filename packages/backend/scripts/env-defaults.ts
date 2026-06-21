// Wird als ERSTER Import geladen (ESM wertet Importe in Reihenfolge aus) und
// setzt einen Dummy für DB-freie Skripte, bevor config/db evaluiert werden.
// Es wird nie eine echte Verbindung geöffnet.
process.env.DATABASE_URL ??= 'postgres://localhost:5432/smoke';
