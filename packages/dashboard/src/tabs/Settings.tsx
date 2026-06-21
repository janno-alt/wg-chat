import { useState, type ChangeEvent } from 'react';
import type { Api } from '../api.js';
import type { SettingsResponse } from '../types.js';
import { Button, Card, Field, Input, Spinner, ErrorNote, useAsync } from '../components/ui.js';
import { WidgetPreview } from '../components/WidgetPreview.js';

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

function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(file);
  });
}

/** Liest ein Bild ein und skaliert Raster-Icons auf max. 128px herunter (kleine Data-URL). SVG bleibt unverändert. */
async function processIcon(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('Datei zu groß (max. 2 MB).');
  const dataUrl = await readDataUrl(file);
  if (file.type === 'image/svg+xml') return dataUrl;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Kein gültiges Bild.'));
    img.src = dataUrl;
  });
  const max = 128;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
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
  const [background, setBackground] = useState(str(theme.backgroundColor, '#f7f8fa'));
  const [launcherIcon, setLauncherIcon] = useState(str(theme.launcherIcon, ''));
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    str(theme.position, 'bottom-right') === 'bottom-left' ? 'bottom-left' : 'bottom-right',
  );
  const [buttons, setButtons] = useState(
    (s.starterButtons as Array<{ label?: string }>).map((b) => b?.label ?? '').filter(Boolean).join('\n'),
  );

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const buttonList = buttons.split('\n').map((l) => l.trim()).filter(Boolean);
  const origin = window.location.origin;
  const snippet = `<script async src="${origin}/w.js" data-tenant="${t.siteKey}"></script>`;

  function copySnippet() {
    navigator.clipboard?.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }

  async function onIconChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // erlaubt erneutes Wählen derselben Datei
    if (!file) return;
    try {
      setLauncherIcon(await processIcon(file));
    } catch (err) {
      alert((err as Error)?.message ?? String(err));
    }
  }

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
        theme: {
          primaryColor: primary,
          bubbleColor: bubble,
          textColor,
          backgroundColor: background,
          position,
          launcherIcon: launcherIcon || null,
        },
        starterButtons: buttonList.map((label) => ({ label })),
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
      {/* Links: Bearbeiten */}
      <div className="space-y-4">
        <Card title="Design">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primärfarbe"><Input type="color" value={primary} onChange={(e) => setPrimary(e.currentTarget.value)} /></Field>
            <Field label="Bubble-Farbe"><Input type="color" value={bubble} onChange={(e) => setBubble(e.currentTarget.value)} /></Field>
            <Field label="Textfarbe"><Input type="color" value={textColor} onChange={(e) => setTextColor(e.currentTarget.value)} /></Field>
            <Field label="Chat-Hintergrund"><Input type="color" value={background} onChange={(e) => setBackground(e.currentTarget.value)} /></Field>
            <Field label="Position">
              <select
                value={position}
                onChange={(e) => setPosition(e.currentTarget.value === 'bottom-left' ? 'bottom-left' : 'bottom-right')}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500"
              >
                <option value="bottom-right">unten rechts</option>
                <option value="bottom-left">unten links</option>
              </select>
            </Field>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <span className="mb-1 block text-xs font-medium text-slate-500">Launcher-Icon (eigene Datei)</span>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-xl" style={{ background: bubble, color: textColor }}>
                {launcherIcon ? <img src={launcherIcon} alt="" className="h-[62%] w-[62%] rounded object-contain" /> : '💬'}
              </div>
              <div className="space-y-1">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={onIconChange}
                  className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs hover:file:bg-slate-50"
                />
                {launcherIcon && (
                  <button type="button" onClick={() => setLauncherIcon('')} className="text-xs text-red-600 hover:underline">
                    Icon entfernen
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">PNG/SVG, quadratisch. Wird auf 128px verkleinert.</p>
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
          </div>
        </Card>

        <Card title="Lead-Ziele">
          <div className="space-y-3">
            <Field label="Benachrichtigungs-E-Mail">
              <Input value={notifyEmail} onChange={(e) => setNotifyEmail(e.currentTarget.value)} placeholder="vertrieb@kunde.de" />
            </Field>
            <Field label="Webhook-URL (CRM / FormBuilder / N8N)">
              <Input value={webhook} onChange={(e) => setWebhook(e.currentTarget.value)} placeholder="https://n8n.wg-digital.xyz/webhook/lead" />
            </Field>
          </div>
        </Card>
      </div>

      {/* Rechts: Live-Vorschau + Einbetten (klebt beim Scrollen) */}
      <div className="space-y-4 self-start lg:sticky lg:top-20">
        <Card title="Live-Vorschau">
          <WidgetPreview
            name={name}
            greeting={greeting}
            primary={primary}
            bubble={bubble}
            textColor={textColor}
            background={background}
            launcherIcon={launcherIcon || undefined}
            position={position}
            buttons={buttonList}
          />
          <p className="mt-2 text-xs text-slate-400">Aktualisiert sich live. Erst nach „Speichern" wird das echte Widget angepasst.</p>
        </Card>

        <Card title="Auf der Website einbetten">
          <p className="mb-2 text-xs text-slate-500">Diese eine Zeile auf der Kundenseite einfügen (z. B. Elementor-HTML-Widget im Footer):</p>
          <textarea
            readOnly
            value={snippet}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={copySnippet}>{copied ? 'Kopiert ✓' : 'Snippet kopieren'}</Button>
            <span className="text-xs text-slate-400">Domain unter „Erlaubte Domains" eintragen, sonst wird der Chat blockiert.</span>
          </div>
        </Card>
      </div>

      <div className="lg:col-span-2 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? 'Speichern …' : 'Alles speichern'}</Button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}
