import type { ProviderChatDetail, ProviderWorkingStep } from '../../shared/provider'

export type ChatCommitMarkerStatus = 'pending' | 'finished' | 'stopped' | 'failed'

type ChatCommitTerminalDetail = Pick<ProviderChatDetail, 'status' | 'items'>

export const getChatCommitMarkerTerminalStatus = (
  detail: ChatCommitTerminalDetail
): Exclude<ChatCommitMarkerStatus, 'pending'> => {
  if (detail.status === 'error') return 'failed'

  const lastWorkingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working'
  )
  return lastWorkingStep?.status === 'stopped' ? 'stopped' : 'finished'
}

export const getRecoveredChatCommitMarkerTerminalStatus = (
  detail: ChatCommitTerminalDetail
): Exclude<ChatCommitMarkerStatus, 'pending'> => {
  const status = getChatCommitMarkerTerminalStatus(detail)

  // A provider process interrupted by app shutdown is indistinguishable from an explicit stop in
  // restored chat history. Only the live cancel path can reliably assign the stopped marker state.
  return status === 'stopped' ? 'failed' : status
}
