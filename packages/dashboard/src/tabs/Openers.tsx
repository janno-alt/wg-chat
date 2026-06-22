import { useState } from 'react';
import type { Api } from '../api.js';
import type { Opener } from '../types.js';
import { Badge, Button, Card, Field, Input, Spinner, ErrorNote, useAsync } from '../components/ui.js';

export function Openers({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error, reload } = useAsync(() => api.listOpeners(siteKey), [siteKey]);
  const [busy, setBusy] = useState(false);
  const [pageMatch, setPageMatch] = useState('/');
  const [text, setText] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // nach Seite (pageMatch) gruppieren
  const groups = new Map<string, Opener[]>();
  for (const o of data ?? []) {
    const arr = groups.get(o.pageMatch) ?? [];
    arr.push(o);
    groups.set(o.pageMatch, arr);
  }

  function rate(o: Opener): string {
    return o.impressions > 0 ? `${Math.round((o.engagements / o.impressions) * 100)} %` : '–';
  }

  return (
    <div className="space-y-5">
      <Card title="Neuer Gesprächseinstieg (manuell)">
        <p className="mb-2 text-xs text-slate-500">
          Einstiege werden beim Crawlen automatisch je Seite von der KI vorgeschlagen (verkaufsorientiert,
          als offene Frage). Hier kannst du eigene ergänzen – nur die Frage selbst, <strong>ohne „Hallo"</strong>:
          eine tageszeitabhängige Begrüßung (nach 17 Uhr lockerer) wird automatisch vorangestellt, und der
          Einstieg wird die erste Nachricht im Chat. Seite = Pfad-Prefix (z. B. <code>/leistungen/wartung</code>,
          <code>/</code> = überall). Mehrere pro Seite werden gleichmäßig ausgespielt (A/B).
        </p>
        <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Field label="Seite (Pfad)">
            <Input value={pageMatch} onChange={(e) => setPageMatch(e.currentTarget.value)} placeholder="/leistungen/wartung" />
          </Field>
          <Field label="Einstiegsfrage">
            <Input value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Welches Website-System nutzt du?" />
          </Field>
          <Button
            disabled={busy || text.trim().length < 3}
            onClick={() => run(async () => { await api.addOpener(siteKey, { pageMatch: pageMatch.trim() || '/', text: text.trim() }); setText(''); })}
          >
            Hinzufügen
          </Button>
        </div>
      </Card>

      <Card
        title={`Gesprächseinstiege${data ? ` (${data.length})` : ''}`}
        actions={<Button variant="ghost" onClick={reload}>Aktualisieren</Button>}
      >
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote error={error} />
        ) : !data?.length ? (
          <p className="text-sm text-slate-400">
            Noch keine Einstiege. Crawle eine Website (die KI schlägt dann pro Seite welche vor) oder füge oben manuell welche hinzu.
          </p>
        ) : (
          <div className="space-y-5">
            {[...groups.entries()].map(([page, items]) => (
              <div key={page}>
                <div className="mb-1 font-mono text-xs text-slate-500">{page}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="py-1 pr-3">Einstieg</th>
                      <th className="py-1 pr-3">Quelle</th>
                      <th className="py-1 pr-3" title="Anzeigen">Impr.</th>
                      <th className="py-1 pr-3" title="Klicks">Klicks</th>
                      <th className="py-1 pr-3" title="Klickrate">Rate</th>
                      <th className="py-1">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((o) => (
                      <tr key={o.id} className={`border-t border-slate-100 ${o.active ? '' : 'opacity-50'}`}>
                        <td className="py-2 pr-3 text-slate-700">{o.text}</td>
                        <td className="py-2 pr-3">
                          <Badge tone={o.source === 'ai' ? 'blue' : 'slate'}>{o.source === 'ai' ? 'KI' : 'manuell'}</Badge>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{o.impressions}</td>
                        <td className="py-2 pr-3 tabular-nums">{o.engagements}</td>
                        <td className="py-2 pr-3 tabular-nums font-medium">{rate(o)}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button variant="subtle" disabled={busy} onClick={() => run(() => api.updateOpener(siteKey, o.id, { active: !o.active }))}>
                              {o.active ? 'Pausieren' : 'Aktivieren'}
                            </Button>
                            <Button variant="danger" disabled={busy} onClick={() => confirm('Einstieg löschen?') && run(() => api.deleteOpener(siteKey, o.id))}>
                              Löschen
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
