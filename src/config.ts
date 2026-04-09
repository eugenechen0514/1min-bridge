export interface ModelInfo {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

const EPOCH = 1700000000

function models(ids: string[], owned_by: string): ModelInfo[] {
  return ids.map(id => ({ id, object: 'model' as const, created: EPOCH, owned_by }))
}

export const DEFAULT_MODELS: ModelInfo[] = [
  // OpenAI
  ...models([
    'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'gpt-5.2', 'gpt-5.2-pro',
    'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini',
    'gpt-5', 'gpt-5-chat-latest', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-4o', 'gpt-4o-mini',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4-turbo', 'gpt-3.5-turbo',
    'o4-mini', 'o3', 'o3-mini', 'o3-pro', 'o3-deep-research', 'o4-mini-deep-research',
  ], 'openai'),

  // Anthropic
  ...models([
    'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-opus-4-20250514', 'claude-opus-4-1-20250805',
    'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
  ], 'anthropic'),

  // Google
  ...models([
    'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview',
    'gemini-2.5-pro', 'gemini-2.5-flash',
  ], 'google'),

  // Alibaba
  ...models([
    'qwen3-vl-plus', 'qwen3-vl-flash', 'qwen3-max',
    'qwen-vl-plus', 'qwen-vl-max', 'qwen-plus', 'qwen-max', 'qwen-flash',
  ], 'alibaba'),

  // DeepSeek
  ...models([
    'deepseek-reasoner', 'deepseek-chat',
  ], 'deepseek'),

  // Mistral
  ...models([
    'magistral-small-latest', 'magistral-medium-latest', 'ministral-14b-latest',
    'open-mistral-nemo', 'mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest',
  ], 'mistral'),

  // xAI
  ...models([
    'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4-0709',
    'grok-3-mini', 'grok-3',
  ], 'xai'),

  // Perplexity
  ...models([
    'sonar-reasoning-pro', 'sonar-pro', 'sonar-deep-research', 'sonar',
  ], 'perplexity'),

  // Cohere
  ...models([
    'command-r-08-2024',
  ], 'cohere'),

  // Meta
  ...models([
    'meta/meta-llama-3.1-405b-instruct', 'meta/meta-llama-3-70b-instruct',
    'meta/llama-4-scout-instruct', 'meta/llama-4-maverick-instruct',
    'meta/llama-2-70b-chat',
  ], 'meta'),

  // OpenAI OSS
  ...models([
    'openai/gpt-oss-20b', 'openai/gpt-oss-120b',
  ], 'openai'),
]

export function resolveModelName(model: string, mapping: Record<string, string>): string {
  return mapping[model] ?? model
}

export function getModelList(mapping: Record<string, string>): ModelInfo[] {
  const seen = new Map<string, ModelInfo>()

  for (const m of DEFAULT_MODELS) {
    seen.set(m.id, m)
  }

  for (const alias of Object.keys(mapping)) {
    seen.set(alias, { id: alias, object: 'model', created: EPOCH, owned_by: 'custom' })
  }

  return Array.from(seen.values())
}

export function getApiKey(headerKey?: string, envKey?: string): string | undefined {
  return envKey ?? headerKey
}

export const config = {
  port: Number(process.env.PORT || 11434),
  apiKey: process.env.API_KEY,
  modelMapping: JSON.parse(process.env.MODEL_MAPPING || '{}') as Record<string, string>,
}
