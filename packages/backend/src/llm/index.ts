import { getConfig } from '../config.js';
import type { LlmProvider } from './provider.js';
import { MistralProvider } from './mistral.js';

export * from './provider.js';

/** Pro-Tenant-Overrides aus tenants.llm_provider_cfg (JSON). Alle optional. */
export interface TenantLlmCfg {
  provider?: 'mistral';
  apiKey?: string;
  chatModel?: string;
  embedModel?: string;
  baseUrl?: string;
}

/**
 * Hat dieser Tenant (bzw. die globale Config) einen nutzbaren API-Key?
 * Steuert, ob Embeddings/Generierung möglich sind oder die Pipeline degradiert.
 */
export function hasEmbeddings(cfg: TenantLlmCfg = {}): boolean {
  const env = getConfig();
  const key = cfg.apiKey ?? env.MISTRAL_API_KEY;
  return Boolean(key && key.length > 0);
}

/**
 * Baut den passenden Provider für einen Tenant: Tenant-Overrides haben Vorrang
 * vor den globalen ENV-Defaults. So kann ein Kunde z.B. ein anderes Modell oder
 * (später) einen anderen EU-Anbieter nutzen, ohne Code-Änderung.
 */
export function getProviderForTenant(cfg: TenantLlmCfg = {}): LlmProvider {
  const env = getConfig();
  const provider = cfg.provider ?? env.LLM_PROVIDER;

  switch (provider) {
    case 'mistral':
    default:
      return new MistralProvider({
        apiKey: cfg.apiKey ?? env.MISTRAL_API_KEY,
        baseUrl: cfg.baseUrl ?? env.MISTRAL_BASE_URL,
        chatModel: cfg.chatModel ?? env.MISTRAL_CHAT_MODEL,
        embedModel: cfg.embedModel ?? env.MISTRAL_EMBED_MODEL,
      });
  }
}
