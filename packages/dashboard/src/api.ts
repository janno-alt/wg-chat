import type {
  Gap,
  KbDoc,
  Lead,
  SettingsResponse,
  Tenant,
  Transcript,
  Conversation,
  Usage,
} from './types.js';

export interface Api {
  baseUrl: string;
  listTenants(): Promise<Tenant[]>;
  createTenant(body: {
    name: string;
    siteKey?: string;
    allowedDomains?: string[];
    monthlyBudgetEur?: number | null;
  }): Promise<{ id: string; siteKey: string }>;
  patchTenant(siteKey: string, patch: Record<string, unknown>): Promise<void>;

  listKb(siteKey: string): Promise<KbDoc[]>;
  addManual(siteKey: string, body: Record<string, unknown>): Promise<unknown>;
  ingestUrl(siteKey: string, url: string): Promise<unknown>;
  crawl(siteKey: string, startUrl: string, maxPages: number): Promise<unknown>;
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

  /** WebSocket-URL für die Agenten-Inbox (inkl. Admin-Key). */
  agentSocketUrl(siteKey: string): string;
}

export function createApi(baseUrl: string, adminKey: string): Api {
  const root = baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${root}/api/admin${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(json?.message || `${res.status} ${res.statusText}`);
    }
    return json as T;
  }

  return {
    baseUrl: root,
    async listTenants() {
      return (await request<{ tenants: Tenant[] }>('GET', '/tenants')).tenants;
    },
    createTenant(body) {
      return request('POST', '/tenants', body);
    },
    async patchTenant(siteKey, patch) {
      await request('PATCH', `/tenants/${encodeURIComponent(siteKey)}`, patch);
    },

    async listKb(siteKey) {
      return (await request<{ documents: KbDoc[] }>('GET', `/${siteKey}/kb`)).documents;
    },
    addManual(siteKey, body) {
      return request('POST', `/${siteKey}/kb/manual`, body);
    },
    ingestUrl(siteKey, url) {
      return request('POST', `/${siteKey}/kb/url`, { url });
    },
    crawl(siteKey, startUrl, maxPages) {
      return request('POST', `/${siteKey}/kb/crawl`, { startUrl, maxPages });
    },
    reindex(siteKey, docId) {
      return request('POST', `/${siteKey}/kb/${docId}/reindex`);
    },
    publish(siteKey, docId) {
      return request('POST', `/${siteKey}/kb/${docId}/publish`);
    },
    faqgen(siteKey, docId, count) {
      return request('POST', `/${siteKey}/kb/${docId}/faqgen`, { count });
    },
    async deleteDoc(siteKey, docId) {
      await request('DELETE', `/${siteKey}/kb/${docId}`);
    },

    usage(siteKey) {
      return request('GET', `/${siteKey}/usage`);
    },
    async gaps(siteKey) {
      return (await request<{ gaps: Gap[] }>('GET', `/${siteKey}/gaps`)).gaps;
    },
    suggestGap(siteKey, gapId) {
      return request('POST', `/${siteKey}/gaps/${gapId}/suggest`);
    },
    async leads(siteKey) {
      return (await request<{ leads: Lead[] }>('GET', `/${siteKey}/leads`)).leads;
    },
    async conversations(siteKey) {
      return (await request<{ conversations: Conversation[] }>('GET', `/${siteKey}/conversations`))
        .conversations;
    },
    transcript(siteKey, id) {
      return request('GET', `/${siteKey}/conversations/${id}`);
    },

    getSettings(siteKey) {
      return request('GET', `/${siteKey}/settings`);
    },
    async putSettings(siteKey, patch) {
      await request('PUT', `/${siteKey}/settings`, patch);
    },
    agentSocketUrl(siteKey) {
      const wsBase = root.replace(/^http/i, 'ws');
      return `${wsBase}/ws/agent?siteKey=${encodeURIComponent(siteKey)}&key=${encodeURIComponent(adminKey)}`;
    },
  };
}
