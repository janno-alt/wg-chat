/**
 * Wire-Typen, die zwischen Widget (Browser) und Backend geteilt werden.
 * Bewusst klein gehalten – nur das öffentliche Vertragsformat.
 */

/** Woher eine Bot-Antwort stammt – treibt Analytics & Kostenanalyse. */
export type AnswerSource =
  | 'rule' // clientseitige Buttons / vordefinierter Flow
  | 'faq' // exakter/Keyword-FAQ-Treffer (0 LLM)
  | 'cache' // semantischer Cache-Treffer (nur 1 Embedding)
  | 'retrieval' // hoher KB-Vektortreffer, kanonische Antwort (0 Generierung)
  | 'llm' // RAG-Generierung
  | 'human' // Live-Übernahme durch Agent
  | 'escalation'; // Fallback: Lead/Übergabe/Kontakt

export interface QuickReply {
  /** sichtbarer Button-Text */
  label: string;
  /** als Nutzer-Eingabe gesendeter Wert (default: label) */
  value?: string;
}

/** Theming, das das Widget vom Backend bezieht (pro Tenant). */
export interface WidgetTheme {
  primaryColor: string;
  bubbleColor: string;
  textColor: string;
  position: 'bottom-right' | 'bottom-left';
  launcherIcon?: string;
}

/** Öffentliche Tenant-Konfiguration, die das Widget beim Laden zieht. */
export interface WidgetConfig {
  tenantId: string;
  name: string;
  locale: string;
  greeting: string;
  theme: WidgetTheme;
  /** initiale Quick-Reply-Buttons (Stufe 1, 0 Kosten) */
  starterButtons: QuickReply[];
  /** clientseitige Outreach-Trigger (Phase 3 füllt das) */
  outreach: OutreachTrigger[];
}

export type OutreachCondition =
  | 'time_on_page'
  | 'scroll_depth'
  | 'idle'
  | 'exit_intent'
  | 'element_dwell';

export interface OutreachTrigger {
  id: string;
  /** glob/prefix-Match auf den Pfad, z.B. "/preise" */
  pageMatch: string;
  condition: OutreachCondition;
  /** Schwelle: Sekunden (time/idle), Prozent (scroll), CSS-Selektor-Verweildauer */
  threshold: number;
  /** optionaler CSS-Selektor für element_dwell */
  selector?: string;
  /** vorgefertigte Nachricht – 0 LLM-Kosten */
  message: string;
}

export interface ChatRequest {
  /** stabile Session-ID (clientseitig erzeugt, in localStorage gehalten) */
  sessionId: string;
  /** laufende Konversations-ID, falls bekannt (Server vergibt initial) */
  conversationId?: string;
  message: string;
  /** aktuelle Seite, für Kontext/Analytics */
  pageUrl?: string;
}

export interface ChatResponse {
  conversationId: string;
  reply: string;
  source: AnswerSource;
  /** vorgeschlagene Folge-Buttons */
  quickReplies?: QuickReply[];
  /** true => Widget zeigt Eskalations-/Lead-Formular an */
  escalate?: boolean;
  /** true => ein menschlicher Agent ist aktiv (Phase 7) */
  human?: boolean;
}

/** Lead-Erfassung aus dem Widget (Eskalations-/Kontaktformular). */
export interface LeadRequest {
  sessionId: string;
  conversationId?: string;
  name?: string;
  email?: string;
  phone?: string;
  /** optionale Nachricht/Anliegen */
  message?: string;
  pageUrl?: string;
}

export interface LeadResponse {
  ok: boolean;
  leadId?: string;
}

export interface ApiError {
  error: string;
  message: string;
}
