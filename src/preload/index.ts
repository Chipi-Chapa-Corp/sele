import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppApi, AppColorScheme, AppWindowState } from '../shared/app'
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
  getDroppedMessageAttachments: (files) =>
    ipcRenderer.invoke(
      appIpcChannels.getDroppedMessageAttachments,
      files.map((file) => webUtils.getPathForFile(file))
    ),
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
  forkChat: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.forkChat, providerId, chatId, messageId),
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
  findCookieProfiles: (options) =>
    ipcRenderer.invoke(browserIpcChannels.findCookieProfiles, options),
  importCookies: (options) => ipcRenderer.invoke(browserIpcChannels.importCookies, options),
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
  },
  resolvePageZoomScale: (options) =>
    ipcRenderer.invoke(browserIpcChannels.resolvePageZoomScale, options)
}

contextBridge.exposeInMainWorld('appApi', appApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)
contextBridge.exposeInMainWorld('terminalApi', terminalApi)
contextBridge.exposeInMainWorld('browserApi', browserApi)
