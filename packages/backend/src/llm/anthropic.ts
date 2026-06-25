/**
 * Schmale Claude-Anbindung (Anthropic Messages API) AUSSCHLIESSLICH für interne
 * Management-Aufgaben wie die Generierung von Gesprächseinstiegen aus den eigenen
 * Kundenseiten. NIEMALS im End-Nutzer-Antwortpfad verwenden – der bleibt Mistral/EU.
 */
export interface AnthropicGenParams {
  apiKey: string;
  model: string;
  baseUrl?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AnthropicGenResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function anthropicGenerate(p: AnthropicGenParams): Promise<AnthropicGenResult> {
  if (!p.apiKey) throw new Error('ANTHROPIC_API_KEY fehlt.');
  const base = (p.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': p.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens ?? 200,
      temperature: p.temperature ?? 0.6,
      system: p.system,
      messages: [{ role: 'user', content: p.user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();
  return {
    text,
    usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
  };
}
