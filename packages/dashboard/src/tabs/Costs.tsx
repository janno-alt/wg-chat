import type { Api } from '../api.js';
import { Card, Spinner, ErrorNote, useAsync } from '../components/ui.js';

function eur(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function Costs({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error } = useAsync(() => api.usage(siteKey), [siteKey]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const budget = data.budgetEur ?? null;
  const pct = budget ? Math.min(100, (data.monthEur / budget) * 100) : null;

  return (
    <div className="space-y-4">
      <Card title="Kosten (laufender Monat)">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-3xl font-semibold text-slate-800">{eur(data.monthEur)}</div>
            <div className="text-xs text-slate-400">verbraucht diesen Monat</div>
          </div>
          <div>
            <div className="text-lg text-slate-600">{budget === null ? 'kein Limit' : eur(budget)}</div>
            <div className="text-xs text-slate-400">Monatsbudget</div>
          </div>
        </div>
        {pct !== null && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </Card>

      <Card title="Aufschlüsselung nach Modell / Zweck">
        {!data.byModel.length ? (
          <p className="text-sm text-slate-400">Noch keine LLM-/Embedding-Nutzung diesen Monat.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Modell</th>
                  <th className="py-2 pr-3">Zweck</th>
                  <th className="py-2 pr-3">Calls</th>
                  <th className="py-2 pr-3">Tokens (in/out)</th>
                  <th className="py-2">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-700">{r.model}</td>
                    <td className="py-2 pr-3">{r.purpose}</td>
                    <td className="py-2 pr-3">{r.calls}</td>
                    <td className="py-2 pr-3 text-slate-500">{r.inputTokens.toLocaleString('de-DE')} / {r.outputTokens.toLocaleString('de-DE')}</td>
                    <td className="py-2">{eur(r.eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
