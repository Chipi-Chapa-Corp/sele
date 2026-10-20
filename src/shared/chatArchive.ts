import type { ProviderChatDetail, ProviderId, ProviderSubagentDetail } from './provider'

/** Portable, versioned transcript. Native credentials and live approval requests are never replayed. */
export type SeleChatArchive = {
  format: 'sele-chat'
  version: 1
  exportedAt: number
  providerId: ProviderId
  chat: ProviderChatDetail
  subagents: ProviderSubagentDetail[]
  assets: Array<{ path: string; data: string }>
}

export type ChatImportPreview = {
  id: string
  title: string
  turnCount: number
  providerId: ProviderId
}
