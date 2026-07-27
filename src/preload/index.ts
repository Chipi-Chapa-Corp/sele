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

const appApi: AppApi = {
  getColorScheme: () => ipcRenderer.invoke(appIpcChannels.getColorScheme),
  getWindowState: () => ipcRenderer.invoke(appIpcChannels.getWindowState),
  minimizeWindow: () => ipcRenderer.invoke(appIpcChannels.minimizeWindow),
  toggleWindowMaximized: () => ipcRenderer.invoke(appIpcChannels.toggleWindowMaximized),
  closeWindow: () => ipcRenderer.invoke(appIpcChannels.closeWindow),
  getDefaultCwd: () => ipcRenderer.invoke(appIpcChannels.getDefaultCwd),
  getGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.getGitChanges, options),
  getGitBranches: (options) => ipcRenderer.invoke(appIpcChannels.getGitBranches, options),
  switchGitBranch: (options) => ipcRenderer.invoke(appIpcChannels.switchGitBranch, options),
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
  }
}

const providerApi: ProviderRendererApi = {
  login: (providerId) => ipcRenderer.invoke(providerIpcChannels.login, providerId),
  getUpdateAvailability: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getUpdateAvailability, providerId),
  updateProvider: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.updateProvider, providerId),
  getApprovalModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getApprovalModes, providerId),
  getSandboxModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getSandboxModes, providerId),
  getModels: (providerId) => ipcRenderer.invoke(providerIpcChannels.getModels, providerId),
  getUsage: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getUsage, providerId, options),
  resetRateLimits: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.resetRateLimits, providerId),
  getChats: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getChats, providerId, options),
  getChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.getChat, providerId, chatId),
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

contextBridge.exposeInMainWorld('appApi', appApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
  }
}

const getFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

let lastInteractionAt: number | null = null
let lastInteractionKind: AppDiagnosticsInteractionKind | null = null

const sendDiagnosticsHeartbeat = (): void => {
  const memory = (performance as PerformanceWithMemory).memory
  const messageInput = document.querySelector<HTMLTextAreaElement>('#message-input')
  const heartbeat = {
    timestamp: Date.now(),
    jsHeapUsedBytes: getFiniteNumber(memory?.usedJSHeapSize),
    jsHeapTotalBytes: getFiniteNumber(memory?.totalJSHeapSize),
    domNodeCount: document.querySelectorAll('*').length,
    activeAnimationCount: document.getAnimations().length,
    animatedIconCount: document.querySelectorAll('.chat-detail__animated-icon').length,
    streamingMessageCount: document.querySelectorAll('[data-streaming="true"]').length,
    workingSpinnerCount: document.querySelectorAll('.chat-detail__working-spinner').length,
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
  window.setInterval(sendDiagnosticsHeartbeat, 2_000)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDiagnosticsHeartbeat, { once: true })
} else {
  startDiagnosticsHeartbeat()
}
