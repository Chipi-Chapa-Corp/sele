import type { ProviderChatDetail, ProviderWorkingStep } from '../../shared/provider'

export type ChatCommitMarkerStatus = 'pending' | 'finished' | 'stopped' | 'interrupted' | 'failed'

type ChatCommitTerminalDetail = Pick<ProviderChatDetail, 'status' | 'items'>

export const getChatCommitMarkerTerminalStatus = (
  detail: ChatCommitTerminalDetail
): Exclude<ChatCommitMarkerStatus, 'pending'> => {
  if (detail.status === 'error') return 'failed'

  const lastWorkingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working'
  )
  if (lastWorkingStep?.status === 'failed') return 'failed'
  return lastWorkingStep?.status === 'stopped' ? 'stopped' : 'finished'
}
