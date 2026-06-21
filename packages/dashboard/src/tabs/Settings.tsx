import { useState } from 'react';
import type { Api } from '../api.js';
import type { SettingsResponse } from '../types.js';
import { Button, Card, Field, Input, Spinner, ErrorNote, useAsync } from '../components/ui.js';

export function Settings({ api, siteKey }: { api: Api; siteKey: string }) {
  const { data, loading, error, reload } = useAsync(() => api.getSettings(siteKey), [siteKey]);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  return <SettingsForm key={siteKey} api={api} siteKey={siteKey} data={data} onSaved={reload} />;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function SettingsForm({
  api,
  siteKey,
  data,
  onSaved,
}: {
  api: Api;
  siteKey: string;
  data: SettingsResponse;
  onSaved: () => void;
}) {
  const t = data.tenant;
  const s = data.settings;
  const theme = s.theme as Record<string, unknown>;

  const [name, setName] = useState(t.name);
  const [domains, setDomains] = useState((t.allowedDomains ?? []).join(', '));
  const [budget, setBudget] = useState(t.monthlyBudgetEur === null ? '' : String(t.monthlyBudgetEur));
  const [active, setActive] = useState(t.active);

  const [greeting, setGreeting] = useState(s.greeting);
  const [fallback, setFallback] = useState(s.fallbackText);
  const [notifyEmail, setNotifyEmail] = useState(s.notifyEmail ?? '');
  const [webhook, setWebhook] = useState(s.leadWebhookUrl ?? '');
  const [primary, setPrimary] = useState(str(theme.primaryColor, '#0f766e'));
  const [bubble, setBubble] = useState(str(theme.bubbleColor, '#0f766e'));
  const [textColor, setTextColor] = useState(str(theme.textColor, '#ffffff'));
  const [position, setPosition] = useState(str(theme.position, 'bottom-right'));
  const [buttons, setButtons] = useState(
    (s.starterButtons as Array<{ label?: string }>).map((b) => b?.label ?? '').filter(Boolean).join('\n'),
  );

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.patchTenant(siteKey, {
        name,
        allowedDomains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        monthlyBudgetEur: budget.trim() === '' ? null : Number(budget),
        active,
      });
      await api.putSettings(siteKey, {
        greeting,
        fallbackText: fallback,
        notifyEmail: notifyEmail.trim() || null,
        leadWebhookUrl: webhook.trim() || null,
        theme: { primaryColor: primary, bubbleColor: bubble, textColor, position },
        starterButtons: buttons.split('\n').map((l) => l.trim()).filter(Boolean).map((label) => ({ label })),
      });
      setMsg('Gespeichert ✓');
      onSaved();
    } catch (e) {
      setMsg(`Fehler: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Stammdaten">
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.currentTarget.value)} /></Field>
          <Field label="Erlaubte Domains (Komma-getrennt)">
            <Input value={domains} onChange={(e) => setDomains(e.currentTarget.value)} placeholder="kunde.de, www.kunde.de" />
          </Field>
          <Field label="Monatsbudget € (leer = unbegrenzt)">
            <Input type="number" value={budget} onChange={(e) => setBudget(e.currentTarget.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} /> aktiv
          </label>
          <p className="text-xs text-slate-400">site_key: <code>{t.siteKey}</code></p>
        </div>
      </Card>

      <Card title="Lead-Ziele">
        <div className="space-y-3">
          <Field label="Benachrichtigungs-E-Mail">
            <Input value={notifyEmail} onChange={(e) => setNotifyEmail(e.currentTarget.value)} placeholder="vertrieb@kunde.de" />
          </Field>
          <Field label="Webhook-URL (CRM / FormBuilder / N8N)">
            <Input value={webhook} onChange={(e) => setWebhook(e.currentTarget.value)} placeholder="https://n8n.kine.media/webhook/lead" />
          </Field>
        </div>
      </Card>

      <Card title="Texte">
        <div className="space-y-3">
          <Field label="Begrüßung"><Input value={greeting} onChange={(e) => setGreeting(e.currentTarget.value)} /></Field>
          <Field label="Fallback-Text (Eskalation)"><Input value={fallback} onChange={(e) => setFallback(e.currentTarget.value)} /></Field>
          <Field label="Starter-Buttons (eine Zeile pro Button)">
            <textarea
              value={buttons}
              onChange={(e) => setButtons(e.currentTarget.value)}
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500"
            />
          </Field>
        </div>
      </Card>

      <Card title="Design">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primärfarbe"><Input type="color" value={primary} onChange={(e) => setPrimary(e.currentTarget.value)} /></Field>
          <Field label="Bubble-Farbe"><Input type="color" value={bubble} onChange={(e) => setBubble(e.currentTarget.value)} /></Field>
          <Field label="Textfarbe"><Input type="color" value={textColor} onChange={(e) => setTextColor(e.currentTarget.value)} /></Field>
          <Field label="Position">
            <select
              value={position}
              onChange={(e) => setPosition(e.currentTarget.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500"
            >
              <option value="bottom-right">unten rechts</option>
              <option value="bottom-left">unten links</option>
            </select>
          </Field>
        </div>
      </Card>

      <div className="lg:col-span-2 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? 'Speichern …' : 'Alles speichern'}</Button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}
