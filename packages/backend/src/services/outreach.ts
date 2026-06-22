import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { outreachOpeners } from '../db/schema.js';
import { getProviderForTenant, hasEmbeddings, type TenantLlmCfg } from '../llm/index.js';
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
  const provider = getProviderForTenant(llmCfg);
  try {
    const gen = await provider.generate(
      [
        {
          role: 'system',
          content:
            'Du formulierst kurze, einladende Gesprächseinstiege für einen Website-Chat. Gib GENAU ' +
            '2 Fragen aus, je eine pro Zeile, ohne Nummerierung. Jede Frage: max. 10 Wörter, auf ' +
            'Deutsch, neugierig machend und konkret zum Seitenthema, ohne Gedankenstriche, ohne Emoji. ' +
            'Stil-Beispiel: "Welches Website-System nutzt du aktuell?"',
        },
        { role: 'user', content: `Seitentitel: ${pageTitle ?? '—'}\nSeiteninhalt (Auszug):\n${pageText.slice(0, 1500)}` },
      ],
      { temperature: 0.5, maxTokens: 120 },
    );
    await recordUsage({
      tenantId,
      provider: provider.name,
      model: provider.chatModel,
      purpose: 'generate',
      usage: gen.usage,
    });
    const lines = gen.text
      .split('\n')
      .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').replace(/[—–]/g, ',').trim())
      .filter((l) => l.length >= 6 && l.length <= 120)
      .slice(0, 2);
    if (!lines.length) return 0;
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
  return { id: chosen.id, text: chosen.text };
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
