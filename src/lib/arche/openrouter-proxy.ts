/**
 * Proxy helpers for OpenRouter meta-APIs (models, credits).
 * All responses are cached to avoid hammering the API.
 */
import { OpenRouter } from "@openrouter/sdk";

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

  const client = new OpenRouter({ apiKey });
  const response = await client.models.list(undefined, { timeoutMs: 8000 });
  const models: OpenRouterModel[] = response.data.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description ?? "",
    context_length: m.contextLength ?? 0,
    pricing: {
      prompt: m.pricing.prompt,
      completion: m.pricing.completion,
    },
    supported_parameters: m.supportedParameters as string[],
    architecture: {
      modality: m.architecture.modality,
      tokenizer: m.architecture.tokenizer ?? "",
      input_modalities: m.architecture.inputModalities as string[],
      output_modalities: m.architecture.outputModalities as string[],
    },
  }));

  cachedModels = { value: models, expiresAt: now + 5 * 60_000 };
  return models;
}
