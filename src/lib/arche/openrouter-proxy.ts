/**
 * Proxy helpers for OpenRouter meta-APIs (models, credits).
 * All responses are cached to avoid hammering the API.
 */

export type OpenRouterModel = {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  supported_parameters: string[];
  architecture: {
    modality: string | null;
    tokenizer: string;
    input_modalities: string[];
    output_modalities: string[];
  };
};

let cachedModels: { value: OpenRouterModel[]; expiresAt: number } | null = null;

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (cachedModels && now < cachedModels.expiresAt) {
    return cachedModels.value;
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter models API returned ${res.status}`);
  }

  const json = await res.json() as { data?: OpenRouterModel[] };
  const models = json.data ?? [];

  cachedModels = { value: models, expiresAt: now + 5 * 60_000 };
  return models;
}
