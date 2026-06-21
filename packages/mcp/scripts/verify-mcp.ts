import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Startet den MCP-Server als Subprozess, führt den Protokoll-Handshake aus und
 * listet die Tools. Braucht KEIN laufendes Backend (tools/list ruft die API nicht).
 */
async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
    env: { ...process.env, KINE_CHAT_ADMIN_KEY: 'verify-dummy' },
  });
  const client = new Client({ name: 'verify', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`✓ MCP-Server verbunden – ${tools.length} Tools registriert:`);
  for (const t of tools) console.log(`  - ${t.name}`);

  await client.close();
  if (tools.length < 15) {
    console.error(`✗ Erwartet >= 15 Tools, gefunden ${tools.length}`);
    process.exit(1);
  }
  console.log('\nAlle Checks bestanden.');
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ Verify fehlgeschlagen:', e);
  process.exit(1);
});
