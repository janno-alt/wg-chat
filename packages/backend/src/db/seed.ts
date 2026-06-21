import '../env.js';
import { eq } from 'drizzle-orm';
import { db, getPool } from './client.js';
import { tenants, tenantSettings, kbDocuments, kbChunks, outreachTriggers } from './schema.js';
import { getProviderForTenant } from '../llm/index.js';
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

  // Sauberer Reseed: vorhandenen Demo-Tenant samt Kind-Daten entfernen (CASCADE).
  await db.delete(tenants).where(eq(tenants.siteKey, SITE_KEY));

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Demo GmbH',
      siteKey: SITE_KEY,
      allowedDomains: [],
      monthlyBudgetEur: '25.00',
    })
    .returning();
  const tenantId = tenant!.id;

  await db.insert(tenantSettings).values({
    tenantId,
    locale: 'de',
    greeting: 'Hallo! 👋 Ich beantworte gern Fragen zu unseren Leistungen.',
    theme: {
      primaryColor: '#0f766e',
      bubbleColor: '#0f766e',
      textColor: '#ffffff',
      position: 'bottom-right',
    },
    starterButtons: [
      { label: 'Was kostet eine Website?' },
      { label: 'Wie lange dauert es?' },
      { label: 'Kontakt' },
    ],
  });

  const docIds: string[] = [];
  for (const f of FAQ) {
    const [doc] = await db
      .insert(kbDocuments)
      .values({
        tenantId,
        sourceType: 'faq',
        title: f.q,
        rawContent: f.q,
        canonicalAnswer: f.a,
        status: 'published',
      })
      .returning();
    docIds.push(doc!.id);
  }

  for (const tr of TRIGGERS) {
    await db.insert(outreachTriggers).values({ tenantId, ...tr });
  }

  // Embeddings nur, wenn ein API-Key vorhanden ist – sonst läuft der Seed offline
  // (FAQ-Keyword-Stufe + Eskalation funktionieren ohnehin ohne Embeddings).
  if (getConfig().MISTRAL_API_KEY) {
    console.log('▶ Erzeuge Embeddings für die FAQ-Wissensbasis …');
    const provider = getProviderForTenant(tenant!.llmProviderCfg);
    const texts = FAQ.map((f) => `${f.q}\n${f.a}`);
    const { embeddings } = await provider.embed(texts);
    for (let i = 0; i < FAQ.length; i++) {
      await db.insert(kbChunks).values({
        tenantId,
        documentId: docIds[i]!,
        content: texts[i]!,
        embedding: embeddings[i]!,
        metadata: { source: 'seed-faq' },
      });
    }
    console.log(`✓ ${embeddings.length} Embeddings gespeichert.`);
  } else {
    console.log('ℹ Kein MISTRAL_API_KEY – Embeddings übersprungen (FAQ-Stufe bleibt aktiv).');
  }

  console.log(`✓ Demo-Tenant angelegt. site_key="${SITE_KEY}", id=${tenantId}`);
  await getPool().end();
}

main().catch((err) => {
  console.error('✗ Seed fehlgeschlagen:', err);
  process.exit(1);
});
