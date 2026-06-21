export interface Tenant {
  id: string;
  name: string;
  siteKey: string;
  plan: string;
  monthlyBudgetEur: string | null;
  allowedDomains: string[];
  active: boolean;
  createdAt: string;
}

export interface KbDoc {
  id: string;
  sourceType: string;
  sourceUrl: string | null;
  title: string | null;
  status: string;
  createdAt: string;
}

export interface UsageRow {
  model: string;
  purpose: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  eur: number;
}

export interface Usage {
  tenant: string;
  budgetEur: number | null;
  monthEur: number;
  byModel: UsageRow[];
}

export interface Gap {
  id: string;
  question: string;
  frequency: number;
  status: string;
  suggestedAnswer: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  payload: Record<string, unknown>;
  pushedToCrm: boolean;
  conversationId: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  sessionId: string;
  pageUrl: string | null;
  status: string;
  leadCaptured: boolean;
  handedOff: boolean;
  createdAt: string;
}

export interface TranscriptMessage {
  role: string;
  content: string;
  answerSource: string | null;
  createdAt: string;
}

export interface Transcript {
  conversation: Conversation;
  messages: TranscriptMessage[];
}

export interface TenantSettings {
  locale: string;
  greeting: string;
  theme: Record<string, unknown>;
  starterButtons: unknown[];
  fallbackText: string;
  thresholds: Record<string, number>;
  notifyEmail: string | null;
  leadWebhookUrl: string | null;
}

export interface SettingsResponse {
  tenant: {
    name: string;
    siteKey: string;
    allowedDomains: string[];
    monthlyBudgetEur: number | null;
    active: boolean;
  };
  settings: TenantSettings;
}
