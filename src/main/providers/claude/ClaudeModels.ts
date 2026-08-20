import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderModel, ProviderReasoningEffort } from '../../../shared/provider'

const allowedEffortLevels = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const claudeModelFamilies = new Set(['sonnet', 'opus', 'haiku', 'fable'])

const splitDescription = (description: string): { modelName: string | null; detail: string } => {
  const [modelName, ...details] = description.split(/\s+·\s+/)
  if (details.length === 0) return { modelName: null, detail: description }
  return { modelName: modelName?.trim() || null, detail: details.join(' · ').trim() }
}

const normalizeDescribedModelName = (modelName: string): string => {
  const defaultModelMatch = /^Use the default model \(currently (.+)\)$/i.exec(modelName)
  return defaultModelMatch?.[1]?.trim() || modelName
}

const stripClaudePrefix = (modelName: string): string => modelName.replace(/^Claude\s+/i, '')

const getCanonicalModelName = (model: ModelInfo): string => {
  const describedName = splitDescription(model.description).modelName
  if (describedName) return stripClaudePrefix(normalizeDescribedModelName(describedName))

  const resolved = model.resolvedModel?.match(
    /^claude-(sonnet|opus|haiku|fable)-(\d+)(?:-(\d+))?(?=-|\[|$)/i
  )
  if (resolved) {
    const family = resolved[1]!
    const version = [resolved[2], resolved[3]].filter(Boolean).join('.')
    return `${family.charAt(0).toLocaleUpperCase()}${family.slice(1)} ${version}`
  }

  return stripClaudePrefix(model.displayName)
}

const getClaudeModelUsageScope = (model: ModelInfo): string | undefined => {
  const resolvedFamily = /^claude-([a-z0-9]+)(?:-|$)/i.exec(model.resolvedModel ?? '')?.[1]
  if (resolvedFamily && claudeModelFamilies.has(resolvedFamily.toLocaleLowerCase())) {
    return resolvedFamily.toLocaleLowerCase()
  }

  const describedFamily = splitDescription(model.description)
    .modelName?.split(/\s+/)[0]
    ?.toLocaleLowerCase()
  if (describedFamily && claudeModelFamilies.has(describedFamily)) return describedFamily

  const alias = model.value.toLocaleLowerCase()
  return claudeModelFamilies.has(alias) ? alias : undefined
}

export const mapClaudeModel = (model: ModelInfo, index: number): ProviderModel => {
  const efforts = (model.supportedEffortLevels ?? []).filter((effort) =>
    allowedEffortLevels.has(effort)
  ) as ProviderReasoningEffort[]
  const defaultEffort = efforts.includes('high') ? 'high' : (efforts[0] ?? 'medium')
  const canonicalName = getCanonicalModelName(model)
  const description = splitDescription(model.description).detail
  const isDefault = model.value === 'default' || index === 0

  return {
    id: model.value,
    label: canonicalName,
    usageScope: getClaudeModelUsageScope(model),
    description:
      model.value === 'default'
        ? [`Uses Claude Code's recommended model`, description].filter(Boolean).join(' · ')
        : description,
    isDefault,
    supportedReasoningEfforts: efforts.map((effort) => ({
      id: effort,
      label: effort,
      description: `${effort.charAt(0).toLocaleUpperCase()}${effort.slice(1)} reasoning effort`,
      isDefault: effort === defaultEffort
    })),
    defaultReasoningEffort: defaultEffort,
    supportedServiceTiers: model.supportsFastMode
      ? [
          {
            id: 'fast',
            label: 'Fast',
            description: 'Use Claude fast mode for lower-latency responses.',
            isDefault: false
          }
        ]
      : undefined,
    defaultServiceTier: null
  }
}

export const mapClaudeModels = (models: ModelInfo[]): ProviderModel[] => {
  const defaultModel = models.find((model) => model.value === 'default')
  const defaultResolvedModel = defaultModel?.resolvedModel?.trim()

  return models
    .filter(
      (model) =>
        model.value === 'default' ||
        !defaultResolvedModel ||
        model.resolvedModel?.trim() !== defaultResolvedModel
    )
    .map(mapClaudeModel)
}
