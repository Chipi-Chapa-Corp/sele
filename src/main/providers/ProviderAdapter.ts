import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult,
  ProviderApprovalDecision,
  ProviderUpdateAvailability,
  ProviderApprovalModeOption,
  ProviderSandboxModeOption,
  ProviderApp,
  ProviderSkill,
  ProviderModel,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderUsageOptions,
  ProviderActiveSendMode,
  ProviderTurnOptions,
  ProviderOneShotOptions,
  ProviderAgentTerminalDataEvent
} from '../../shared/provider'

export type ProviderChatUpdateMetadata = {
  turnCompleted?: boolean
}

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getUpdateAvailability: () => Promise<ProviderUpdateAvailability | null>
  updateProvider: () => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: () => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: () => Promise<ProviderSandboxModeOption[]>
  getModels: () => Promise<ProviderModel[]>
  getSkills: (cwd?: string | null) => Promise<ProviderSkill[]>
  getApps: () => Promise<ProviderApp[]>
  getUsage: (options?: ProviderUsageOptions) => Promise<ProviderAccountUsage>
  resetRateLimits: () => Promise<ProviderAccountRateLimitResetOutcome>
  getChats: (options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (chatId: string) => Promise<ProviderChatDetail>
  generateOneShot: (message: string, options?: ProviderOneShotOptions) => Promise<string>
  cancelOneShot: (generationId: string) => Promise<void>
  startChat: (
    message: string,
    options?: ProviderTurnOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ) => Promise<ProviderChatDetail>
  continueChat: (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  continueChatInFork: (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ) => Promise<ProviderChatDetail>
  sendActiveChatMessage: (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  deletePendingMessage: (chatId: string, messageId: string) => Promise<ProviderChatDetail>
  editPendingMessage: (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  interruptPendingMessage: (chatId: string, messageId: string) => Promise<ProviderChatDetail>
  editMessage: (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  resolveApproval: (
    chatId: string,
    decision: ProviderApprovalDecision
  ) => Promise<ProviderChatDetail>
  stopChat: (chatId: string) => Promise<ProviderChatDetail>
  writeAgentTerminalInput: (chatId: string, processId: string, data: string) => Promise<void>
  resizeAgentTerminal: (
    chatId: string,
    processId: string,
    cols: number,
    rows: number
  ) => Promise<void>
  onChatUpdated: (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ) => () => void
  onAgentTerminalData: (listener: (event: ProviderAgentTerminalDataEvent) => void) => () => void
  dispose: () => void
}
