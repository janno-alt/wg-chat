import { useState } from 'react';
import type { Api } from '../api.js';
import { Badge, Button, Card, Field, Input, Spinner, ErrorNote, useAsync, fmtDate } from '../components/ui.js';

export function KnowledgeBase({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error, reload } = useAsync(() => api.listKb(siteKey), [siteKey]);
  const [busy, setBusy] = useState(false);

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

  const [crawlUrl, setCrawlUrl] = useState('');
  const [maxPages, setMaxPages] = useState(20);
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [a, setA] = useState('');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Website crawlen">
          <div className="space-y-2">
            <Input placeholder="https://kunde.example" value={crawlUrl} onChange={(e) => setCrawlUrl(e.currentTarget.value)} />
            <div className="flex items-center gap-2">
              <Input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.currentTarget.value))} />
              <Button disabled={busy || !crawlUrl} onClick={() => run(() => api.crawl(siteKey, crawlUrl, maxPages))}>
                Crawlen
              </Button>
            </div>
            <p className="text-xs text-slate-400">Sitemap bevorzugt, sonst BFS. Erzeugt Embeddings.</p>
          </div>
        </Card>

        <Card title="Einzelne URL">
          <div className="space-y-2">
            <Input placeholder="https://kunde.example/preise" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
            <Button disabled={busy || !url} onClick={() => run(async () => { await api.ingestUrl(siteKey, url); setUrl(''); })}>
              Hinzufügen
            </Button>
          </div>
        </Card>

        <Card title="Manuelles FAQ">
          <div className="space-y-2">
            <Field label="Frage">
              <Input value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </Field>
            <Field label="Antwort">
              <Input value={a} onChange={(e) => setA(e.currentTarget.value)} />
            </Field>
            <Button
              disabled={busy || !q || !a}
              onClick={() =>
                run(async () => {
                  await api.addManual(siteKey, { sourceType: 'faq', title: q, content: q, canonicalAnswer: a });
                  setQ('');
                  setA('');
                })
              }
            >
              Speichern
            </Button>
          </div>
        </Card>
      </div>

      <Card title={`Dokumente${data ? ` (${data.length})` : ''}`} actions={<Button variant="ghost" onClick={reload}>Aktualisieren</Button>}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote error={error} />
        ) : !data?.length ? (
          <p className="text-sm text-slate-400">Noch keine Inhalte. Crawle eine Website oder füge ein FAQ hinzu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Titel / URL</th>
                  <th className="py-2 pr-3">Typ</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Erstellt</th>
                  <th className="py-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-700">{d.title ?? '(ohne Titel)'}</div>
                      {d.sourceUrl && <div className="text-xs text-slate-400">{d.sourceUrl}</div>}
                    </td>
                    <td className="py-2 pr-3"><Badge tone="blue">{d.sourceType}</Badge></td>
                    <td className="py-2 pr-3">
                      <Badge tone={d.status === 'published' ? 'green' : d.status === 'draft' ? 'amber' : 'slate'}>{d.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400">{fmtDate(d.createdAt)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {d.status === 'draft' && (
                          <Button variant="ghost" disabled={busy} onClick={() => run(() => api.publish(siteKey, d.id))}>Freigeben</Button>
                        )}
                        <Button variant="subtle" disabled={busy} onClick={() => run(() => api.reindex(siteKey, d.id))}>Reindex</Button>
                        <Button variant="subtle" disabled={busy} onClick={() => run(() => api.faqgen(siteKey, d.id, 5))}>FAQ-Gen</Button>
                        <Button variant="danger" disabled={busy} onClick={() => confirm('Löschen?') && run(() => api.deleteDoc(siteKey, d.id))}>Löschen</Button>
                      </div>
                    </td>
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
