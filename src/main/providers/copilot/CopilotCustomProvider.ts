import type { ProviderConfig } from '@github/copilot-sdk'
import type { ProviderModel } from '../../../shared/provider'

/**
 * Copilot CLI reads its bring-your-own-key provider from `COPILOT_PROVIDER_*`, but SDK
 * sessions ignore that environment and need the provider passed explicitly.
 */
export const getCopilotCustomProvider = (
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | undefined => {
  const baseUrl = env.COPILOT_PROVIDER_BASE_URL?.trim()
  if (!baseUrl) return undefined
  const type = env.COPILOT_PROVIDER_TYPE?.trim()
  const wireApi = env.COPILOT_PROVIDER_WIRE_API?.trim()
  const transport = env.COPILOT_PROVIDER_TRANSPORT?.trim()
  return {
    baseUrl,
    ...(type === 'openai' || type === 'azure' || type === 'anthropic' ? { type } : {}),
    ...(wireApi === 'completions' || wireApi === 'responses' ? { wireApi } : {}),
    ...(transport === 'http' || transport === 'websockets' ? { transport } : {}),
    ...(env.COPILOT_PROVIDER_API_KEY ? { apiKey: env.COPILOT_PROVIDER_API_KEY } : {}),
    ...(env.COPILOT_PROVIDER_BEARER_TOKEN ? { bearerToken: env.COPILOT_PROVIDER_BEARER_TOKEN } : {})
  }
}

/** The custom provider serves one configured model, named like the CLI names it. */
export const getCopilotCustomProviderModel = (
  env: NodeJS.ProcessEnv = process.env
): string | undefined =>
  env.COPILOT_PROVIDER_WIRE_MODEL?.trim() ||
  env.COPILOT_MODEL?.trim() ||
  env.COPILOT_PROVIDER_MODEL_ID?.trim() ||
  undefined

export const getCopilotCustomProviderModels = (
  env: NodeJS.ProcessEnv = process.env
): ProviderModel[] => {
  const model = getCopilotCustomProviderModel(env)
  if (!getCopilotCustomProvider(env) || !model) return []
  return [
    {
      id: model,
      label: model,
      description: 'Custom provider model.',
      isDefault: true,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: 'medium'
    }
  ]
}

/** Session options that route a Copilot session to the custom provider, when configured. */
export const getCopilotCustomProviderSessionOptions = (
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { provider?: ProviderConfig; model?: string } => {
  const provider = getCopilotCustomProvider(env)
  if (!provider) return { model }
  return { provider, model: model && model !== 'auto' ? model : getCopilotCustomProviderModel(env) }
}
