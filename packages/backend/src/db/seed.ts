import '../env.js';
import { eq } from 'drizzle-orm';
import { db, getPool, runForTenant } from './client.js';
import { tenants, outreachTriggers } from './schema.js';
import { schemaNameFor } from './provision.js';
import { createTenant, updateTenantSettings } from '../services/tenant.js';
import { ingestDocument } from '../services/ingestion.js';
import { getConfig } from '../config.js';

const SITE_KEY = 'demo';

const FAQ: { q: string; a: string }[] = [
  { q: 'Was kostet eine Website?', a: 'Unsere Websites starten bei 1.900 €. Der finale Preis hängt vom Umfang ab – gern erstellen wir ein individuelles Angebot.' },
  { q: 'Wie lange dauert die Umsetzung?', a: 'Eine typische Website ist in 3–6 Wochen fertig, abhängig von Umfang und Zulieferung der Inhalte.' },
  { q: 'Bietet ihr Wartung an?', a: 'Ja, wir bieten Wartungspakete inklusive Updates, Backups und Support ab 49 €/Monat.' },
  { q: 'Wie erreiche ich euch?', a: 'Du erreichst uns per E-Mail an hallo@example.de oder telefonisch unter 0123 456789.' },
  { q: 'Macht ihr auch SEO?', a: 'Ja, wir bieten Suchmaschinenoptimierung – von technischem SEO bis zur Content-Strategie.' },
];

const TRIGGERS = [
  { pageMatch: '/preise', condition: 'time_on_page', threshold: 25, message: 'Fragen zu unseren Preisen? Ich helfe gern weiter! 😊' },
  { pageMatch: '/', condition: 'scroll_depth', threshold: 60, message: 'Kann ich Ihnen etwas zeigen?' },
  { pageMatch: '/', condition: 'exit_intent', threshold: 0, message: 'Warten Sie – haben Sie noch eine Frage?' },
];

async function main() {
  console.log('▶ Seede Demo-Tenant …');

  // Sauberer Reseed: alten Demo-Tenant samt eigenem Schema entfernen.
  const [old] = await db
    .select({ id: tenants.id, schemaName: tenants.schemaName })
    .from(tenants)
    .where(eq(tenants.siteKey, SITE_KEY));
  if (old) {
    if (old.schemaName) await getPool().query(`DROP SCHEMA IF EXISTS "${old.schemaName}" CASCADE`);
    await db.delete(tenants).where(eq(tenants.id, old.id));
  }

  // Tenant anlegen (legt automatisch das eigene Schema an + Default-Einstellungen).
  const { id } = await createTenant({
    name: 'Demo GmbH',
    siteKey: SITE_KEY,
    allowedDomains: [],
    monthlyBudgetEur: 25,
  });

  await updateTenantSettings(id, {
    greeting: 'Hallo! 👋 Ich beantworte gern Fragen zu unseren Leistungen.',
    theme: {
      primaryColor: '#0f766e',
      bubbleColor: '#0f766e',
      textColor: '#ffffff',
      backgroundColor: '#f7f8fa',
      position: 'bottom-right',
    },
    starterButtons: [
      { label: 'Was kostet eine Website?' },
      { label: 'Wie lange dauert es?' },
      { label: 'Kontakt' },
    ],
  });

  // Outreach-Trigger (public)
  for (const tr of TRIGGERS) {
    await db.insert(outreachTriggers).values({ tenantId: id, ...tr });
  }

  // FAQ-Wissensbasis im Kunden-Schema anlegen (ingestDocument embeddet bei API-Key).
  const withEmbeddings = Boolean(getConfig().MISTRAL_API_KEY);
  await runForTenant(schemaNameFor(id), async () => {
    for (const f of FAQ) {
      await ingestDocument(id, {
        sourceType: 'faq',
        title: f.q,
        content: `${f.q}\n${f.a}`,
        canonicalAnswer: f.a,
        status: 'published',
      });
    }
  });

  console.log(
    `✓ Demo-Tenant angelegt. site_key="${SITE_KEY}", id=${id}, schema=${schemaNameFor(id)}` +
      (withEmbeddings ? ' (inkl. Embeddings)' : ' (ohne Embeddings – kein MISTRAL_API_KEY)'),
  );
  await getPool().end();
}

main().catch((err) => {
  console.error('✗ Seed fehlgeschlagen:', err);
  process.exit(1);
});
