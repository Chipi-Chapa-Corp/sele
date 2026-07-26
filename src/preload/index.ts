import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppApi, AppColorScheme, AppWindowState } from '../shared/app'
import { appIpcChannels } from '../shared/app'
import type { ProviderApi, ProviderChatUpdatedEvent } from '../shared/provider'
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

const providerApi: ProviderApi = {
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
  onChatUpdated: (listener): (() => void) => {
    const handleChatUpdated = (_: IpcRendererEvent, event: ProviderChatUpdatedEvent): void => {
      listener(event)
    }

    ipcRenderer.on(providerIpcChannels.chatUpdated, handleChatUpdated)
    return () => ipcRenderer.removeListener(providerIpcChannels.chatUpdated, handleChatUpdated)
  }
}

contextBridge.exposeInMainWorld('appApi', appApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)
