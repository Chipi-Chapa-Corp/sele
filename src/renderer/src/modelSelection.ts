import type { ProviderModel, ProviderModelId, ProviderReasoningEffort } from '../../shared/provider'

type ModelCatalogState = {
  activeKey: string
  displayedKey: string | null
  loading: boolean
}

type ModelSelection = {
  model: ProviderModelId
  manuallySelected: boolean
}

type ReasoningSelection = {
  reasoningEffort: ProviderReasoningEffort
  manuallySelected: boolean
}

const isActiveModelCatalogReady = (catalog: ModelCatalogState): boolean =>
  !catalog.loading && catalog.displayedKey === catalog.activeKey

const getDefaultModel = (models: ProviderModel[]): ProviderModel | undefined =>
  models.find((model) => model.isDefault) ?? models[0]

const getDefaultReasoningEffort = (model: ProviderModel): ProviderReasoningEffort =>
  model.defaultReasoningEffort ||
  model.supportedReasoningEfforts.find((option) => option.isDefault)?.id ||
  model.supportedReasoningEfforts[0]?.id ||
  'medium'

export const reconcileModelSelection = (
  models: ProviderModel[],
  selection: ModelSelection,
  fallbackInitialModelId: ProviderModelId,
  catalog: ModelCatalogState
): ModelSelection => {
  if (!isActiveModelCatalogReady(catalog)) return selection

  const defaultModel = getDefaultModel(models)
  if (!defaultModel) return selection

  if (!models.some((model) => model.id === selection.model)) {
    return { model: defaultModel.id, manuallySelected: false }
  }
  if (!selection.manuallySelected && selection.model === fallbackInitialModelId) {
    return { model: defaultModel.id, manuallySelected: false }
  }

  return selection
}

export const reconcileReasoningSelection = (
  model: ProviderModel | undefined,
  selection: ReasoningSelection,
  catalog: ModelCatalogState
): ReasoningSelection => {
  if (!isActiveModelCatalogReady(catalog) || !model) return selection

  const defaultReasoningEffort = getDefaultReasoningEffort(model)
  if (
    model.supportedReasoningEfforts.length === 0 ||
    !selection.manuallySelected ||
    !model.supportedReasoningEfforts.some((option) => option.id === selection.reasoningEffort)
  ) {
    return { reasoningEffort: defaultReasoningEffort, manuallySelected: false }
  }

  return selection
}
