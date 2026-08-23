import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AppApi,
  AppColorScheme,
  AppDiagnosticsHeartbeat,
  AppDiagnosticsInteraction,
  AppDiagnosticsInteractionKind,
  AppWindowState
} from '../shared/app'
import { appIpcChannels } from '../shared/app'
import type { ProviderRendererApi, ProviderWindowChatUpdatedEvent } from '../shared/provider'
import { providerIpcChannels } from '../shared/provider'
import type { TerminalDataEvent, TerminalExitEvent, TerminalRendererApi } from '../shared/terminal'
import { terminalIpcChannels } from '../shared/terminal'
import type { BrowserOpenRequest, BrowserRendererApi } from '../shared/browser'
import { browserIpcChannels } from '../shared/browser'

const appApi: AppApi = {
  getColorScheme: () => ipcRenderer.invoke(appIpcChannels.getColorScheme),
  getInstalledFontFamilies: () => ipcRenderer.invoke(appIpcChannels.getInstalledFontFamilies),
  getWindowState: () => ipcRenderer.invoke(appIpcChannels.getWindowState),
  minimizeWindow: () => ipcRenderer.invoke(appIpcChannels.minimizeWindow),
  toggleWindowMaximized: () => ipcRenderer.invoke(appIpcChannels.toggleWindowMaximized),
  closeWindow: () => ipcRenderer.invoke(appIpcChannels.closeWindow),
  setWindowZoomLevel: (level) => ipcRenderer.invoke(appIpcChannels.setWindowZoomLevel, level),
  handleExternalLink: (options) => ipcRenderer.invoke(appIpcChannels.handleExternalLink, options),
  getDefaultCwd: () => ipcRenderer.invoke(appIpcChannels.getDefaultCwd),
  getProjects: () => ipcRenderer.invoke(appIpcChannels.getProjects),
  addProject: (options) => ipcRenderer.invoke(appIpcChannels.addProject, options),
  setProjectOrder: (cwds) => ipcRenderer.invoke(appIpcChannels.setProjectOrder, cwds),
  getSshEnvironments: () => ipcRenderer.invoke(appIpcChannels.getSshEnvironments),
  createSshEnvironment: (options) =>
    ipcRenderer.invoke(appIpcChannels.createSshEnvironment, options),
  updateSshEnvironment: (options) =>
    ipcRenderer.invoke(appIpcChannels.updateSshEnvironment, options),
  deleteSshEnvironment: (options) =>
    ipcRenderer.invoke(appIpcChannels.deleteSshEnvironment, options),
  selectSshIdentityFile: () => ipcRenderer.invoke(appIpcChannels.selectSshIdentityFile),
  getContainerSuggestions: (options) =>
    ipcRenderer.invoke(appIpcChannels.getContainerSuggestions, options),
  getSourceAvailability: (options) =>
    ipcRenderer.invoke(appIpcChannels.getSourceAvailability, options),
  getGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.getGitChanges, options),
  getGitBranches: (options) => ipcRenderer.invoke(appIpcChannels.getGitBranches, options),
  switchGitBranch: (options) => ipcRenderer.invoke(appIpcChannels.switchGitBranch, options),
  deleteGitBranch: (options) => ipcRenderer.invoke(appIpcChannels.deleteGitBranch, options),
  createGitWorktree: (options) => ipcRenderer.invoke(appIpcChannels.createGitWorktree, options),
  getFileTree: (options) => ipcRenderer.invoke(appIpcChannels.getFileTree, options),
  getFileContents: (options) => ipcRenderer.invoke(appIpcChannels.getFileContents, options),
  writeFileContents: (options) => ipcRenderer.invoke(appIpcChannels.writeFileContents, options),
  getRecentGitCommitMessages: (options) =>
    ipcRenderer.invoke(appIpcChannels.getRecentGitCommitMessages, options),
  getUncommittedGitDiff: (options) =>
    ipcRenderer.invoke(appIpcChannels.getUncommittedGitDiff, options),
  getGitFileDiff: (options) => ipcRenderer.invoke(appIpcChannels.getGitFileDiff, options),
  getUncommittedGitPatchChanges: (options) =>
    ipcRenderer.invoke(appIpcChannels.getUncommittedGitPatchChanges, options),
  commitGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.commitGitChanges, options),
  pullGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.pullGitChanges, options),
  pushGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.pushGitChanges, options),
  selectFolder: (options) => ipcRenderer.invoke(appIpcChannels.selectFolder, options),
  getProjectIcon: (options) => ipcRenderer.invoke(appIpcChannels.getProjectIcon, options),
  selectProjectIcon: (options) => ipcRenderer.invoke(appIpcChannels.selectProjectIcon, options),
  selectMessageAttachments: () => ipcRenderer.invoke(appIpcChannels.selectMessageAttachments),
  readClipboardText: () => ipcRenderer.invoke(appIpcChannels.readClipboardText),
  writeClipboardText: (text) => ipcRenderer.invoke(appIpcChannels.writeClipboardText, text),
  getClipboardImage: () => ipcRenderer.invoke(appIpcChannels.getClipboardImage),
  getLocalImage: (options) => ipcRenderer.invoke(appIpcChannels.getLocalImage, options),
  copyLocalImage: (options) => ipcRenderer.invoke(appIpcChannels.copyLocalImage, options),
  saveLocalImage: (options) => ipcRenderer.invoke(appIpcChannels.saveLocalImage, options),
  onColorSchemeUpdated: (listener): (() => void) => {
    const handleColorSchemeUpdated = (_: IpcRendererEvent, scheme: AppColorScheme): void => {
      listener(scheme)
    }

    ipcRenderer.on(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
    return () =>
      ipcRenderer.removeListener(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
  },
  onWindowStateUpdated: (listener): (() => void) => {
    const handleWindowStateUpdated = (_: IpcRendererEvent, state: AppWindowState): void => {
      listener(state)
    }

    ipcRenderer.on(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
    return () =>
      ipcRenderer.removeListener(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
  },
  onWindowZoomLevelUpdated: (listener): (() => void) => {
    const handleWindowZoomLevelUpdated = (_: IpcRendererEvent, level: number): void => {
      if (typeof level === 'number' && Number.isFinite(level)) listener(level)
    }

    ipcRenderer.on(appIpcChannels.windowZoomLevelUpdated, handleWindowZoomLevelUpdated)
    return () =>
      ipcRenderer.removeListener(
        appIpcChannels.windowZoomLevelUpdated,
        handleWindowZoomLevelUpdated
      )
  }
}

const providerApi: ProviderRendererApi = {
  login: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.login, providerId, options),
  getAccounts: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getAccounts, providerId, options),
  createAccount: (providerId, name, options) =>
    ipcRenderer.invoke(providerIpcChannels.createAccount, providerId, name, options),
  completeAccountCreation: (providerId, accountId, loginId, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.completeAccountCreation,
      providerId,
      accountId,
      loginId,
      options
    ),
  cancelAccountCreation: (providerId, accountId, loginId, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.cancelAccountCreation,
      providerId,
      accountId,
      loginId,
      options
    ),
  useAccount: (providerId, accountId, options) =>
    ipcRenderer.invoke(providerIpcChannels.useAccount, providerId, accountId, options),
  deleteAccount: (providerId, accountId, options) =>
    ipcRenderer.invoke(providerIpcChannels.deleteAccount, providerId, accountId, options),
  getUpdateAvailability: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getUpdateAvailability, providerId, options),
  updateProvider: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.updateProvider, providerId, options),
  getApprovalModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getApprovalModes, providerId),
  getSandboxModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getSandboxModes, providerId),
  getModels: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getModels, providerId, options),
  getSkills: (providerId, cwd, options) =>
    ipcRenderer.invoke(providerIpcChannels.getSkills, providerId, cwd, options),
  getApps: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getApps, providerId, options),
  setSkillEnabled: (providerId, path, enabled, cwd, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.setSkillEnabled,
      providerId,
      path,
      enabled,
      cwd,
      options
    ),
  setSkillsEnabled: (providerId, paths, enabled, cwd, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.setSkillsEnabled,
      providerId,
      paths,
      enabled,
      cwd,
      options
    ),
  setAppEnabled: (providerId, appId, enabled, options) =>
    ipcRenderer.invoke(providerIpcChannels.setAppEnabled, providerId, appId, enabled, options),
  getUsage: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getUsage, providerId, options),
  resetRateLimits: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.resetRateLimits, providerId, options),
  getChats: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getChats, providerId, options),
  getChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.getChat, providerId, chatId),
  getChatWorkingStepPage: (providerId, chatId, workingStepId, startIndex, limit) =>
    ipcRenderer.invoke(
      providerIpcChannels.getChatWorkingStepPage,
      providerId,
      chatId,
      workingStepId,
      startIndex,
      limit
    ),
  getChatWorkingItem: (providerId, chatId, workingStepId, workingItemId) =>
    ipcRenderer.invoke(
      providerIpcChannels.getChatWorkingItem,
      providerId,
      chatId,
      workingStepId,
      workingItemId
    ),
  getChatWorkingToolPage: (providerId, chatId, workingStepId, workingItemId, startIndex, limit) =>
    ipcRenderer.invoke(
      providerIpcChannels.getChatWorkingToolPage,
      providerId,
      chatId,
      workingStepId,
      workingItemId,
      startIndex,
      limit
    ),
  getChatTurnPage: (providerId, chatId, startIndex, limit) =>
    ipcRenderer.invoke(providerIpcChannels.getChatTurnPage, providerId, chatId, startIndex, limit),
  setChatTitle: (providerId, chatId, title) =>
    ipcRenderer.invoke(providerIpcChannels.setChatTitle, providerId, chatId, title),
  generateOneShot: (providerId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.generateOneShot, providerId, message, options),
  cancelOneShot: (providerId, generationId) =>
    ipcRenderer.invoke(providerIpcChannels.cancelOneShot, providerId, generationId),
  startChat: (providerId, message, options, purpose) =>
    ipcRenderer.invoke(providerIpcChannels.startChat, providerId, message, options, purpose),
  continueChat: (providerId, chatId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.continueChat, providerId, chatId, message, options),
  continueChatSummary: (providerId, chatId, message, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.continueChatSummary,
      providerId,
      chatId,
      message,
      options
    ),
  continueChatInFork: (providerId, chatId, message, purpose, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.continueChatInFork,
      providerId,
      chatId,
      message,
      purpose,
      options
    ),
  sendActiveChatMessage: (providerId, chatId, message, mode, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.sendActiveChatMessage,
      providerId,
      chatId,
      message,
      mode,
      options
    ),
  sendActiveChatMessageSummary: (providerId, chatId, message, mode, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.sendActiveChatMessageSummary,
      providerId,
      chatId,
      message,
      mode,
      options
    ),
  deletePendingMessage: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.deletePendingMessage, providerId, chatId, messageId),
  editPendingMessage: (providerId, chatId, messageId, message, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.editPendingMessage,
      providerId,
      chatId,
      messageId,
      message,
      options
    ),
  steerPendingMessage: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.steerPendingMessage, providerId, chatId, messageId),
  interruptPendingMessage: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.interruptPendingMessage, providerId, chatId, messageId),
  editMessage: (providerId, chatId, messageId, message, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.editMessage,
      providerId,
      chatId,
      messageId,
      message,
      options
    ),
  resolveApproval: (providerId, chatId, decision) =>
    ipcRenderer.invoke(providerIpcChannels.resolveApproval, providerId, chatId, decision),
  resolveUserInput: (providerId, chatId, requestId, response) =>
    ipcRenderer.invoke(
      providerIpcChannels.resolveUserInput,
      providerId,
      chatId,
      requestId,
      response
    ),
  stopChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.stopChat, providerId, chatId),
  stopChatSummary: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.stopChatSummary, providerId, chatId),
  markChatDone: (providerId, chatId, done) =>
    ipcRenderer.invoke(providerIpcChannels.markChatDone, providerId, chatId, done),
  markCwdChatsDone: (providerId, cwd) =>
    ipcRenderer.invoke(providerIpcChannels.markCwdChatsDone, providerId, cwd),
  getCwdNotes: (providerId, cwd) =>
    ipcRenderer.invoke(providerIpcChannels.getCwdNotes, providerId, cwd),
  setCwdNotes: (providerId, cwd, notes) =>
    ipcRenderer.invoke(providerIpcChannels.setCwdNotes, providerId, cwd, notes),
  markChatSeen: (providerId, chatId, seenUpdatedAt) =>
    ipcRenderer.invoke(providerIpcChannels.markChatSeen, providerId, chatId, seenUpdatedAt),
  setChatPinned: (providerId, chatId, pinned) =>
    ipcRenderer.invoke(providerIpcChannels.setChatPinned, providerId, chatId, pinned),
  setChatOrder: (chatIds) => ipcRenderer.invoke(providerIpcChannels.setChatOrder, chatIds),
  setViewedChat: (providerId, chatId) =>
    ipcRenderer.send(providerIpcChannels.viewedChatChanged, providerId, chatId),
  acknowledgeChatUpdate: (sequence, detailApplied) =>
    ipcRenderer.send(providerIpcChannels.chatUpdateAcknowledged, sequence, detailApplied),
  onChatUpdated: (listener): (() => void) => {
    const handleChatUpdated = (
      _: IpcRendererEvent,
      event: ProviderWindowChatUpdatedEvent
    ): void => {
      listener(event)
    }

    ipcRenderer.on(providerIpcChannels.chatUpdated, handleChatUpdated)
    ipcRenderer.send(providerIpcChannels.chatUpdatesReady)
    return () => {
      ipcRenderer.removeListener(providerIpcChannels.chatUpdated, handleChatUpdated)
      ipcRenderer.send(providerIpcChannels.chatUpdatesStopped)
    }
  }
}

const terminalApi: TerminalRendererApi = {
  createSession: (options) => ipcRenderer.invoke(terminalIpcChannels.createSession, options),
  runCommand: (options) => ipcRenderer.invoke(terminalIpcChannels.runCommand, options),
  write: (sessionId, data) => ipcRenderer.send(terminalIpcChannels.write, sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.send(terminalIpcChannels.resize, sessionId, cols, rows),
  setPaused: (sessionId, paused) =>
    ipcRenderer.send(terminalIpcChannels.setPaused, sessionId, paused),
  getProcessStatus: (sessionId) =>
    ipcRenderer.invoke(terminalIpcChannels.getProcessStatus, sessionId),
  closeSession: (sessionId) => ipcRenderer.invoke(terminalIpcChannels.closeSession, sessionId),
  onData: (listener): (() => void) => {
    const handleData = (_: IpcRendererEvent, event: TerminalDataEvent): void => {
      listener(event)
    }

    ipcRenderer.on(terminalIpcChannels.data, handleData)
    return () => ipcRenderer.removeListener(terminalIpcChannels.data, handleData)
  },
  onExit: (listener): (() => void) => {
    const handleExit = (_: IpcRendererEvent, event: TerminalExitEvent): void => {
      listener(event)
    }

    ipcRenderer.on(terminalIpcChannels.exit, handleExit)
    return () => ipcRenderer.removeListener(terminalIpcChannels.exit, handleExit)
  }
}

const browserApi: BrowserRendererApi = {
  onOpenRequested: (listener): (() => void) => {
    const handleOpenRequested = (_: IpcRendererEvent, request: BrowserOpenRequest): void => {
      listener(request)
    }

    ipcRenderer.on(browserIpcChannels.openRequested, handleOpenRequested)
    return () => ipcRenderer.removeListener(browserIpcChannels.openRequested, handleOpenRequested)
  },
  onCloseActiveTabRequested: (listener): (() => void) => {
    const handleCloseActiveTabRequested = (): void => listener()

    ipcRenderer.on(browserIpcChannels.closeActiveTabRequested, handleCloseActiveTabRequested)
    return () =>
      ipcRenderer.removeListener(
        browserIpcChannels.closeActiveTabRequested,
        handleCloseActiveTabRequested
      )
  }
}

contextBridge.exposeInMainWorld('appApi', appApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)
contextBridge.exposeInMainWorld('terminalApi', terminalApi)
contextBridge.exposeInMainWorld('browserApi', browserApi)

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
  }
}

const getFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getDocumentDatasetCount = (key: string): number => {
  const value = Number(document.documentElement.dataset[key] ?? 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

const getDocumentDatasetBoolean = (key: string): boolean =>
  document.documentElement.dataset[key] === 'true'

const diagnosticsHeartbeatIntervalMs = 2_000
let lastInteractionAt: number | null = null
let lastInteractionKind: AppDiagnosticsInteractionKind | null = null
let lastHeartbeatAt: number | null = null
let longTaskCount = 0
let longTaskTotalDurationMs = 0
let longTaskMaxDurationMs = 0

try {
  const longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskCount += 1
      longTaskTotalDurationMs += entry.duration
      longTaskMaxDurationMs = Math.max(longTaskMaxDurationMs, entry.duration)
    }
  })
  longTaskObserver.observe({ entryTypes: ['longtask'] })
} catch {
  // The Long Tasks API is optional. Interval lag still detects a blocked renderer.
}

const sendDiagnosticsHeartbeat = (): void => {
  const timestamp = Date.now()
  const eventLoopLagMs =
    lastHeartbeatAt === null
      ? 0
      : Math.max(0, timestamp - lastHeartbeatAt - diagnosticsHeartbeatIntervalMs)
  lastHeartbeatAt = timestamp
  const memory = (performance as PerformanceWithMemory).memory
  const messageInput = document.querySelector<HTMLTextAreaElement>('#message-input')
  const chatScroller = document.querySelector<HTMLElement>('#chat-search-content')
  const heartbeat = {
    timestamp,
    eventLoopLagMs,
    longTaskCount,
    longTaskTotalDurationMs,
    longTaskMaxDurationMs,
    jsHeapUsedBytes: getFiniteNumber(memory?.usedJSHeapSize),
    jsHeapTotalBytes: getFiniteNumber(memory?.totalJSHeapSize),
    domNodeCount: document.querySelectorAll('*').length,
    activeAnimationCount: document.getAnimations().length,
    animatedIconCount: document.querySelectorAll('.chat-detail__animated-icon').length,
    streamingMessageCount: document.querySelectorAll('[data-streaming="true"]').length,
    workingSpinnerCount: document.querySelectorAll('.chat-detail__working-spinner').length,
    selectedChatItemCount: getDocumentDatasetCount('selectedChatItemCount'),
    recentChatCacheEntryCount: getDocumentDatasetCount('recentChatCacheEntryCount'),
    recentChatCacheItemCount: getDocumentDatasetCount('recentChatCacheItemCount'),
    selectedChatTurnCount: getDocumentDatasetCount('selectedChatTurnCount'),
    renderedChatTurnCount: getDocumentDatasetCount('renderedChatTurnCount'),
    mountedChatTurnCount: document.querySelectorAll('.chat-detail__turn').length,
    renderedToolElementCount: document.querySelectorAll(
      '.chat-detail__tool-read, .chat-detail__tool-group, .chat-detail__generated-image-tool'
    ).length,
    openToolDetailsCount: document.querySelectorAll('details.chat-detail__tool-group[open]').length,
    openToolSequenceCount: document.querySelectorAll('details.chat-detail__tool-sequence[open]')
      .length,
    chatScrollHeightPx: chatScroller?.scrollHeight ?? 0,
    chatViewportHeightPx: chatScroller?.clientHeight ?? 0,
    chatSearchOpen: getDocumentDatasetBoolean('chatSearchOpen'),
    messageInputLength: messageInput?.value.length ?? 0,
    messageInputFocused: document.activeElement === messageInput,
    openNotesCount: document.querySelectorAll('.cwd-notes button[aria-expanded="true"]').length,
    openPlanCount: document.querySelectorAll('.chat-plan__toggle[aria-expanded="true"]').length,
    openWorkingDetailsCount: document.querySelectorAll('details.chat-detail__working[open]').length,
    lastInteractionAt,
    lastInteractionKind,
    visibilityState: document.visibilityState
  } satisfies AppDiagnosticsHeartbeat

  ipcRenderer.send(appIpcChannels.diagnosticsHeartbeat, heartbeat)
  longTaskCount = 0
  longTaskTotalDurationMs = 0
  longTaskMaxDurationMs = 0
}

const getInteractionKind = (target: EventTarget | null): AppDiagnosticsInteractionKind | null => {
  if (!(target instanceof Element)) return null
  if (target.closest('.chat-plan__toggle')) return 'plan-toggle'
  if (target.closest('.cwd-notes button')) return 'notes-toggle'
  if (target.closest('[aria-label^="Edit "]')) return 'edit-message'
  if (target.closest('[aria-label="Stop response"]')) return 'stop-response'
  if (target.closest('#message-input')) return 'message-input'
  return null
}

document.addEventListener(
  'pointerdown',
  (event) => {
    const interactionKind = getInteractionKind(event.target)
    if (!interactionKind) return

    lastInteractionAt = Date.now()
    lastInteractionKind = interactionKind
    if (interactionKind !== 'message-input') {
      ipcRenderer.send(appIpcChannels.diagnosticsInteraction, {
        timestamp: lastInteractionAt,
        kind: interactionKind
      } satisfies AppDiagnosticsInteraction)
    }
  },
  true
)

document.addEventListener(
  'input',
  (event) => {
    if (getInteractionKind(event.target) !== 'message-input') return
    lastInteractionAt = Date.now()
    lastInteractionKind = 'message-input'
  },
  true
)

const startDiagnosticsHeartbeat = (): void => {
  sendDiagnosticsHeartbeat()
  window.setInterval(sendDiagnosticsHeartbeat, diagnosticsHeartbeatIntervalMs)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDiagnosticsHeartbeat, { once: true })
} else {
  startDiagnosticsHeartbeat()
}
