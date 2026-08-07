import type { ProviderChatDetail, ProviderWorkingStep } from '../../shared/provider'

const unloadWorkingStep = (step: ProviderWorkingStep): ProviderWorkingStep => ({
  ...step,
  items: [],
  itemsLoaded: false,
  itemCount: step.itemsLoaded === false ? step.itemCount : step.items.length
})

export const unloadHistoricalWorkingSteps = (detail: ProviderChatDetail): ProviderChatDetail => {
  const latestWorkingStepIndex = detail.items.findLastIndex((item) => item.type === 'working')
  if (latestWorkingStepIndex <= 0) return detail

  let changed = false
  const items = detail.items.map((item, index) => {
    if (item.type !== 'working' || index === latestWorkingStepIndex || item.itemsLoaded === false) {
      return item
    }

    changed = true
    return unloadWorkingStep(item)
  })

  return changed ? { ...detail, items } : detail
}
