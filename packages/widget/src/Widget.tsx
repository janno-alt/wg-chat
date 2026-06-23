import { useEffect, useRef, useState } from 'preact/hooks';
import type { WidgetConfig, QuickReply } from '@wg-chat/shared';
import { createApi } from './api.js';
import { getSessionId } from './session.js';
import { startOutreach } from './outreach.js';
import { connectVisitorWs } from './ws.js';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  agent?: boolean;
  /** gesetzt => statt Text wird ein Terminbuchungs-Iframe (Meetergo) angezeigt */
  booking?: string;
}

interface Props {
  siteKey: string;
  apiBase: string;
}

const FALLBACK_THEME: WidgetConfig['theme'] = {
  primaryColor: '#2563eb',
  bubbleColor: '#2563eb',
  textColor: '#ffffff',
  position: 'bottom-right',
};

export function App({ siteKey, apiBase }: Props) {
  const api = useRef(createApi(apiBase, siteKey));
  const sessionId = useRef(getSessionId(siteKey));
  const conversationId = useRef<string | undefined>(undefined);
  const humanRef = useRef(false);

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [quick, setQuick] = useState<QuickReply[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [teaser, setTeaser] = useState<string | null>(null);
  const [openerId, setOpenerId] = useState<string | null>(null);
  const [human, setHuman] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(undefined);

  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const teaserRef = useRef<string | null>(null);
  const engagedRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    teaserRef.current = teaser;
  }, [teaser]);

  // Config laden + Outreach starten
  useEffect(() => {
    let cleanupOutreach = () => {};
    api.current
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setMessages([{ role: 'bot', text: cfg.greeting }]);
        setQuick(cfg.starterButtons ?? []);
        cleanupOutreach = startOutreach(cfg.outreach ?? [], siteKey, (t) => {
          setOpen((isOpen) => {
            if (isOpen) {
              setMessages((m) => [...m, { role: 'bot', text: t.message }]);
            } else {
              setTeaser(t.message);
            }
            return isOpen;
          });
        });
      })
      .catch((err) => {
        console.warn('[wg-chat] Konfiguration konnte nicht geladen werden:', err);
        // Minimal-Fallback, damit das Widget trotzdem sichtbar ist
        setConfig({
          tenantId: '',
          name: 'Chat',
          locale: 'de',
          greeting: 'Hallo! Wie kann ich helfen?',
          theme: FALLBACK_THEME,
          starterButtons: [],
          outreach: [],
        });
        setMessages([{ role: 'bot', text: 'Hallo! Wie kann ich helfen?' }]);
      });
    return () => cleanupOutreach();
  }, [siteKey]);

  // Seitenspezifischer Gesprächseinstieg: passenden Opener holen. Er wird die ERSTE
  // Chat-Nachricht (ersetzt die generische Begrüßung) UND erscheint nach kurzer Zeit
  // als Sprechblase über dem geschlossenen Chat (A/B + Tageszeit-Begrüßung vom Server).
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    let timer = 0;
    api.current
      .getOpener(window.location.pathname || '/')
      .then((op) => {
        if (cancelled || !op) return;
        setOpenerId(op.id);
        // Opener als erste Nachricht setzen, solange nur die Begrüßung dasteht.
        setMessages((prev) => (prev.length === 1 && prev[0]!.role === 'bot' ? [{ role: 'bot', text: op.text }] : prev));
        timer = window.setTimeout(() => {
          if (!openRef.current && teaserRef.current == null) setTeaser(op.text);
        }, 4000);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [config]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Live-Übernahme: Besucher-WebSocket, sobald eine Konversation existiert
  useEffect(() => {
    if (!convId) return;
    return connectVisitorWs(apiBase, siteKey, convId, sessionId.current, (msg) => {
      if (msg.type === 'handoff') {
        const active = Boolean(msg.active);
        if (active && !humanRef.current) {
          setMessages((m) => [...m, { role: 'bot', text: '🧑‍💼 Ein Mitarbeiter ist jetzt im Chat.', agent: true }]);
        } else if (!active && humanRef.current) {
          setMessages((m) => [...m, { role: 'bot', text: 'Der Assistent übernimmt wieder.' }]);
        }
        humanRef.current = active;
        setHuman(active);
      } else if (msg.type === 'message' && msg.role === 'agent') {
        setMessages((m) => [...m, { role: 'bot', text: String(msg.text ?? ''), agent: true }]);
      }
    });
  }, [convId, apiBase, siteKey]);

  const theme = config?.theme ?? FALLBACK_THEME;
  const sideClass = theme.position === 'bottom-left' ? 'kc-left' : 'kc-right';

  function openPanel() {
    setOpen(true);
    // Engagement (einmalig) zählen, wenn der Chat aus dem KI-Gesprächseinstieg geöffnet wird.
    if (openerId && !engagedRef.current) {
      engagedRef.current = true;
      void api.current.openerEngage(openerId);
    }
    // Opener ist bereits die erste Nachricht → nur Verhaltens-Teaser (ohne openerId) anhängen.
    if (teaser) {
      if (!openerId) setMessages((m) => [...m, { role: 'bot', text: teaser }]);
      setTeaser(null);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setInput('');
    setQuick([]);
    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setSending(true);
    // Menschlich wirkende Mindest-Tippzeit: auch bei sofortiger Antwort sieht der
    // Nutzer ~2–3 s das Schreibzeichen, statt eine Instant-Antwort zu bekommen.
    const startedAt = Date.now();
    const minTypingMs = 2000 + Math.floor(Math.random() * 900);
    try {
      const res = await api.current.chat({
        sessionId: sessionId.current,
        conversationId: conversationId.current,
        message: trimmed,
        pageUrl: window.location.href,
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await new Promise((r) => setTimeout(r, minTypingMs - elapsed));
      conversationId.current = res.conversationId;
      if (!convId) setConvId(res.conversationId);
      if (res.reply) setMessages((m) => [...m, { role: 'bot', text: res.reply }]);
      // Terminbuchung direkt im Chat einbetten (z.B. Meetergo)
      if (res.booking) setMessages((m) => [...m, { role: 'bot', text: '', booking: res.booking }]);
      if (res.quickReplies?.length) setQuick(res.quickReplies);
      if (res.escalate) setShowLead(false); // Lead-Formular erst auf Klick
    } catch (err) {
      console.warn('[wg-chat] Chat-Fehler:', err);
      setMessages((m) => [
        ...m,
        { role: 'bot', text: 'Entschuldigung, es gab ein technisches Problem. Bitte später erneut versuchen.' },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleQuick(qr: QuickReply) {
    const value = qr.value ?? qr.label;
    if (value === '__lead__') {
      setShowLead(true);
      return;
    }
    if (value === '__handoff__') {
      setMessages((m) => [
        ...m,
        { role: 'bot', text: 'Einen Moment – ich verbinde dich mit einem Mitarbeiter. (Live-Übernahme folgt in Phase 7.)' },
      ]);
      return;
    }
    void send(value);
  }

  async function submitLead(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();
    try {
      await api.current.lead({
        sessionId: sessionId.current,
        conversationId: conversationId.current,
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        message: 'Lead aus dem Chat',
        pageUrl: window.location.href,
      });
      setShowLead(false);
      setLeadDone(true);
      setMessages((m) => [...m, { role: 'bot', text: 'Danke! Wir melden uns zeitnah bei dir. 🙌' }]);
    } catch (err) {
      console.warn('[wg-chat] Lead-Fehler:', err);
      setMessages((m) => [
        ...m,
        { role: 'bot', text: 'Das konnte leider nicht gesendet werden. Bitte später erneut versuchen.' },
      ]);
    }
  }

  if (!config) return null;

  return (
    <div
      class={`kc-root ${sideClass}`}
      style={{
        ['--kc-primary' as string]: theme.primaryColor,
        ['--kc-bubble' as string]: theme.bubbleColor,
        ['--kc-on-primary' as string]: theme.textColor,
        ['--kc-bg' as string]: theme.backgroundColor || '#f7f8fa',
      }}
    >
      {!open && teaser && (
        <div class="kc-teaser" onClick={openPanel}>
          <button
            class="kc-teaser-close"
            onClick={(e) => {
              e.stopPropagation();
              setTeaser(null);
            }}
            aria-label="Schließen"
          >
            ×
          </button>
          {teaser}
        </div>
      )}

      {open && (
        <div class="kc-panel" role="dialog" aria-label="Chat">
          <div class="kc-header">
            <div>
              <div>{config.name}</div>
              {human && <div class="kc-status">● Mitarbeiter verbunden</div>}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Minimieren">
              ×
            </button>
          </div>

          <div class="kc-messages" ref={scrollRef}>
            {messages.map((m, i) =>
              m.booking ? (
                <div key={i} class="kc-embed">
                  <iframe src={m.booking} title="Termin buchen" loading="lazy" />
                </div>
              ) : (
                <div key={i} class={`kc-msg ${m.role === 'user' ? 'kc-user' : 'kc-bot'}`}>
                  {m.agent && <div class="kc-agent-label">Mitarbeiter</div>}
                  {m.text}
                </div>
              ),
            )}
            {sending && (
              <div class="kc-typing" aria-label="schreibt">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {quick.length > 0 && !showLead && (
            <div class="kc-quick">
              {quick.map((qr, i) => (
                <button key={i} onClick={() => handleQuick(qr)}>
                  {qr.label}
                </button>
              ))}
            </div>
          )}

          {showLead && !leadDone ? (
            <form class="kc-lead" onSubmit={submitLead}>
              <input name="name" placeholder="Name" required />
              <input name="email" type="email" placeholder="E-Mail" required />
              <input name="phone" placeholder="Telefon (optional)" />
              <button type="submit">Absenden</button>
            </form>
          ) : (
            <div class="kc-input">
              <input
                value={input}
                placeholder="Nachricht schreiben…"
                onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send(input);
                }}
                disabled={sending}
              />
              <button onClick={() => void send(input)} disabled={sending || !input.trim()} aria-label="Senden">
                ➤
              </button>
            </div>
          )}

          <div class="kc-foot">Powered by wg-chat</div>
        </div>
      )}

      <button class="kc-launcher" onClick={() => (open ? setOpen(false) : openPanel())} aria-label="Chat öffnen">
        {open ? '×' : theme.launcherIcon ? <img class="kc-launcher-img" src={theme.launcherIcon} alt="" /> : '💬'}
      </button>
    </div>
  );
}
