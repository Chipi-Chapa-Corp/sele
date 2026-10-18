import type { Model, Provider } from '@opencode-ai/sdk/v2'
import type { ProviderModel, ProviderReasoningEffortOption } from '../../../shared/provider'

type OpenCodeModel = Model & {
  variants?: Record<string, unknown>
  request?: {
    variant?: string
  }
}

const formatContextWindow = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M context window.`
  }
  return `${Math.round(tokens / 1_000)}K context window.`
}

const getVariantDescription = (variant: string): string => {
  const normalized = variant.replace(/[_-]+/g, ' ')
  return `${normalized[0]?.toLocaleUpperCase() ?? ''}${normalized.slice(1)} model reasoning variant`
}

const getReasoningEfforts = (
  model: OpenCodeModel
): { options: ProviderReasoningEffortOption[]; defaultEffort: string } => {
  const variantIds = Object.keys(model.variants ?? {})
  const defaultEffort =
    model.request?.variant ?? (variantIds.includes('medium') ? 'medium' : variantIds[0]) ?? 'medium'

  return {
    options: variantIds.map((id) => ({
      id,
      label: id,
      description: getVariantDescription(id),
      isDefault: id === defaultEffort
    })),
    defaultEffort
  }
}

export const mapOpenCodeModels = (
  providers: Provider[],
  defaults: Record<string, string>,
  configuredModel?: string | null
): ProviderModel[] => {
  const fallbackDefaultId = providers
    .map((provider) => {
      const modelId = defaults[provider.id]
      return modelId ? `${provider.id}/${modelId}` : null
    })
    .find((id): id is string => Boolean(id))
  const defaultId = configuredModel?.trim() || fallbackDefaultId || null
  // Several providers can serve the same model, each with its own credential and billing,
  // so name the provider wherever a label alone would be ambiguous.
  const labelProviders = new Map<string, Set<string>>()
  for (const provider of providers)
    for (const model of Object.values(provider.models)) {
      const label = model.name || model.id
      labelProviders.set(label, (labelProviders.get(label) ?? new Set()).add(provider.id))
    }

  return providers.flatMap((provider) =>
    Object.values(provider.models).map((modelValue): ProviderModel => {
      const model = modelValue as OpenCodeModel
      const id = `${provider.id}/${model.id}`
      const reasoning = getReasoningEfforts(model)
      const status = model.status === 'deprecated' ? ' Deprecated.' : ''
      const name = model.name || model.id
      const providerName = provider.name || provider.id

      return {
        id,
        label: (labelProviders.get(name)?.size ?? 0) > 1 ? `${name} (${providerName})` : name,
        description:
          `${providerName} · ${formatContextWindow(model.limit.context)}${status}`.trim(),
        isDefault: id === defaultId,
        supportedReasoningEfforts: reasoning.options,
        defaultReasoningEffort: reasoning.defaultEffort
      }
    })
  )
}

export const parseOpenCodeModelId = (value: string): { providerID: string; modelID: string } => {
  const separatorIndex = value.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error('Choose an OpenCode model in provider/model format.')
  }

  return {
    providerID: value.slice(0, separatorIndex),
    modelID: value.slice(separatorIndex + 1)
  }
}
