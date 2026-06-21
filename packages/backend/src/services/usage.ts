import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { llmUsage, tenants } from '../db/schema.js';
import { estimateCostEur, type UsageStat } from '../llm/provider.js';

/** Schreibt eine Kosten-Zeile (Token + EUR-Schätzung) – Basis der Pro-Kunde-Kostenübersicht. */
export async function recordUsage(params: {
  tenantId: string;
  conversationId?: string | null;
  provider: string;
  model: string;
  purpose: 'embed' | 'generate';
  usage: UsageStat;
}): Promise<number> {
  const costEur = estimateCostEur(params.model, params.usage);
  await db.insert(llmUsage).values({
    tenantId: params.tenantId,
    conversationId: params.conversationId ?? null,
    provider: params.provider,
    model: params.model,
    purpose: params.purpose,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    costEur: costEur.toFixed(6),
  });
  return costEur;
}

/** Summe der LLM-Kosten des laufenden Kalendermonats (EUR) für einen Tenant. */
export async function getMonthSpendEur(tenantId: string): Promise<number> {
  const startOfMonth = sql`date_trunc('month', now())`;
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costEur}), 0)` })
    .from(llmUsage)
    .where(and(eq(llmUsage.tenantId, tenantId), gte(llmUsage.createdAt, startOfMonth)));
  return Number(row?.total ?? 0);
}

export interface UsageSummary {
  monthEur: number;
  byModel: Array<{
    model: string;
    purpose: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    eur: number;
  }>;
}

/** Kostenübersicht des laufenden Monats pro Modell/Zweck – fürs Pro-Kunde-Reporting. */
export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const startOfMonth = sql`date_trunc('month', now())`;
  const rows = await db
    .select({
      model: llmUsage.model,
      purpose: llmUsage.purpose,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}),0)::int`,
      eur: sql<string>`coalesce(sum(${llmUsage.costEur}),0)`,
    })
    .from(llmUsage)
    .where(and(eq(llmUsage.tenantId, tenantId), gte(llmUsage.createdAt, startOfMonth)))
    .groupBy(llmUsage.model, llmUsage.purpose);

  const monthEur = await getMonthSpendEur(tenantId);
  return {
    monthEur,
    byModel: rows.map((r) => ({
      model: r.model,
      purpose: r.purpose,
      calls: r.calls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      eur: Number(r.eur),
    })),
  };
}

/**
 * Darf für diesen Tenant noch eine (teure) Generierung erfolgen?
 * Kein Budget gesetzt => unbegrenzt. Sonst Monatsausgabe < Budget.
 */
export async function canGenerate(tenantId: string): Promise<boolean> {
  const [t] = await db
    .select({ budget: tenants.monthlyBudgetEur })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!t || t.budget === null || t.budget === undefined) return true;
  const budget = Number(t.budget);
  if (!Number.isFinite(budget) || budget <= 0) return true;
  const spent = await getMonthSpendEur(tenantId);
  return spent < budget;
}
