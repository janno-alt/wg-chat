import { Fragment, useState } from 'react';
import type { Api } from '../api.js';
import type { Chunk, KbDiagnostics, SearchResult } from '../types.js';
import { Badge, Button, Card, Field, Input, Spinner, ErrorNote, useAsync, fmtDate } from '../components/ui.js';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="truncate font-mono text-xs text-slate-700" title={value}>{value}</div>
    </div>
  );
}

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
  const [crawlMsg, setCrawlMsg] = useState<string | null>(null);
  const [crawlErr, setCrawlErr] = useState(false);
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [a, setA] = useState('');

  async function doCrawl() {
    if (!crawlUrl) return;
    setBusy(true);
    setCrawlErr(false);
    setCrawlMsg('Crawle …');
    try {
      const r = await api.crawl(siteKey, crawlUrl, maxPages);
      let msg = `${r.pagesFound} Seite(n) gefunden · ${r.embedded} mit Embeddings · ${r.failed} ohne.`;
      if (r.errors.length) {
        msg += ' Grund: ' + r.errors.join(' | ');
        setCrawlErr(true);
      }
      setCrawlMsg(msg);
      reload();
    } catch (e) {
      setCrawlErr(true);
      setCrawlMsg(`Fehler: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Wissen testen
  const [testQuery, setTestQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  async function testKnowledge() {
    if (!testQuery.trim()) return;
    setSearching(true);
    setSearchErr(null);
    try {
      setResult(await api.searchKb(siteKey, testQuery.trim()));
    } catch (e) {
      setSearchErr((e as Error)?.message ?? String(e));
      setResult(null);
    } finally {
      setSearching(false);
    }
  }

  // Diagnose: wo liegen die Daten wirklich?
  const [diag, setDiag] = useState<KbDiagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  async function runDiagnostics() {
    setDiagBusy(true);
    try {
      setDiag(await api.kbDiagnostics(siteKey));
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setDiagBusy(false);
    }
  }

  async function purgeAll() {
    if (!confirm('Wirklich ALLE Dokumente und Embeddings dieses Kunden löschen? Danach einmal sauber neu crawlen.')) return;
    setDiagBusy(true);
    try {
      const { purged } = await api.purgeKb(siteKey);
      alert(
        `Geleert: ${purged.schemaDocs} Dokument(e) + ${purged.schemaChunks} Chunk(s) im Kunden-Schema, ` +
          `${purged.publicDocs} + ${purged.publicChunks} aus public (Altlast).`,
      );
      setDiag(null);
      reload();
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setDiagBusy(false);
    }
  }

  // Chunks aufklappen
  const [expanded, setExpanded] = useState<Record<string, Chunk[] | 'loading'>>({});
  async function toggleChunks(docId: string) {
    setExpanded((m) => {
      const next = { ...m };
      if (next[docId]) delete next[docId];
      else next[docId] = 'loading';
      return next;
    });
    if (expanded[docId]) return;
    try {
      const chunks = await api.listChunks(siteKey, docId);
      setExpanded((m) => ({ ...m, [docId]: chunks }));
    } catch {
      setExpanded((m) => {
        const n = { ...m };
        delete n[docId];
        return n;
      });
    }
  }

  const topSim = result?.hits[0]?.similarity ?? 0;
  const wouldAnswer = result ? topSim >= result.thresholds.rag : false;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Website crawlen">
          <div className="space-y-2">
            <Input placeholder="https://kunde.example" value={crawlUrl} onChange={(e) => setCrawlUrl(e.currentTarget.value)} />
            <div className="flex items-center gap-2">
              <Input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.currentTarget.value))} />
              <Button disabled={busy || !crawlUrl} onClick={doCrawl}>Crawlen</Button>
            </div>
            <p className="text-xs text-slate-400">Sitemap bevorzugt, sonst BFS. Erzeugt Embeddings.</p>
            {crawlMsg && (
              <p className={`text-xs ${crawlErr ? 'text-red-600' : 'text-slate-600'}`}>{crawlMsg}</p>
            )}
          </div>
        </Card>

        <Card title="Einzelne URL">
          <div className="space-y-2">
            <Input placeholder="https://kunde.example/preise" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
            <Button disabled={busy || !url} onClick={() => run(async () => { await api.ingestUrl(siteKey, url); setUrl(''); })}>Hinzufügen</Button>
          </div>
        </Card>

        <Card title="Manuelles FAQ">
          <div className="space-y-2">
            <Field label="Frage"><Input value={q} onChange={(e) => setQ(e.currentTarget.value)} /></Field>
            <Field label="Antwort"><Input value={a} onChange={(e) => setA(e.currentTarget.value)} /></Field>
            <Button
              disabled={busy || !q || !a}
              onClick={() => run(async () => { await api.addManual(siteKey, { sourceType: 'faq', title: q, content: q, canonicalAnswer: a }); setQ(''); setA(''); })}
            >
              Speichern
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Wissen testen">
        <p className="mb-2 text-xs text-slate-500">
          Tippe eine Beispielfrage – du siehst, welche Inhalte der Bot findet und mit welchem Score. So erkennst du,
          warum er ggf. eskaliert (kein Treffer über der RAG-Schwelle).
        </p>
        <div className="flex gap-2">
          <Input value={testQuery} placeholder="z. B. Was kostet eine Website?" onChange={(e) => setTestQuery(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && testKnowledge()} />
          <Button onClick={testKnowledge} disabled={searching || !testQuery.trim()}>{searching ? 'Suche …' : 'Testen'}</Button>
        </div>
        {searchErr && <div className="mt-2"><ErrorNote error={searchErr} /></div>}
        {result && (
          <div className="mt-3 space-y-2">
            <div className={`rounded-md px-3 py-2 text-sm ${wouldAnswer ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
              {result.hits.length === 0
                ? 'Keine Treffer – die Wissensbasis hat dazu nichts (oder es fehlen Embeddings). Der Bot eskaliert.'
                : wouldAnswer
                  ? `Bester Treffer ${(topSim * 100).toFixed(0)} % ≥ RAG-Schwelle (${(result.thresholds.rag * 100).toFixed(0)} %) → der Bot antwortet.`
                  : `Bester Treffer nur ${(topSim * 100).toFixed(0)} % < RAG-Schwelle (${(result.thresholds.rag * 100).toFixed(0)} %) → der Bot eskaliert. Mehr/passenderes Wissen einpflegen oder Schwelle senken.`}
            </div>
            {result.hits.map((h) => {
              const pct = Math.round(h.similarity * 100);
              const tone = h.similarity >= result.thresholds.direct ? 'green' : h.similarity >= result.thresholds.rag ? 'blue' : 'amber';
              return (
                <div key={h.chunkId} className="rounded-lg border border-slate-100 p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone={tone}>{pct} %</Badge>
                    <span className="truncate text-xs text-slate-500">{h.title || h.sourceUrl || '—'}</span>
                  </div>
                  <div className="line-clamp-3 text-sm text-slate-700">{h.content}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Diagnose (Daten-Speicherort)"
        actions={
          <div className="flex gap-1">
            <Button variant="subtle" disabled={diagBusy} onClick={runDiagnostics}>{diagBusy ? 'Prüfe …' : 'Prüfen'}</Button>
            <Button variant="danger" disabled={diagBusy} onClick={purgeAll}>KB komplett leeren</Button>
          </div>
        }
      >
        <p className="text-xs text-slate-500">
          Zeigt, in welchem Schema der Bot liest/schreibt und wo Dokumente &amp; Chunks wirklich liegen –
          deckt auf, warum die Crawl-Meldung und die Tabelle sich widersprechen. „KB komplett leeren"
          setzt diesen Kunden zurück (für einen sauberen Neu-Crawl).
        </p>
        {diag && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Schema" value={diag.schemaName ?? '—'} />
              <Stat label="search_path" value={diag.searchPath} />
              <Stat label="App sieht Docs / Chunks" value={`${diag.appDocs} / ${diag.appChunks}`} />
              <Stat label={`Schema Docs / Chunks`} value={`${diag.tenantSchemaDocs ?? '—'} / ${diag.tenantSchemaChunks ?? '—'}`} />
              <Stat label="public Docs / Chunks (Altlast)" value={`${diag.publicDocs ?? '—'} / ${diag.publicChunks ?? '—'}`} />
              <Stat label="Docs MIT Chunks" value={`${diag.docsWithChunks ?? '—'}`} />
              <Stat label="Verwaiste Chunks" value={`${diag.orphanChunks ?? '—'}`} />
              <Stat label="Doppelte URLs" value={`${diag.duplicateUrls ?? '—'}`} />
            </div>
            {diag.notes.map((n, i) => (
              <div key={i} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{n}</div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Wissensbasis${data ? ` (${data.length} Dokumente)` : ''}`} actions={<Button variant="ghost" onClick={reload}>Aktualisieren</Button>}>
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
                  <th className="py-2 pr-3">Wissen</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <Fragment key={d.id}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-700">{d.title ?? '(ohne Titel)'}</div>
                        {d.sourceUrl && <div className="text-xs text-slate-400">{d.sourceUrl}</div>}
                        <div className="text-xs text-slate-400">{fmtDate(d.createdAt)}</div>
                      </td>
                      <td className="py-2 pr-3"><Badge tone="blue">{d.sourceType}</Badge></td>
                      <td className="py-2 pr-3">
                        {d.chunkCount > 0 ? (
                          <button onClick={() => toggleChunks(d.id)} className="text-teal-700 hover:underline">
                            {d.chunkCount} Chunk(s) {expanded[d.id] ? '▲' : '▼'}
                          </button>
                        ) : (
                          <div>
                            <Badge tone="amber">keine Embeddings</Badge>
                            {d.ingestError && <div className="mt-1 max-w-xs text-xs text-red-600">{d.ingestError}</div>}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={d.status === 'published' ? 'green' : d.status === 'draft' ? 'amber' : 'slate'}>{d.status}</Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {d.status === 'draft' && <Button variant="ghost" disabled={busy} onClick={() => run(() => api.publish(siteKey, d.id))}>Freigeben</Button>}
                          <Button variant="subtle" disabled={busy} onClick={() => run(() => api.reindex(siteKey, d.id))}>Reindex</Button>
                          <Button variant="subtle" disabled={busy} onClick={() => run(() => api.faqgen(siteKey, d.id, 5))}>FAQ-Gen</Button>
                          <Button variant="danger" disabled={busy} onClick={() => confirm('Löschen?') && run(() => api.deleteDoc(siteKey, d.id))}>Löschen</Button>
                        </div>
                      </td>
                    </tr>
                    {expanded[d.id] && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-3 py-2">
                          {expanded[d.id] === 'loading' ? (
                            <span className="text-xs text-slate-400">Lädt Chunks …</span>
                          ) : (
                            <div className="space-y-1">
                              {(expanded[d.id] as Chunk[]).map((c, i) => (
                                <div key={c.id} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-600">
                                  <span className="mr-2 font-mono text-slate-400">#{i + 1}</span>
                                  {c.content}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
