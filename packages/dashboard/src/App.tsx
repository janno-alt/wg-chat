import { useMemo, useState } from 'react';
import { createApi, type Api } from './api.js';
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, useAsync } from './components/ui.js';
import { KnowledgeBase } from './tabs/KnowledgeBase.js';
import { Conversations } from './tabs/Conversations.js';
import { Leads } from './tabs/Leads.js';
import { Gaps } from './tabs/Gaps.js';
import { Costs } from './tabs/Costs.js';
import { Settings } from './tabs/Settings.js';
import { Live } from './tabs/Live.js';

const CFG_KEY = 'kine-dash:cfg';
interface Cfg {
  baseUrl: string;
  key: string;
}

function loadCfg(): Cfg | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? (JSON.parse(raw) as Cfg) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [cfg, setCfg] = useState<Cfg | null>(loadCfg());
  const api = useMemo(() => (cfg ? createApi(cfg.baseUrl, cfg.key) : null), [cfg]);

  if (!cfg || !api) {
    return (
      <Login
        onLogin={(c) => {
          localStorage.setItem(CFG_KEY, JSON.stringify(c));
          setCfg(c);
        }}
      />
    );
  }
  return (
    <Shell
      api={api}
      onLogout={() => {
        localStorage.removeItem(CFG_KEY);
        setCfg(null);
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (c: Cfg) => void }) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8787');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createApi(baseUrl, key).listTenants(); // Zugang prüfen
      onLogin({ baseUrl, key });
    } catch (e) {
      setError(`Anmeldung fehlgeschlagen: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold text-slate-800">kine-chat</h1>
        <p className="mb-5 text-sm text-slate-500">Dashboard – mit dem Admin-Schlüssel anmelden.</p>
        <Card>
          <div className="space-y-3">
            <Field label="Backend-URL"><Input value={baseUrl} onChange={(e) => setBaseUrl(e.currentTarget.value)} /></Field>
            <Field label="Admin-Schlüssel (x-admin-key)">
              <Input type="password" value={key} onChange={(e) => setKey(e.currentTarget.value)} />
            </Field>
            {error && <ErrorNote error={error} />}
            <Button type="submit" disabled={busy || !key} onClick={submit}>{busy ? 'Prüfe …' : 'Anmelden'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'kb', label: 'Wissensbasis', C: KnowledgeBase },
  { id: 'live', label: 'Live', C: Live },
  { id: 'conv', label: 'Konversationen', C: Conversations },
  { id: 'leads', label: 'Leads', C: Leads },
  { id: 'gaps', label: 'Wissenslücken', C: Gaps },
  { id: 'costs', label: 'Kosten', C: Costs },
  { id: 'settings', label: 'Einstellungen', C: Settings },
] as const;

function Shell({ api, onLogout }: { api: Api; onLogout: () => void }) {
  const { data: tenants, loading, error, reload } = useAsync(() => api.listTenants(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('kb');

  const activeSiteKey = selected ?? tenants?.[0]?.siteKey ?? null;
  const Active = TABS.find((t) => t.id === tab)!.C;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-lg font-semibold text-teal-700">kine-chat</div>
          <button onClick={onLogout} className="text-xs text-slate-400 hover:text-slate-700">Abmelden</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 py-1 text-xs font-medium uppercase text-slate-400">Kunden</div>
          {loading ? (
            <Spinner />
          ) : error ? (
            <ErrorNote error={error} />
          ) : (
            <ul className="space-y-0.5">
              {tenants?.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelected(t.siteKey)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${activeSiteKey === t.siteKey ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-100'}`}
                  >
                    <span className="truncate">{t.name}</span>
                    {!t.active && <Badge tone="red">inaktiv</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <CreateTenant api={api} onCreated={(siteKey) => { reload(); setSelected(siteKey); }} />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {!activeSiteKey ? (
          <div className="p-10 text-slate-400">Lege links einen Kunden an, um zu starten.</div>
        ) : (
          <>
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
              <div className="flex items-center gap-1 overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="ml-auto text-xs text-slate-400">site_key: <code>{activeSiteKey}</code></span>
              </div>
            </header>
            <div className="p-6">
              <Active key={activeSiteKey} api={api} siteKey={activeSiteKey} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CreateTenant({ api, onCreated }: { api: Api; onCreated: (siteKey: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [siteKey, setSiteKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await api.createTenant({ name, siteKey: siteKey.trim() || undefined });
      setName('');
      setSiteKey('');
      setOpen(false);
      onCreated(res.siteKey);
    } catch (e) {
      alert((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 w-full rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
        ＋ Neuer Kunde
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-2">
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <Input placeholder="site_key (optional)" value={siteKey} onChange={(e) => setSiteKey(e.currentTarget.value)} />
      <div className="flex gap-2">
        <Button disabled={busy || !name} onClick={create}>Anlegen</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
      </div>
    </div>
  );
}
