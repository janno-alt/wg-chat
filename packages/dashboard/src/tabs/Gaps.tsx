import { useState } from 'react';
import type { Api } from '../api.js';
import { Badge, Button, Card, Spinner, ErrorNote, useAsync } from '../components/ui.js';

export function Gaps({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error, reload } = useAsync(() => api.gaps(siteKey), [siteKey]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function suggest(id: string) {
    setBusyId(id);
    try {
      await api.suggestGap(siteKey, id);
      reload();
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card
      title={`Wissenslücken${data ? ` (${data.length})` : ''}`}
      actions={<button onClick={reload} className="text-sm text-slate-500 hover:text-slate-800">Aktualisieren</button>}
    >
      <p className="mb-3 text-xs text-slate-400">
        Fragen, die der Bot nicht beantworten konnte – nach Häufigkeit. „KI-Vorschlag" erzeugt
        per RAG einen Antwort-Entwurf aus der bestehenden Wissensbasis.
      </p>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote error={error} />
      ) : !data?.length ? (
        <p className="text-sm text-slate-400">Keine offenen Wissenslücken. 🎉</p>
      ) : (
        <ul className="space-y-3">
          {data.map((g) => (
            <li key={g.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone="amber">×{g.frequency}</Badge>
                  <span className="text-sm font-medium text-slate-700">{g.question}</span>
                </div>
                <Button variant="ghost" disabled={busyId === g.id} onClick={() => suggest(g.id)}>
                  {busyId === g.id ? '…' : 'KI-Vorschlag'}
                </Button>
              </div>
              {g.suggestedAnswer && (
                <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-600">
                  <span className="text-xs font-medium text-slate-400">Vorschlag: </span>
                  {g.suggestedAnswer}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
