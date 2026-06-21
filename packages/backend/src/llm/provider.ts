/**
 * Anbieter-neutrale LLM-Schnittstelle. Mistral ist die erste Implementierung;
 * Gemini/Vertex-EU lässt sich später hinter exakt diesem Interface ergänzen,
 * ohne dass die Kaskade/Services etwas davon merken.
 */

export interface UsageStat {
  inputTokens: number;
  outputTokens: number;
}

export interface EmbedResult {
  embeddings: number[][];
  usage: UsageStat;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateResult {
  text: string;
  usage: UsageStat;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embedModel: string;
  embed(texts: string[]): Promise<EmbedResult>;
  generate(messages: ChatMessage[], opts?: GenerateOptions): Promise<GenerateResult>;
}

/**
 * Grobe Preis-Schätzung (EUR pro 1 Mio. Tokens). Dient nur der Kostenattribution
 * im Dashboard – exakte Abrechnung erfolgt beim Anbieter. Werte zur Laufzeit prüfbar.
 */
export interface ModelPrice {
  inPerMillion: number;
  outPerMillion: number;
}

export const PRICING: Record<string, ModelPrice> = {
  'mistral-small-latest': { inPerMillion: 0.2, outPerMillion: 0.6 },
  'ministral-8b-latest': { inPerMillion: 0.1, outPerMillion: 0.1 },
  'mistral-large-latest': { inPerMillion: 2.0, outPerMillion: 6.0 },
  'mistral-embed': { inPerMillion: 0.1, outPerMillion: 0 },
};

export function estimateCostEur(model: string, usage: UsageStat): number {
  const price = PRICING[model] ?? { inPerMillion: 0, outPerMillion: 0 };
  const cost =
    (usage.inputTokens / 1_000_000) * price.inPerMillion +
    (usage.outputTokens / 1_000_000) * price.outPerMillion;
  // auf 6 Nachkommastellen (passt zu numeric(12,6))
  return Math.round(cost * 1e6) / 1e6;
}
