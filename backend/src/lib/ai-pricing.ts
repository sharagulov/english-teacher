import { env } from '../env.js';

/** Тариф OpenAI: USD за 1 млн токенов (input / output). */
const MODEL_PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4.1': { input: 2, output: 8 },
};

const DEFAULT_RATES = MODEL_PRICING_USD_PER_M['gpt-4o-mini']!;

/** Оценка стоимости запроса по известным тарифам модели. */
export function estimateAiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_PRICING_USD_PER_M[model] ?? DEFAULT_RATES;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export function aiPricingForModel(model: string) {
  const rates = MODEL_PRICING_USD_PER_M[model] ?? DEFAULT_RATES;
  return {
    model,
    inputUsdPerM: rates.input,
    outputUsdPerM: rates.output,
    usdRubRate: env.AI_USD_RUB_RATE,
  };
}
