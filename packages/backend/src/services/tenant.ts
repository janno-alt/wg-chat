import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { WidgetConfig, QuickReply, OutreachTrigger } from '@kine-chat/shared';
import { db } from '../db/client.js';
import { tenants, tenantSettings, outreachTriggers } from '../db/schema.js';
import { getConfig } from '../config.js';

export interface ResolvedTenant {
  id: string;
  name: string;
  siteKey: string;
  allowedDomains: string[];
  active: boolean;
  monthlyBudgetEur: number | null;
  llmProviderCfg: Record<string, unknown>;
  settings: {
    locale: string;
    greeting: string;
    theme: Record<string, unknown>;
    starterButtons: QuickReply[];
    fallbackText: string;
    thresholds: Record<string, number>;
    notifyEmail: string | null;
    leadWebhookUrl: string | null;
  };
}

/** Tenant + Einstellungen anhand des öffentlichen site_key auflösen. */
export async function resolveTenantBySiteKey(siteKey: string): Promise<ResolvedTenant | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.siteKey, siteKey));
  if (!t || !t.active) return null;

  const [s] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, t.id));

  return {
    id: t.id,
    name: t.name,
    siteKey: t.siteKey,
    allowedDomains: t.allowedDomains ?? [],
    active: t.active,
    monthlyBudgetEur: t.monthlyBudgetEur === null ? null : Number(t.monthlyBudgetEur),
    llmProviderCfg: t.llmProviderCfg ?? {},
    settings: {
      locale: s?.locale ?? 'de',
      greeting: s?.greeting ?? 'Hallo! Wie kann ich helfen?',
      theme: s?.theme ?? {},
      starterButtons: (s?.starterButtons as QuickReply[]) ?? [],
      fallbackText:
        s?.fallbackText ??
        'Das gebe ich an unser Team weiter. Magst du mir kurz deine Kontaktdaten dalassen?',
      thresholds: s?.thresholds ?? {},
      notifyEmail: s?.notifyEmail ?? null,
      leadWebhookUrl: s?.leadWebhookUrl ?? null,
    },
  };
}

/** Alle Tenants (Agentur-Übersicht fürs Dashboard). */
export async function listTenants() {
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      siteKey: tenants.siteKey,
      plan: tenants.plan,
      monthlyBudgetEur: tenants.monthlyBudgetEur,
      allowedDomains: tenants.allowedDomains,
      active: tenants.active,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));
}

export interface NewTenant {
  name: string;
  siteKey?: string;
  allowedDomains?: string[];
  monthlyBudgetEur?: number | null;
  plan?: string;
}

/** Neuen Tenant + Default-Einstellungen anlegen. Liefert id + (ggf. generierten) siteKey. */
export async function createTenant(input: NewTenant): Promise<{ id: string; siteKey: string }> {
  const siteKey = (input.siteKey?.trim() || randomUUID().replace(/-/g, '').slice(0, 16)).toLowerCase();
  const [t] = await db
    .insert(tenants)
    .values({
      name: input.name,
      siteKey,
      allowedDomains: input.allowedDomains ?? [],
      monthlyBudgetEur:
        input.monthlyBudgetEur === null || input.monthlyBudgetEur === undefined
          ? null
          : String(input.monthlyBudgetEur),
      plan: input.plan ?? 'standard',
    })
    .returning();
  await db.insert(tenantSettings).values({ tenantId: t!.id }).onConflictDoNothing();
  return { id: t!.id, siteKey };
}

export interface TenantPatch {
  name?: string;
  allowedDomains?: string[];
  monthlyBudgetEur?: number | null;
  active?: boolean;
  plan?: string;
}

/** Tenant-Stammdaten aktualisieren (Domains, Budget, aktiv …). */
export async function updateTenant(siteKey: string, patch: TenantPatch): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.allowedDomains !== undefined) set.allowedDomains = patch.allowedDomains;
  if (patch.monthlyBudgetEur !== undefined)
    set.monthlyBudgetEur = patch.monthlyBudgetEur === null ? null : String(patch.monthlyBudgetEur);
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.plan !== undefined) set.plan = patch.plan;
  if (Object.keys(set).length === 0) return true;
  const res = await db
    .update(tenants)
    .set(set)
    .where(eq(tenants.siteKey, siteKey))
    .returning({ id: tenants.id });
  return res.length > 0;
}

export interface TenantSettingsPatch {
  locale?: string;
  greeting?: string;
  fallbackText?: string;
  theme?: Record<string, unknown>;
  starterButtons?: unknown[];
  thresholds?: Record<string, number>;
  notifyEmail?: string | null;
  leadWebhookUrl?: string | null;
}

/** Tenant-Einstellungen anlegen/aktualisieren (upsert auf tenant_id). */
export async function updateTenantSettings(
  tenantId: string,
  patch: TenantSettingsPatch,
): Promise<void> {
  await db
    .insert(tenantSettings)
    .values({ tenantId, ...patch })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: { ...patch, updatedAt: new Date() },
    });
}

/** Aufgelöste Schwellen: Tenant-Override vor globalem ENV-Default. */
export function resolveThresholds(t: ResolvedTenant) {
  const env = getConfig();
  const o = t.settings.thresholds ?? {};
  return {
    direct: o.direct ?? env.SIMILARITY_DIRECT_THRESHOLD,
    rag: o.rag ?? env.SIMILARITY_RAG_THRESHOLD,
    cache: o.cache ?? env.SIMILARITY_CACHE_THRESHOLD,
  };
}

/** Origin gegen die Whitelist prüfen (im Dev über ALLOW_ALL_ORIGINS abschaltbar). */
export function isOriginAllowed(t: ResolvedTenant, origin: string | undefined): boolean {
  if (getConfig().ALLOW_ALL_ORIGINS) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return t.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
}

const DEFAULT_THEME = {
  primaryColor: '#2563eb',
  bubbleColor: '#2563eb',
  textColor: '#ffffff',
  position: 'bottom-right' as const,
};

/** Öffentliche Widget-Konfiguration für /config zusammenbauen. */
export async function buildWidgetConfig(t: ResolvedTenant): Promise<WidgetConfig> {
  const triggers = await db
    .select()
    .from(outreachTriggers)
    .where(eq(outreachTriggers.tenantId, t.id));

  const outreach: OutreachTrigger[] = triggers
    .filter((tr) => tr.active)
    .map((tr) => ({
      id: tr.id,
      pageMatch: tr.pageMatch,
      condition: tr.condition as OutreachTrigger['condition'],
      threshold: tr.threshold,
      selector: tr.selector ?? undefined,
      message: tr.message,
    }));

  return {
    tenantId: t.id,
    name: t.name,
    locale: t.settings.locale,
    greeting: t.settings.greeting,
    theme: { ...DEFAULT_THEME, ...(t.settings.theme as object) } as WidgetConfig['theme'],
    starterButtons: t.settings.starterButtons,
    outreach,
  };
}
