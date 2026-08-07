import type { ProviderChatDetail } from '../../shared/provider'
import { getProviderChatTurns, unloadChatItemsOutsideTurnRange } from '../../shared/chatTurns'
import { unloadHistoricalWorkingSteps } from './workingStepLazy'

export const rendererChatTurnPageSize = 10

export const prepareChatDetailForRenderer = (detail: ProviderChatDetail): ProviderChatDetail => {
  const workingStepsUnloaded = unloadHistoricalWorkingSteps(detail)
  const turnCount = getProviderChatTurns(workingStepsUnloaded.items).length
  const items = unloadChatItemsOutsideTurnRange(
    workingStepsUnloaded.items,
    Math.max(0, turnCount - rendererChatTurnPageSize),
    turnCount
  )

  return items === workingStepsUnloaded.items
    ? workingStepsUnloaded
    : { ...workingStepsUnloaded, items }
}
