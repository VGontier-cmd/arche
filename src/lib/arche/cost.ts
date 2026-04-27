/**
 * Cost calculation helpers using OpenRouter model pricing.
 *
 * Pricing values from `client.models.list()` are USD per token, expressed as
 * decimal strings (e.g. "0.0000003"). We multiply by usage counts to compute
 * the dollar amount for a single inference call.
 */
import type { OpenRouterModel } from "./openrouter-proxy";
import type { ProviderUsage } from "./provider";

export type CostBreakdown = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  inputCostUsd: number;
  cachedCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  /** True when no pricing was found for the model — totals are 0. */
  pricingMissing: boolean;
};

const ZERO_BREAKDOWN: CostBreakdown = {
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  inputCostUsd: 0,
  cachedCostUsd: 0,
  outputCostUsd: 0,
  totalCostUsd: 0,
  pricingMissing: true,
};

function parsePrice(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Compute the USD cost of a single inference call from its token usage and
 * the model's published prompt/completion pricing.
 *
 * Cached tokens are treated as discounted prompt tokens (10% of the prompt
 * price) — this matches OpenRouter's documented Anthropic cache pricing for
 * read hits and is a conservative estimate for other providers.
 */
export function computeCostFromUsage(
  usage: ProviderUsage,
  modelId: string,
  models: OpenRouterModel[],
): CostBreakdown {
  const model = models.find((m) => m.id === modelId);
  if (!model) {
    return {
      ...ZERO_BREAKDOWN,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens ?? 0,
    };
  }

  const promptPrice = parsePrice(model.pricing.prompt);
  const completionPrice = parsePrice(model.pricing.completion);

  const cachedTokens = usage.cachedTokens ?? 0;
  const billedPromptTokens = Math.max(0, usage.promptTokens - cachedTokens);

  const inputCostUsd = billedPromptTokens * promptPrice;
  const cachedCostUsd = cachedTokens * promptPrice * 0.1;
  const outputCostUsd = usage.completionTokens * completionPrice;

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cachedTokens,
    inputCostUsd,
    cachedCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + cachedCostUsd + outputCostUsd,
    pricingMissing: promptPrice === 0 && completionPrice === 0,
  };
}

export function addBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    inputCostUsd: a.inputCostUsd + b.inputCostUsd,
    cachedCostUsd: a.cachedCostUsd + b.cachedCostUsd,
    outputCostUsd: a.outputCostUsd + b.outputCostUsd,
    totalCostUsd: a.totalCostUsd + b.totalCostUsd,
    pricingMissing: a.pricingMissing && b.pricingMissing,
  };
}

export const EMPTY_COST_BREAKDOWN: CostBreakdown = { ...ZERO_BREAKDOWN, pricingMissing: false };
