import { useEffect, useRef, useState } from 'react';
import type { Api } from '../api.js';
import { Badge, Button, Card } from '../components/ui.js';

interface LiveMsg {
  from: 'visitor' | 'bot' | 'agent';
  text: string;
  source?: string;
}
interface ConvState {
  messages: LiveMsg[];
  handedOff: boolean;
  lastAt: number;
}

export function Live({ api, siteKey }: { api: Api; siteKey: string }) {
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WS-Verbindung pro Tenant
  useEffect(() => {
    setConvs({});
    setSelected(null);
    let ws: WebSocket;
    try {
      ws = new WebSocket(api.agentSocketUrl(siteKey));
    } catch {
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      const id = m.conversationId as string | undefined;
      if (!id) return;
      setConvs((prev) => {
        const c: ConvState = { ...(prev[id] ?? { messages: [], handedOff: false, lastAt: 0 }) };
        if (m.type === 'visitor_message') c.messages = [...c.messages, { from: 'visitor', text: m.text }];
        else if (m.type === 'bot_message') c.messages = [...c.messages, { from: 'bot', text: m.text, source: m.source }];
        else if (m.type === 'agent_message') c.messages = [...c.messages, { from: 'agent', text: m.text }];
        else if (m.type === 'handoff') c.handedOff = Boolean(m.active);
        c.lastAt = Date.now();
        return { ...prev, [id]: c };
      });
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [siteKey, api]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [convs, selected]);

  async function selectConv(id: string) {
    setSelected(id);
    try {
      const t = await api.transcript(siteKey, id);
      const msgs: LiveMsg[] = t.messages.map((mm) => ({
        from: mm.role === 'user' ? 'visitor' : mm.role === 'agent' ? 'agent' : 'bot',
        text: mm.content,
        source: mm.answerSource ?? undefined,
      }));
      setConvs((prev) => ({ ...prev, [id]: { messages: msgs, handedOff: t.conversation.handedOff, lastAt: Date.now() } }));
    } catch {
      /* History optional */
    }
  }

  function wsSend(type: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    wsRef.current?.send(JSON.stringify({ type, conversationId: selected, ...extra }));
  }

  function sendMsg() {
    const text = input.trim();
    if (!text) return;
    wsSend('agent_message', { text });
    setInput('');
  }

  const ids = Object.keys(convs).sort((a, b) => convs[b]!.lastAt - convs[a]!.lastAt);
  const sel = selected ? convs[selected] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card
        title="Aktive Chats"
        actions={<Badge tone={connected ? 'green' : 'red'}>{connected ? 'verbunden' : 'getrennt'}</Badge>}
      >
        {!ids.length ? (
          <p className="text-sm text-slate-400">Wartet auf Aktivität … (Chats erscheinen live, sobald Besucher schreiben.)</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ids.map((id) => {
              const c = convs[id]!;
              const last = c.messages[c.messages.length - 1];
              return (
                <li key={id}>
                  <button
                    onClick={() => selectConv(id)}
                    className={`flex w-full flex-col gap-1 px-1 py-2 text-left hover:bg-slate-50 ${selected === id ? 'bg-slate-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{id.slice(0, 8)}</span>
                      {c.handedOff && <Badge tone="blue">übernommen</Badge>}
                    </div>
                    {last && <span className="truncate text-xs text-slate-500">{last.from}: {last.text}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title={sel ? `Chat ${selected!.slice(0, 8)}` : 'Chat'}
        actions={
          sel ? (
            sel.handedOff ? (
              <Button variant="ghost" onClick={() => wsSend('release')}>Zurück an Bot</Button>
            ) : (
              <Button onClick={() => wsSend('takeover')}>Übernehmen</Button>
            )
          ) : undefined
        }
      >
        {!sel ? (
          <p className="text-sm text-slate-400">Chat links auswählen.</p>
        ) : (
          <div className="flex h-[60vh] flex-col">
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
              {sel.messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'visitor' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.from === 'visitor'
                        ? 'bg-slate-100 text-slate-800'
                        : m.from === 'agent'
                          ? 'bg-teal-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <div className="mb-0.5 text-[10px] font-semibold uppercase opacity-70">
                      {m.from === 'visitor' ? 'Besucher' : m.from === 'agent' ? 'Du' : `Bot${m.source ? ` · ${m.source}` : ''}`}
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                placeholder={sel.handedOff ? 'Nachricht an den Besucher …' : 'Erst „Übernehmen", dann antworten'}
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500"
              />
              <Button onClick={sendMsg} disabled={!input.trim()}>Senden</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
