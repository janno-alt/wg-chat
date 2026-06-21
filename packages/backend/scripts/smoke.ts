/**
 * DB-freier Smoke-Test der reinen Logik (kostenrelevant). Lauf: `npm run smoke`.
 * Prüft die Bausteine, die OHNE Datenbank/LLM korrekt sein müssen:
 *  - Tokenizer der 0-LLM-FAQ-Stufe (Stopwörter raus, Inhaltswörter rein)
 *  - Kosten-Schätzung (Grundlage der Pro-Kunde-Kostenübersicht)
 */
import './env-defaults.js';
import { tokenize } from '../src/services/faq.js';
import { estimateCostEur } from '../src/llm/provider.js';
import { chunkText } from '../src/services/chunking.js';
import { extractLinks, extractText } from '../src/services/html.js';
import { buildLeadPayload } from '../src/services/notify.js';

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
}
function approx(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// ── Tokenizer ──
const toks = tokenize('Was kostet eine Website?');
check('tokenize behält Inhaltswörter (kostet, website)', toks.includes('kostet') && toks.includes('website'));
check('tokenize entfernt Stopwörter (was, eine)', !toks.includes('was') && !toks.includes('eine'));
check('tokenize entfernt Satzzeichen', !toks.some((t) => /[?.!]/.test(t)));

// ── Kosten-Schätzung ──
const gen = estimateCostEur('mistral-small-latest', { inputTokens: 1000, outputTokens: 500 });
check('Generierungskosten korrekt (0.0005 €)', approx(gen, 0.0002 + 0.0003));

const emb = estimateCostEur('mistral-embed', { inputTokens: 1000, outputTokens: 0 });
check('Embedding-Kosten korrekt (0.0001 €)', approx(emb, 0.0001));

const unknown = estimateCostEur('gibt-es-nicht', { inputTokens: 9999, outputTokens: 9999 });
check('Unbekanntes Modell => 0 € (kein Crash)', unknown === 0);

// ── Chunking ──
const sentence = 'Dies ist ein Testsatz über Leistungen und Preise. ';
const long = sentence.repeat(60); // ~3000 Zeichen
const chunks = chunkText(long, { maxChars: 500, overlap: 80 });
check('chunkText erzeugt mehrere Chunks', chunks.length > 1);
check('alle Chunks halten den Cap ein (<= maxChars)', chunks.every((c) => c.length <= 500));
check('chunkText liefert nichts bei leerem Text', chunkText('   ').length === 0);

// ── HTML-Extraktion ──
const page = extractText(
  '<html><head><title>Demo GmbH</title></head><body>' +
    '<script>var secret=1;</script><style>.x{color:red}</style>' +
    '<h1>Willkommen</h1><p>Wir bauen Websites &amp; SEO.</p></body></html>',
);
check('extractText liest den Title', page.title === 'Demo GmbH');
check('extractText behält sichtbaren Text', page.text.includes('Wir bauen Websites & SEO.'));
check('extractText entfernt Script/Style', !page.text.includes('secret') && !page.text.includes('color:red'));

const links = extractLinks('<a href="/about">a</a><a href="https://x.com/y">b</a>', 'https://site.de/');
check('extractLinks löst relative URLs auf', links.includes('https://site.de/about'));
check('extractLinks behält absolute URLs', links.includes('https://x.com/y'));

// ── Lead-Payload (Phase 4) ──
const payload = buildLeadPayload(
  { id: 't1', name: 'Demo GmbH', siteKey: 'demo' } as any,
  {
    id: 'l1',
    name: 'Max',
    email: 'max@example.com',
    phone: null,
    conversationId: 'c1',
    payload: { message: 'Hallo', pageUrl: 'https://x/y' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as any,
);
check('Lead-Payload Typ chat_lead', payload.type === 'chat_lead');
check(
  'Lead-Payload mappt Felder',
  payload.lead.email === 'max@example.com' &&
    payload.lead.message === 'Hallo' &&
    payload.tenant.siteKey === 'demo',
);
check('Lead-Payload createdAt als ISO', payload.lead.createdAt === '2026-01-01T00:00:00.000Z');

console.log(failed === 0 ? '\nAlle Checks bestanden.' : `\n${failed} Check(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
