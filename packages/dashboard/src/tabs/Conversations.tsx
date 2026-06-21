import { useState } from 'react';
import type { Api } from '../api.js';
import type { Transcript } from '../types.js';
import { Badge, Card, Spinner, ErrorNote, useAsync, fmtDate } from '../components/ui.js';

const sourceTone: Record<string, string> = {
  faq: 'green',
  cache: 'green',
  retrieval: 'blue',
  llm: 'amber',
  escalation: 'red',
  human: 'blue',
  rule: 'slate',
};

export function Conversations({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error } = useAsync(() => api.conversations(siteKey), [siteKey]);
  const [sel, setSel] = useState<Transcript | null>(null);
  const [loadingT, setLoadingT] = useState(false);

  async function open(id: string) {
    setLoadingT(true);
    try {
      setSel(await api.transcript(siteKey, id));
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setLoadingT(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card title={`Konversationen${data ? ` (${data.length})` : ''}`}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote error={error} />
        ) : !data?.length ? (
          <p className="text-sm text-slate-400">Noch keine Konversationen.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => open(c.id)}
                  className={`flex w-full flex-col items-start gap-1 px-1 py-2 text-left hover:bg-slate-50 ${sel?.conversation.id === c.id ? 'bg-slate-50' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === 'escalated' ? 'red' : c.status === 'closed' ? 'slate' : 'green'}>{c.status}</Badge>
                    {c.leadCaptured && <Badge tone="amber">Lead</Badge>}
                    <span className="text-xs text-slate-400">{fmtDate(c.createdAt)}</span>
                  </div>
                  <span className="truncate text-xs text-slate-500">{c.pageUrl ?? '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Transkript">
        {loadingT ? (
          <Spinner />
        ) : !sel ? (
          <p className="text-sm text-slate-400">Konversation links auswählen.</p>
        ) : (
          <div className="space-y-3">
            {sel.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.answerSource && (
                    <div className="mt-1">
                      <Badge tone={sourceTone[m.answerSource] ?? 'slate'}>{m.answerSource}</Badge>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
