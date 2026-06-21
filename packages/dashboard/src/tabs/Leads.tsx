import type { Api } from '../api.js';
import { Badge, Card, Spinner, ErrorNote, useAsync, fmtDate } from '../components/ui.js';

export function Leads({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error, reload } = useAsync(() => api.leads(siteKey), [siteKey]);

  return (
    <Card title={`Leads${data ? ` (${data.length})` : ''}`} actions={<button onClick={reload} className="text-sm text-slate-500 hover:text-slate-800">Aktualisieren</button>}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote error={error} />
      ) : !data?.length ? (
        <p className="text-sm text-slate-400">Noch keine Leads erfasst.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">E-Mail</th>
                <th className="py-2 pr-3">Telefon</th>
                <th className="py-2 pr-3">Anliegen</th>
                <th className="py-2 pr-3">CRM</th>
                <th className="py-2">Zeit</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">{l.name ?? '—'}</td>
                  <td className="py-2 pr-3">{l.email ?? '—'}</td>
                  <td className="py-2 pr-3">{l.phone ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-500">{String(l.payload?.message ?? '—')}</td>
                  <td className="py-2 pr-3">{l.pushedToCrm ? <Badge tone="green">übergeben</Badge> : <Badge tone="slate">offen</Badge>}</td>
                  <td className="py-2 text-xs text-slate-400">{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
