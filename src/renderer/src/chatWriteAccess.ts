import type { ProviderChatDetail } from '../../shared/provider'

export type ChatWriteAccessPresentation = {
  readOnly: boolean
  openedElsewhere: boolean
  legacyHistory: boolean
}

export const getChatWriteAccessPresentation = (
  detail: Pick<ProviderChatDetail, 'writeAccess' | 'writeAccessReason'> | null
): ChatWriteAccessPresentation => {
  const readOnly = detail?.writeAccess === 'readOnly' || detail?.writeAccess === 'checking'
  const legacyHistory = readOnly && detail?.writeAccessReason === 'legacyHistory'
  return {
    readOnly,
    legacyHistory,
    openedElsewhere: detail?.writeAccess === 'readOnly' && !legacyHistory
  }
}
