import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult,
  ProviderApprovalDecision,
  ProviderUpdateAvailability,
  ProviderAgentModeOption,
  ProviderApprovalModeOption,
  ProviderSandboxModeOption,
  ProviderApp,
  ProviderSkill,
  ProviderModel,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderResourceUpdateOptions,
  ProviderSourceOptions,
  ProviderUsageOptions,
  ProviderActiveSendMode,
  ProviderTurnOptions,
  ProviderOneShotOptions,
  ProviderSubagent,
  ProviderSubagentDetail,
  ProviderUserInputResponse
} from '../../shared/provider'
import type { AppContainerTarget } from '../../shared/app'

export type ProviderChatUpdateMetadata = {
  turnCompleted?: boolean
}

export type ProviderChatTurnWindow = {
  /** Null selects the latest `limit` turns. */
  startIndex: number | null
  limit: number
}

export type ProviderChatTurnCursorWindow = {
  cursor: string | null
  direction: 'older' | 'newer'
  limit: number
}

export type ProviderAdapter = {
  id: ProviderId
  login: (options?: ProviderSourceOptions) => Promise<ProviderLoginResult>
  getUpdateAvailability: (
    options?: ProviderSourceOptions
  ) => Promise<ProviderUpdateAvailability | null>
  updateProvider: (options?: ProviderSourceOptions) => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: () => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: () => Promise<ProviderSandboxModeOption[]>
  getAgentModes?: (options?: ProviderSourceOptions) => Promise<ProviderAgentModeOption[]>
  getModels: (options?: ProviderSourceOptions) => Promise<ProviderModel[]>
  getSkills: (cwd?: string | null, options?: ProviderSourceOptions) => Promise<ProviderSkill[]>
  getApps: (options?: ProviderSourceOptions) => Promise<ProviderApp[]>
  setSkillEnabled: (
    path: string,
    enabled: boolean,
    cwd?: string | null,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderSkill[]>
  setSkillsEnabled: (
    paths: string[],
    enabled: boolean,
    cwd?: string | null,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderSkill[]>
  setAppEnabled: (
    appId: string,
    enabled: boolean,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderApp[]>
  getUsage: (options?: ProviderUsageOptions) => Promise<ProviderAccountUsage>
  resetRateLimits: (
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountRateLimitResetOutcome>
  getChats: (options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (
    chatId: string,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderChatDetail>
  /**
   * A bounded, read-only transcript path for renderer navigation. Providers that implement this
   * must avoid hydrating transcript content outside the requested turn window.
   */
  getChatWindow?: (
    chatId: string,
    window: ProviderChatTurnWindow,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderChatDetail>
  /**
   * Cursor-native transcript navigation for providers whose history API does not expose an exact
   * total count. The returned items must be chronological even when the provider reads backwards.
   */
  getChatCursorWindow?: (
    chatId: string,
    window: ProviderChatTurnCursorWindow,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderChatDetail>
  /** Resolve an item to a bounded transcript window without hydrating unrelated turn items. */
  getChatWindowForItem?: (
    chatId: string,
    itemId: string,
    limit: number,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderChatDetail>
  getSubagents: (
    chatId: string,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderSubagent[]>
  getSubagent: (
    chatId: string,
    subagentId: string,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<ProviderSubagentDetail>
  cancelSubagent: (
    chatId: string,
    subagentId: string,
    options?: { container?: AppContainerTarget | null }
  ) => Promise<void>
  setChatTitle: (chatId: string, title: string) => Promise<ProviderChatDetail>
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
  forkChat: (
    chatId: string,
    messageId: string,
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
  steerPendingMessage: (chatId: string, messageId: string) => Promise<ProviderChatDetail>
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
  resolveUserInput: (
    chatId: string,
    requestId: string,
    response: ProviderUserInputResponse
  ) => Promise<ProviderChatDetail>
  stopChat: (chatId: string) => Promise<ProviderChatDetail>
  onChatUpdated: (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ) => () => void
  dispose: () => void
}
