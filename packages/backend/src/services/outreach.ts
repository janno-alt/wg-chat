import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { outreachOpeners } from '../db/schema.js';
import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
import { anthropicGenerate } from '../llm/anthropic.js';
import { getConfig } from '../config.js';
import { recordUsage } from './usage.js';

/** Prefix-Match wie im Widget: "/preise" matcht /preise und Unterpfade; "/" ist seitenweit. */
export function pathMatches(pattern: string, path: string): boolean {
  if (!pattern || pattern === '/') return true;
  if (path === pattern) return true;
  return path.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`);
}

/** Normalisiert eine URL/Pfad auf den reinen Pfad (ohne Host/Query/Hash). */
export function toPath(input: string): string {
  try {
    return new URL(input, 'http://x').pathname || '/';
  } catch {
    return input.startsWith('/') ? input.split(/[?#]/)[0]! : '/';
  }
}

/**
 * Tageszeit-abhängige Begrüßung (Agentur-Zeit Europe/Berlin). Nach 17 Uhr ist kein
 * Mensch mehr da → lockerer, ehrlicher Ton. Wird dem Einstieg vorangestellt.
 */
function greetingForNow(): string {
  let hour = NaN;
  try {
    // en-GB liefert reine "09" (de-DE hängt " Uhr" an → Number()=NaN!). parseInt extra-robust.
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(
      new Date(),
    );
    hour = parseInt(s, 10);
  } catch {
    /* ignore */
  }
  if (!Number.isFinite(hour)) return 'Hallo!'; // sicherer Default – NIE der Feierabend-Ton
  if (hour >= 5 && hour < 11) return 'Guten Morgen!';
  if (hour >= 11 && hour < 18) return 'Hallo!';
  // ab 18:00 bis morgens: kein Mensch mehr da → lockerer Feierabend-Ton
  return 'Schon nach Feierabend bei uns, aber frag mich gern:';
}

/**
 * Erzeugt beim Crawlen 2 kurze, einladende Gesprächseinstiege passend zum Seitenthema
 * (KI). Werden als A/B-Varianten gespeichert. Fehler werden geschluckt (Crawl darf
 * deswegen nicht abbrechen).
 */
export async function generateOpenersForPage(
  tenantId: string,
  pagePath: string,
  pageTitle: string | null,
  pageText: string,
  llmCfg: TenantLlmCfg = {},
): Promise<number> {
  if (!hasEmbeddings(llmCfg) || pageText.trim().length < 120) return 0;
  // Seiten mit MANUELL kuratierten Einstiegen nicht automatisch mit KI-Einstiegen ergänzen
  // (menschliche Kuratierung hat Vorrang, kein Zumüllen bei Re-Crawls).
  const curated = await tdb()
    .select({ id: outreachOpeners.id })
    .from(outreachOpeners)
    .where(
      and(
        eq(outreachOpeners.tenantId, tenantId),
        eq(outreachOpeners.pageMatch, pagePath),
        eq(outreachOpeners.source, 'manual'),
      ),
    )
    .limit(1);
  if (curated.length) return 0;
  const cfg = getConfig();
  const system =
    'Du bist ein erfahrener, sympathischer Verkäufer und Texter. Ein Besucher kommt auf diese ' +
    'Seite, hat aber nur ein grobes Problem und weiß noch nicht genau, was er braucht. Formuliere ' +
    'GENAU 2 kurze, exzellent formulierte Einstiegsfragen, mit denen ein guter Verkäufer locker ' +
    'ins Gespräch kommt und Bedarf weckt – je eine pro Zeile, ohne Nummerierung, ohne Anführungszeichen.\n' +
    'Anforderungen:\n' +
    '- EINWANDFREIE deutsche Grammatik, Rechtschreibung und natürlicher Klang. Lieber einfach und ' +
    'flüssig als kompliziert.\n' +
    '- OFFENE Frage zur Situation des Besuchers (was er nutzt, was ihn stört, was er erreichen will). ' +
    'KEINE Ja/Nein-Frage und NICHT "Brauchst du Hilfe bei ...".\n' +
    '- Frage nach dem Besucher, nicht nach einer Aufgabe, die er selbst erledigt oder sich durchklickt.\n' +
    '- Höchstens 12 Wörter, per "du" angesprochen, kein Gedankenstrich, kein Emoji, KEIN "Hallo" am ' +
    'Anfang (das wird automatisch ergänzt).\n' +
    '- Beispiel Seite Website-Wartung: GUT "Welches System steckt aktuell hinter deiner Website?" — ' +
    'SCHLECHT "Brauchst du Hilfe bei der Einrichtung eines Wartungsvertrags?".\n' +
    '- Beispiel Seite Videomarketing: GUT "Welche Geschichte möchtest du mit einem Video erzählen?".';
  const user = `Seitentitel: ${pageTitle ?? '—'}\nSeiteninhalt (Auszug):\n${pageText.slice(0, 1800)}`;
  try {
    // Einstiege aus EUREN Kundenseiten (keine End-Nutzer-Daten): Claude, falls konfiguriert,
    // sonst Mistral-large. Der Chat-Antwortpfad bleibt davon unberührt (immer Mistral/EU).
    const useAnthropic = Boolean(cfg.ANTHROPIC_API_KEY) && cfg.OPENER_PROVIDER !== 'mistral';
    let genText: string;
    let usage: { inputTokens: number; outputTokens: number };
    let usedProvider: string;
    let usedModel: string;
    if (useAnthropic) {
      const r = await anthropicGenerate({
        apiKey: cfg.ANTHROPIC_API_KEY,
        model: cfg.ANTHROPIC_OPENER_MODEL,
        baseUrl: cfg.ANTHROPIC_BASE_URL,
        system,
        user,
        maxTokens: 200,
        temperature: 0.6,
      });
      genText = r.text;
      usage = r.usage;
      usedProvider = 'anthropic';
      usedModel = cfg.ANTHROPIC_OPENER_MODEL;
    } else {
      const provider = getProviderForTenant({ ...llmCfg, chatModel: cfg.MISTRAL_OPENER_MODEL });
      const gen = await provider.generate(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.55, maxTokens: 150 },
      );
      genText = gen.text;
      usage = gen.usage;
      usedProvider = provider.name;
      usedModel = provider.chatModel;
    }
    await recordUsage({ tenantId, provider: usedProvider, model: usedModel, purpose: 'generate', usage });
    const lines = genText
      .split('\n')
      .map((l) =>
        l
          .replace(/^[\s\-*•\d.)]+/, '') // Aufzählungszeichen
          .replace(/[—–]/g, ', ') // Gedankenstriche
          .replace(/^["'„“»]+|["'”«]+$/g, '') // umschließende Anführungszeichen
          .replace(/\s{2,}/g, ' ')
          .trim(),
      )
      .map((l) => (l ? l.charAt(0).toUpperCase() + l.slice(1) : l)) // Großbuchstabe am Anfang
      .map((l) => (l && !/[?!.]$/.test(l) ? `${l}?` : l)) // Einstiege sind Fragen
      .filter((l) => l.length >= 8 && l.length <= 120)
      .slice(0, 2);
    if (!lines.length) return 0;
    // Alte KI-Einstiege dieser Seite ersetzen (manuelle bleiben), damit Re-Crawl nicht dupliziert.
    await tdb()
      .delete(outreachOpeners)
      .where(
        and(
          eq(outreachOpeners.tenantId, tenantId),
          eq(outreachOpeners.pageMatch, pagePath),
          eq(outreachOpeners.source, 'ai'),
        ),
      );
    await tdb()
      .insert(outreachOpeners)
      .values(lines.map((text) => ({ tenantId, pageMatch: pagePath, text, source: 'ai' })));
    return lines.length;
  } catch {
    return 0;
  }
}

/**
 * Wählt für einen Pfad einen aktiven Einstieg (A/B): bevorzugt den spezifischsten
 * page_match, darunter den mit den wenigsten Impressionen (gleichmäßiges Ausspielen).
 * Zählt eine Impression hoch. null = kein passender Einstieg.
 */
export async function pickOpenerForPath(
  tenantId: string,
  path: string,
): Promise<{ id: string; text: string } | null> {
  const rows = await tdb()
    .select()
    .from(outreachOpeners)
    .where(and(eq(outreachOpeners.tenantId, tenantId), eq(outreachOpeners.active, true)));
  const matches = rows.filter((o) => pathMatches(o.pageMatch, path));
  if (!matches.length) return null;
  const maxLen = Math.max(...matches.map((m) => m.pageMatch.length));
  const specific = matches.filter((m) => m.pageMatch.length === maxLen);
  const minImpr = Math.min(...specific.map((m) => m.impressions));
  const pool = specific.filter((m) => m.impressions === minImpr);
  const chosen = pool[Math.floor(Math.random() * pool.length)]!;
  await tdb()
    .update(outreachOpeners)
    .set({ impressions: sql`${outreachOpeners.impressions} + 1` })
    .where(eq(outreachOpeners.id, chosen.id));
  // Tageszeit-Begrüßung voranstellen → wird zugleich die erste Chat-Nachricht.
  return { id: chosen.id, text: `${greetingForNow()} ${chosen.text}` };
}

/** Klick auf den Einstieg → Engagement zählen (A/B-Erfolgsmessung). */
export async function recordEngagement(tenantId: string, openerId: string): Promise<void> {
  await tdb()
    .update(outreachOpeners)
    .set({ engagements: sql`${outreachOpeners.engagements} + 1` })
    .where(and(eq(outreachOpeners.id, openerId), eq(outreachOpeners.tenantId, tenantId)));
}

export async function listOpeners(tenantId: string) {
  return tdb()
    .select()
    .from(outreachOpeners)
    .where(eq(outreachOpeners.tenantId, tenantId))
    .orderBy(asc(outreachOpeners.pageMatch), desc(outreachOpeners.impressions));
}

export async function addManualOpener(tenantId: string, pageMatch: string, text: string) {
  const [row] = await tdb()
    .insert(outreachOpeners)
    .values({ tenantId, pageMatch: pageMatch || '/', text, source: 'manual' })
    .returning();
  return row;
}

export async function updateOpener(
  tenantId: string,
  id: string,
  patch: { active?: boolean; text?: string; pageMatch?: string },
): Promise<boolean> {
  const updated = await tdb()
    .update(outreachOpeners)
    .set(patch)
    .where(and(eq(outreachOpeners.id, id), eq(outreachOpeners.tenantId, tenantId)))
    .returning({ id: outreachOpeners.id });
  return updated.length > 0;
}

export async function deleteOpener(tenantId: string, id: string): Promise<boolean> {
  const del = await tdb()
    .delete(outreachOpeners)
    .where(and(eq(outreachOpeners.id, id), eq(outreachOpeners.tenantId, tenantId)))
    .returning({ id: outreachOpeners.id });
  return del.length > 0;
}
