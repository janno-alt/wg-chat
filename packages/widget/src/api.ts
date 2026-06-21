import type {
  WidgetConfig,
  ChatRequest,
  ChatResponse,
  LeadRequest,
  LeadResponse,
} from '@kine-chat/shared';

export interface WidgetApi {
  getConfig(): Promise<WidgetConfig>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  lead(req: LeadRequest): Promise<LeadResponse>;
}

export function createApi(base: string, siteKey: string): WidgetApi {
  const root = base.replace(/\/$/, '');
  return {
    async getConfig() {
      const r = await fetch(`${root}/api/config/${encodeURIComponent(siteKey)}`);
      if (!r.ok) throw new Error(`config ${r.status}`);
      return (await r.json()) as WidgetConfig;
    },
    async chat(req) {
      const r = await fetch(`${root}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-site-key': siteKey },
        body: JSON.stringify(req),
      });
      if (!r.ok) throw new Error(`chat ${r.status}`);
      return (await r.json()) as ChatResponse;
    },
    async lead(req) {
      const r = await fetch(`${root}/api/lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-site-key': siteKey },
        body: JSON.stringify(req),
      });
      if (!r.ok) throw new Error(`lead ${r.status}`);
      return (await r.json()) as LeadResponse;
    },
  };
}
