import type {
  ChatMessage,
  EmbedResult,
  GenerateOptions,
  GenerateResult,
  LlmProvider,
} from './provider.js';

export interface MistralOptions {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
}

/**
 * Fetch-basierte Mistral-Anbindung (kein SDK-Lock-in). EU-Verarbeitung
 * (La Plateforme, Frankreich). Generierung + Embeddings aus einer Hand.
 */
export class MistralProvider implements LlmProvider {
  readonly name = 'mistral';
  readonly chatModel: string;
  readonly embedModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: MistralOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.chatModel = opts.chatModel;
    this.embedModel = opts.embedModel;
  }

  private async post(path: string, body: unknown): Promise<any> {
    if (!this.apiKey) {
      throw new Error('MISTRAL_API_KEY fehlt – LLM-Aufruf nicht möglich.');
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Mistral ${path} ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const json = await this.post('/v1/embeddings', {
      model: this.embedModel,
      input: texts,
    });
    const embeddings: number[][] = (json.data ?? []).map((d: any) => d.embedding);
    return {
      embeddings,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0,
        outputTokens: 0,
      },
    };
  }

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const json = await this.post('/v1/chat/completions', {
      model: this.chatModel,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 512,
    });
    const text: string = json.choices?.[0]?.message?.content ?? '';
    return {
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}
