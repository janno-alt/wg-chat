import { and, eq, gte, sql } from 'drizzle-orm';
import { tdb } from '../db/client.js';
import { llmUsage } from '../db/schema.js';
import { estimateCostEur, type UsageStat } from '../llm/provider.js';

/** Schreibt eine Kosten-Zeile (Token + EUR-Schätzung) ins Tenant-Schema. */
export async function recordUsage(params: {
  tenantId: string;
  conversationId?: string | null;
  provider: string;
  model: string;
  purpose: 'embed' | 'generate';
  usage: UsageStat;
}): Promise<number> {
  const costEur = estimateCostEur(params.model, params.usage);
  await tdb().insert(llmUsage).values({
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

/** Summe der LLM-Kosten des laufenden Kalendermonats (EUR) im Tenant-Schema. */
export async function getMonthSpendEur(): Promise<number> {
  const startOfMonth = sql`date_trunc('month', now())`;
  const [row] = await tdb()
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costEur}), 0)` })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, startOfMonth));
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
export async function getUsageSummary(): Promise<UsageSummary> {
  const startOfMonth = sql`date_trunc('month', now())`;
  const rows = await tdb()
    .select({
      model: llmUsage.model,
      purpose: llmUsage.purpose,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}),0)::int`,
      eur: sql<string>`coalesce(sum(${llmUsage.costEur}),0)`,
    })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, startOfMonth))
    .groupBy(llmUsage.model, llmUsage.purpose);

  const monthEur = await getMonthSpendEur();
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
 * Darf noch eine (teure) Generierung erfolgen? Budget kommt aus dem (public)
 * Tenant-Datensatz; Monatsausgabe aus dem Tenant-Schema.
 * Kein/0 Budget => unbegrenzt.
 */
export async function canGenerate(monthlyBudgetEur: number | null): Promise<boolean> {
  if (monthlyBudgetEur === null || !Number.isFinite(monthlyBudgetEur) || monthlyBudgetEur <= 0) {
    return true;
  }
  const spent = await getMonthSpendEur();
  return spent < monthlyBudgetEur;
}
