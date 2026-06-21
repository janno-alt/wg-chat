import { WebSocket } from 'ws';

/**
 * Prüft, dass die WebSocket-Endpunkte existieren und ungültige Verbindungen
 * ablehnen (Auth/Validierung greifen VOR jedem DB-Zugriff). Braucht ein laufendes
 * Backend, aber keine DB. Start:  npm run verify:ws --workspace @wg-chat/backend
 */
const base = process.env.WG_WS ?? 'ws://localhost:8787';

function expectClose(path: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    const to = setTimeout(() => {
      ws.terminate();
      reject(new Error('blieb offen'));
    }, 4000);
    const done = () => {
      clearTimeout(to);
      resolve();
    };
    ws.on('close', done);
    ws.on('error', done); // abgelehnter Upgrade zählt ebenfalls als „geschlossen"
    void label;
  });
}

const checks: Array<[string, string]> = [
  ['/ws/agent?siteKey=demo&key=falsch', 'Agent mit falschem Admin-Key'],
  ['/ws/visitor?siteKey=demo', 'Visitor ohne conversationId/sessionId'],
];

let failed = 0;
for (const [path, label] of checks) {
  try {
    await expectClose(path, label);
    console.log(`✓ ${label} → Verbindung abgelehnt`);
  } catch (e) {
    console.log(`✗ ${label}: ${(e as Error).message}`);
    failed++;
  }
}
console.log(failed === 0 ? '\nWS-Checks bestanden.' : `\n${failed} WS-Check(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
