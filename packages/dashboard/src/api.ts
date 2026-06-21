import type {
  Chunk,
  CrawlSummary,
  Gap,
  KbDoc,
  Lead,
  SearchResult,
  SettingsResponse,
  Tenant,
  Transcript,
  Conversation,
  Usage,
} from './types.js';

export interface AuthUser {
  email: string;
  role: string;
}

export interface Api {
  // Auth (Session-Cookie, kein Key im Link)
  login(email: string, password: string): Promise<{ user: AuthUser }>;
  logout(): Promise<void>;
  me(): Promise<AuthUser | null>;

  listTenants(): Promise<Tenant[]>;
  createTenant(body: {
    name: string;
    siteKey?: string;
    allowedDomains?: string[];
    monthlyBudgetEur?: number | null;
  }): Promise<{ id: string; siteKey: string }>;
  patchTenant(siteKey: string, patch: Record<string, unknown>): Promise<void>;

  listKb(siteKey: string): Promise<KbDoc[]>;
  listChunks(siteKey: string, docId: string): Promise<Chunk[]>;
  searchKb(siteKey: string, query: string): Promise<SearchResult>;
  addManual(siteKey: string, body: Record<string, unknown>): Promise<unknown>;
  ingestUrl(siteKey: string, url: string): Promise<unknown>;
  crawl(siteKey: string, startUrl: string, maxPages: number): Promise<CrawlSummary>;
  reindex(siteKey: string, docId: string): Promise<unknown>;
  publish(siteKey: string, docId: string): Promise<unknown>;
  faqgen(siteKey: string, docId: string, count: number): Promise<unknown>;
  deleteDoc(siteKey: string, docId: string): Promise<void>;

  usage(siteKey: string): Promise<Usage>;
  gaps(siteKey: string): Promise<Gap[]>;
  suggestGap(siteKey: string, gapId: string): Promise<{ answer: string; sources: (string | null)[] }>;
  leads(siteKey: string): Promise<Lead[]>;
  conversations(siteKey: string): Promise<Conversation[]>;
  transcript(siteKey: string, id: string): Promise<Transcript>;

  getSettings(siteKey: string): Promise<SettingsResponse>;
  putSettings(siteKey: string, patch: Record<string, unknown>): Promise<void>;

  agentSocketUrl(siteKey: string): string;
}

/** baseUrl leer = gleiche Origin (Dashboard wird vom Backend ausgeliefert). */
export function createApi(baseUrl = ''): Api {
  const root = baseUrl.replace(/\/$/, '');

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${root}${path}`, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json?.message || `${res.status} ${res.statusText}`);
    return json as T;
  }
  const admin = <T>(m: string, p: string, b?: unknown) => req<T>(m, `/api/admin${p}`, b);

  return {
    login: (email, password) => req('POST', '/api/auth/login', { email, password }),
    async logout() {
      await req('POST', '/api/auth/logout');
    },
    async me() {
      try {
        const res = await fetch(`${root}/api/auth/me`, { credentials: 'include' });
        if (!res.ok) return null;
        return (await res.json()).user as AuthUser;
      } catch {
        return null;
      }
    },

    async listTenants() {
      return (await admin<{ tenants: Tenant[] }>('GET', '/tenants')).tenants;
    },
    createTenant: (body) => admin('POST', '/tenants', body),
    async patchTenant(siteKey, patch) {
      await admin('PATCH', `/tenants/${encodeURIComponent(siteKey)}`, patch);
    },

    async listKb(siteKey) {
      return (await admin<{ documents: KbDoc[] }>('GET', `/${siteKey}/kb`)).documents;
    },
    async listChunks(siteKey, docId) {
      return (await admin<{ chunks: Chunk[] }>('GET', `/${siteKey}/kb/${docId}/chunks`)).chunks;
    },
    searchKb(siteKey, query) {
      return admin('POST', `/${siteKey}/kb/search`, { query });
    },
    addManual: (siteKey, body) => admin('POST', `/${siteKey}/kb/manual`, body),
    ingestUrl: (siteKey, url) => admin('POST', `/${siteKey}/kb/url`, { url }),
    crawl: (siteKey, startUrl, maxPages) => admin<CrawlSummary>('POST', `/${siteKey}/kb/crawl`, { startUrl, maxPages }),
    reindex: (siteKey, docId) => admin('POST', `/${siteKey}/kb/${docId}/reindex`),
    publish: (siteKey, docId) => admin('POST', `/${siteKey}/kb/${docId}/publish`),
    faqgen: (siteKey, docId, count) => admin('POST', `/${siteKey}/kb/${docId}/faqgen`, { count }),
    async deleteDoc(siteKey, docId) {
      await admin('DELETE', `/${siteKey}/kb/${docId}`);
    },

    usage: (siteKey) => admin('GET', `/${siteKey}/usage`),
    async gaps(siteKey) {
      return (await admin<{ gaps: Gap[] }>('GET', `/${siteKey}/gaps`)).gaps;
    },
    suggestGap: (siteKey, gapId) => admin('POST', `/${siteKey}/gaps/${gapId}/suggest`),
    async leads(siteKey) {
      return (await admin<{ leads: Lead[] }>('GET', `/${siteKey}/leads`)).leads;
    },
    async conversations(siteKey) {
      return (await admin<{ conversations: Conversation[] }>('GET', `/${siteKey}/conversations`)).conversations;
    },
    transcript: (siteKey, id) => admin('GET', `/${siteKey}/conversations/${id}`),

    getSettings: (siteKey) => admin('GET', `/${siteKey}/settings`),
    async putSettings(siteKey, patch) {
      await admin('PUT', `/${siteKey}/settings`, patch);
    },

    agentSocketUrl(siteKey) {
      const origin = root || window.location.origin;
      const wsBase = origin.replace(/^http/i, 'ws');
      return `${wsBase}/ws/agent?siteKey=${encodeURIComponent(siteKey)}`;
    },
  };
}
