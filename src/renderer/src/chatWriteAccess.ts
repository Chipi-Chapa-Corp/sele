import type { ProviderChatDetail } from '../../shared/provider'

export type ChatWriteAccessPresentation = {
  readOnly: boolean
  openedElsewhere: boolean
  legacyHistory: boolean
}

export const getChatWriteAccessPresentation = (
  detail: Pick<ProviderChatDetail, 'writeAccess' | 'writeAccessReason'> | null
): ChatWriteAccessPresentation => {
  const readOnly = detail?.writeAccess === 'readOnly'
  const legacyHistory = readOnly && detail?.writeAccessReason === 'legacyHistory'
  return {
    readOnly,
    legacyHistory,
    openedElsewhere: readOnly && !legacyHistory
  }
}
