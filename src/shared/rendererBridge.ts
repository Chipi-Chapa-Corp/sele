import { mcpAppsChannels, type McpAppsApi } from './mcpApps'
import type { AppUpdateState } from './appUpdate'
import { desktopChannels, type DesktopApi } from './desktop'

import type { AppApi, AppColorScheme, AppWindowState } from './app'
import { appIpcChannels } from './app'
import type { ProviderRendererApi, ProviderWindowChatUpdatedEvent } from './provider'
import { providerIpcChannels } from './provider'
import type { TerminalDataEvent, TerminalExitEvent, TerminalRendererApi } from './terminal'
import { terminalIpcChannels } from './terminal'
import type { BrowserOpenRequest, BrowserPageShortcutRequest, BrowserRendererApi } from './browser'
import { browserIpcChannels } from './browser'

import { localAccessChannels, type LocalAccessApi } from './localAccess'
import type { ChatSleepSnapshot } from './chatSleep'

export type RendererTransport = {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  on<T extends unknown[]>(channel: string, listener: (...args: T) => void): unknown
  removeListener<T extends unknown[]>(channel: string, listener: (...args: T) => void): unknown
}

export const createRendererBridge = (
  transport: RendererTransport,
  getPathForFile: (file: File) => string
) => {
  const desktopApi: DesktopApi = {
    getState: () => transport.invoke(desktopChannels.getState),
    connectComputer: () => transport.invoke(desktopChannels.connectComputer),
    disconnectComputer: () => transport.invoke(desktopChannels.disconnectComputer),
    pairChrome: () => transport.invoke(desktopChannels.pairChrome),
    disconnectChrome: () => transport.invoke(desktopChannels.disconnectChrome),
    pairOpera: () => transport.invoke(desktopChannels.pairOpera),
    disconnectOpera: () => transport.invoke(desktopChannels.disconnectOpera),
    openChromeExtension: () => transport.invoke(desktopChannels.openChromeExtension)
  }

  const mcpAppsApi: McpAppsApi = {
    open: (scope, callId) => transport.invoke(mcpAppsChannels.open, scope, callId),
    request: (id, method, params) => transport.invoke(mcpAppsChannels.request, id, method, params),
    close: (id) => transport.invoke(mcpAppsChannels.close, id)
  }

  const appApi: AppApi = {
    getChatSleep: () => transport.invoke(appIpcChannels.getChatSleep),
    updateChatSleep: (changes) => transport.invoke(appIpcChannels.updateChatSleep, changes),
    onChatSleepUpdated: (listener) => {
      const handler = (_event: unknown, state: ChatSleepSnapshot): void => listener(state)
      transport.on(appIpcChannels.chatSleepUpdated, handler)
      return () => transport.removeListener(appIpcChannels.chatSleepUpdated, handler)
    },
    getAppUpdate: () => transport.invoke(appIpcChannels.getAppUpdate),
    dismissAppUpdate: (mode) => transport.invoke(appIpcChannels.dismissAppUpdate, mode),
    installAppUpdate: () => transport.invoke(appIpcChannels.installAppUpdate),
    onAppUpdateChanged: (listener) => {
      const handler = (_: unknown, state: AppUpdateState): void => listener(state)
      transport.on(appIpcChannels.appUpdateChanged, handler)
      return () => transport.removeListener(appIpcChannels.appUpdateChanged, handler)
    },
    exportDiagnosticLog: () => transport.invoke(appIpcChannels.exportDiagnosticLog),
    getColorScheme: () => transport.invoke(appIpcChannels.getColorScheme),
    getInstalledFontFamilies: () => transport.invoke(appIpcChannels.getInstalledFontFamilies),
    getWindowState: () => transport.invoke(appIpcChannels.getWindowState),
    minimizeWindow: () => transport.invoke(appIpcChannels.minimizeWindow),
    toggleWindowMaximized: () => transport.invoke(appIpcChannels.toggleWindowMaximized),
    closeWindow: () => transport.invoke(appIpcChannels.closeWindow),
    setWindowZoomLevel: (level) => transport.invoke(appIpcChannels.setWindowZoomLevel, level),
    handleExternalLink: (options) => transport.invoke(appIpcChannels.handleExternalLink, options),
    getDefaultCwd: () => transport.invoke(appIpcChannels.getDefaultCwd),
    onWorkspaceUpdated: (listener) => {
      const handler = (): void => listener()
      transport.on(appIpcChannels.workspaceUpdated, handler)
      return () => {
        transport.removeListener(appIpcChannels.workspaceUpdated, handler)
      }
    },
    getProjects: () => transport.invoke(appIpcChannels.getProjects),
    getDeletedProjectCwds: () => transport.invoke(appIpcChannels.getDeletedProjectCwds),
    deleteProject: (cwd) => transport.invoke(appIpcChannels.deleteProject, cwd),
    addProject: (options) => transport.invoke(appIpcChannels.addProject, options),
    setProjectOrder: (cwds) => transport.invoke(appIpcChannels.setProjectOrder, cwds),
    getSshEnvironments: () => transport.invoke(appIpcChannels.getSshEnvironments),
    createSshEnvironment: (options) =>
      transport.invoke(appIpcChannels.createSshEnvironment, options),
    updateSshEnvironment: (options) =>
      transport.invoke(appIpcChannels.updateSshEnvironment, options),
    deleteSshEnvironment: (options) =>
      transport.invoke(appIpcChannels.deleteSshEnvironment, options),
    selectSshIdentityFile: () => transport.invoke(appIpcChannels.selectSshIdentityFile),
    getContainerSuggestions: (options) =>
      transport.invoke(appIpcChannels.getContainerSuggestions, options),
    getSourceAvailability: (options) =>
      transport.invoke(appIpcChannels.getSourceAvailability, options),
    getGitHubPullRequests: (options) =>
      transport.invoke(appIpcChannels.getGitHubPullRequests, options),
    getGitHubPullRequestChanges: (options) =>
      transport.invoke(appIpcChannels.getGitHubPullRequestChanges, options),
    getGitHubPullRequestManagement: (options) =>
      transport.invoke(appIpcChannels.getGitHubPullRequestManagement, options),
    getGitHubPullRequestCommitChanges: (options) =>
      transport.invoke(appIpcChannels.getGitHubPullRequestCommitChanges, options),
    performGitHubPullRequestAction: (options) =>
      transport.invoke(appIpcChannels.performGitHubPullRequestAction, options),
    submitGitHubPullRequestReview: (options) =>
      transport.invoke(appIpcChannels.submitGitHubPullRequestReview, options),
    getGitHubPullRequest: (options) =>
      transport.invoke(appIpcChannels.getGitHubPullRequest, options),
    getGitChanges: (options) => transport.invoke(appIpcChannels.getGitChanges, options),
    getGitBranches: (options) => transport.invoke(appIpcChannels.getGitBranches, options),
    switchGitBranch: (options) => transport.invoke(appIpcChannels.switchGitBranch, options),
    deleteGitBranch: (options) => transport.invoke(appIpcChannels.deleteGitBranch, options),
    createGitWorktree: (options) => transport.invoke(appIpcChannels.createGitWorktree, options),
    getFileTree: (options) => transport.invoke(appIpcChannels.getFileTree, options),
    getFileTreeListing: (options) => transport.invoke(appIpcChannels.getFileTreeListing, options),
    getFileContents: (options) => transport.invoke(appIpcChannels.getFileContents, options),
    openFileInSystemApp: (options) => transport.invoke(appIpcChannels.openFileInSystemApp, options),
    openFileInBrowser: (options) => transport.invoke(appIpcChannels.openFileInBrowser, options),
    downloadFile: (options) => transport.invoke(appIpcChannels.downloadFile, options),
    showFileInFolder: (options) => transport.invoke(appIpcChannels.showFileInFolder, options),
    writeFileContents: (options) => transport.invoke(appIpcChannels.writeFileContents, options),
    getRecentGitCommitMessages: (options) =>
      transport.invoke(appIpcChannels.getRecentGitCommitMessages, options),
    getUncommittedGitDiff: (options) =>
      transport.invoke(appIpcChannels.getUncommittedGitDiff, options),
    getGitCommitMessageContext: (options) =>
      transport.invoke(appIpcChannels.getGitCommitMessageContext, options),
    getGitFileDiff: (options) => transport.invoke(appIpcChannels.getGitFileDiff, options),
    getUncommittedGitPatchChanges: (options) =>
      transport.invoke(appIpcChannels.getUncommittedGitPatchChanges, options),
    commitGitChanges: (options) => transport.invoke(appIpcChannels.commitGitChanges, options),
    pullGitChanges: (options) => transport.invoke(appIpcChannels.pullGitChanges, options),
    pushGitChanges: (options) => transport.invoke(appIpcChannels.pushGitChanges, options),
    selectFolder: (options) => transport.invoke(appIpcChannels.selectFolder, options),
    getProjectIcon: (options) => transport.invoke(appIpcChannels.getProjectIcon, options),
    selectProjectIcon: (options) => transport.invoke(appIpcChannels.selectProjectIcon, options),
    prepareMessageAttachments: (attachments, options) =>
      transport.invoke(appIpcChannels.prepareMessageAttachments, attachments, options),
    selectMessageAttachments: () => transport.invoke(appIpcChannels.selectMessageAttachments),
    getDroppedMessageAttachments: (files) =>
      transport.invoke(
        appIpcChannels.getDroppedMessageAttachments,
        files.map((file) => getPathForFile(file))
      ),
    readClipboardText: () => transport.invoke(appIpcChannels.readClipboardText),
    writeClipboardText: (text) => transport.invoke(appIpcChannels.writeClipboardText, text),
    getClipboardImage: (image) => transport.invoke(appIpcChannels.getClipboardImage, image),
    getLocalVideo: (options) => transport.invoke(appIpcChannels.getLocalVideo, options),
    copyLocalVideo: (options) => transport.invoke(appIpcChannels.copyLocalVideo, options),
    saveLocalVideo: (options) => transport.invoke(appIpcChannels.saveLocalVideo, options),
    getLocalImage: (options) => transport.invoke(appIpcChannels.getLocalImage, options),
    writeClipboardImage: (png) => transport.invoke(appIpcChannels.writeClipboardImage, png),
    saveLocalImage: (options) => transport.invoke(appIpcChannels.saveLocalImage, options),
    onColorSchemeUpdated: (listener): (() => void) => {
      const handleColorSchemeUpdated = (_: unknown, scheme: AppColorScheme): void => {
        listener(scheme)
      }

      transport.on(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
      return () =>
        transport.removeListener(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
    },
    onWindowStateUpdated: (listener): (() => void) => {
      const handleWindowStateUpdated = (_: unknown, state: AppWindowState): void => {
        listener(state)
      }

      transport.on(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
      return () =>
        transport.removeListener(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
    },
    onWindowZoomLevelUpdated: (listener): (() => void) => {
      const handleWindowZoomLevelUpdated = (_: unknown, level: number): void => {
        if (typeof level === 'number' && Number.isFinite(level)) listener(level)
      }

      transport.on(appIpcChannels.windowZoomLevelUpdated, handleWindowZoomLevelUpdated)
      return () =>
        transport.removeListener(
          appIpcChannels.windowZoomLevelUpdated,
          handleWindowZoomLevelUpdated
        )
    }
  }

  const providerApi: ProviderRendererApi = {
    exportChat: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.exportChat, providerId, chatId),
    openChatImport: () => transport.invoke(providerIpcChannels.openChatImport),
    importChat: (id, providerId, container) =>
      transport.invoke(providerIpcChannels.importChat, id, providerId, container),
    cancelChatImport: (id) => transport.invoke(providerIpcChannels.cancelChatImport, id),
    login: (providerId, options) =>
      transport.invoke(providerIpcChannels.login, providerId, options),
    reauthenticateAccount: (providerId, options) =>
      transport.invoke(providerIpcChannels.reauthenticateAccount, providerId, options),
    getAccounts: (providerId, options) =>
      transport.invoke(providerIpcChannels.getAccounts, providerId, options),
    createAccount: (providerId, options) =>
      transport.invoke(providerIpcChannels.createAccount, providerId, options),
    completeAccountCreation: (providerId, accountId, loginId, options) =>
      transport.invoke(
        providerIpcChannels.completeAccountCreation,
        providerId,
        accountId,
        loginId,
        options
      ),
    cancelAccountCreation: (providerId, accountId, loginId, options) =>
      transport.invoke(
        providerIpcChannels.cancelAccountCreation,
        providerId,
        accountId,
        loginId,
        options
      ),
    submitAccountLoginCode: (providerId, loginId, code, options) =>
      transport.invoke(
        providerIpcChannels.submitAccountLoginCode,
        providerId,
        loginId,
        code,
        options
      ),
    useAccount: (providerId, accountId, options) =>
      transport.invoke(providerIpcChannels.useAccount, providerId, accountId, options),
    deleteAccount: (providerId, accountId, options) =>
      transport.invoke(providerIpcChannels.deleteAccount, providerId, accountId, options),
    getUpdateAvailability: (providerId, options) =>
      transport.invoke(providerIpcChannels.getUpdateAvailability, providerId, options),
    getProviderUpdateImpact: (providerId, options) =>
      transport.invoke(providerIpcChannels.getProviderUpdateImpact, providerId, options),
    updateProvider: (providerId, options) =>
      transport.invoke(providerIpcChannels.updateProvider, providerId, options),
    getApprovalModes: (providerId) =>
      transport.invoke(providerIpcChannels.getApprovalModes, providerId),
    getSandboxModes: (providerId) =>
      transport.invoke(providerIpcChannels.getSandboxModes, providerId),
    getAgentModes: (providerId, options) =>
      transport.invoke(providerIpcChannels.getAgentModes, providerId, options),
    getModels: (providerId, options) =>
      transport.invoke(providerIpcChannels.getModels, providerId, options),
    getSkills: (providerId, cwd, options) =>
      transport.invoke(providerIpcChannels.getSkills, providerId, cwd, options),
    getConnections: (providerId, options) =>
      transport.invoke(providerIpcChannels.getConnections, providerId, options),
    connectProvider: (providerId, input, options) =>
      transport.invoke(providerIpcChannels.connectProvider, providerId, input, options),
    getConnectionAttempt: (providerId, attemptId, options) =>
      transport.invoke(providerIpcChannels.getConnectionAttempt, providerId, attemptId, options),
    completeConnection: (providerId, attemptId, code, options) =>
      transport.invoke(
        providerIpcChannels.completeConnection,
        providerId,
        attemptId,
        code,
        options
      ),
    cancelConnection: (providerId, attemptId, options) =>
      transport.invoke(providerIpcChannels.cancelConnection, providerId, attemptId, options),
    deleteConnection: (providerId, credentialId, options) =>
      transport.invoke(providerIpcChannels.deleteConnection, providerId, credentialId, options),
    getConfig: (providerId, options) =>
      transport.invoke(providerIpcChannels.getConfig, providerId, options),
    setConfigValue: (providerId, name, path, value, options) =>
      transport.invoke(providerIpcChannels.setConfigValue, providerId, name, path, value, options),
    setConfigFeature: (providerId, name, enabled, options) =>
      transport.invoke(providerIpcChannels.setConfigFeature, providerId, name, enabled, options),
    getApps: (providerId, options) =>
      transport.invoke(providerIpcChannels.getApps, providerId, options),
    setSkillEnabled: (providerId, path, enabled, cwd, options) =>
      transport.invoke(
        providerIpcChannels.setSkillEnabled,
        providerId,
        path,
        enabled,
        cwd,
        options
      ),
    setSkillsEnabled: (providerId, paths, enabled, cwd, options) =>
      transport.invoke(
        providerIpcChannels.setSkillsEnabled,
        providerId,
        paths,
        enabled,
        cwd,
        options
      ),
    setAppEnabled: (providerId, appId, enabled, options) =>
      transport.invoke(providerIpcChannels.setAppEnabled, providerId, appId, enabled, options),
    getTokenUsage: (providerId, chatId, options) =>
      transport.invoke(providerIpcChannels.getTokenUsage, providerId, chatId, options),
    getUsage: (providerId, options) =>
      transport.invoke(providerIpcChannels.getUsage, providerId, options),
    resetRateLimits: (providerId, options) =>
      transport.invoke(providerIpcChannels.resetRateLimits, providerId, options),
    getChatContainers: () => transport.invoke(providerIpcChannels.getChatContainers),
    getChats: (providerId, options) =>
      transport.invoke(providerIpcChannels.getChats, providerId, options),
    getKnownChats: (providerId, options) =>
      transport.invoke(providerIpcChannels.getKnownChats, providerId, options),
    getChat: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.getChat, providerId, chatId),
    getCachedChat: (providerId, chatId, options) =>
      transport.invoke(providerIpcChannels.getCachedChat, providerId, chatId, options),
    getChatTerminalTasks: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.getChatTerminalTasks, providerId, chatId),
    getSubagents: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.getSubagents, providerId, chatId),
    getSubagent: (providerId, chatId, subagentId, window) =>
      transport.invoke(providerIpcChannels.getSubagent, providerId, chatId, subagentId, window),
    cancelSubagent: (providerId, chatId, subagentId) =>
      transport.invoke(providerIpcChannels.cancelSubagent, providerId, chatId, subagentId),
    sendSubagentMessage: (providerId, chatId, subagentId, message) =>
      transport.invoke(
        providerIpcChannels.sendSubagentMessage,
        providerId,
        chatId,
        subagentId,
        message
      ),
    getChatWorkingStepPage: (providerId, chatId, workingStepId, startIndex, limit, rootChatId) =>
      transport.invoke(
        providerIpcChannels.getChatWorkingStepPage,
        providerId,
        chatId,
        workingStepId,
        startIndex,
        limit,
        rootChatId
      ),
    getChatWorkingItem: (providerId, chatId, workingStepId, workingItemId, rootChatId) =>
      transport.invoke(
        providerIpcChannels.getChatWorkingItem,
        providerId,
        chatId,
        workingStepId,
        workingItemId,
        rootChatId
      ),
    getChatWorkingToolPage: (
      providerId,
      chatId,
      workingStepId,
      workingItemId,
      startIndex,
      limit,
      rootChatId
    ) =>
      transport.invoke(
        providerIpcChannels.getChatWorkingToolPage,
        providerId,
        chatId,
        workingStepId,
        workingItemId,
        startIndex,
        limit,
        rootChatId
      ),
    getChatTurnPage: (providerId, chatId, startIndex, limit) =>
      transport.invoke(providerIpcChannels.getChatTurnPage, providerId, chatId, startIndex, limit),
    getChatTurnCursorPage: (providerId, chatId, direction, cursor, limit) =>
      transport.invoke(
        providerIpcChannels.getChatTurnCursorPage,
        providerId,
        chatId,
        direction,
        cursor,
        limit
      ),
    getChatTurnPageForItem: (providerId, chatId, itemId, limit) =>
      transport.invoke(
        providerIpcChannels.getChatTurnPageForItem,
        providerId,
        chatId,
        itemId,
        limit
      ),
    setChatGoal: (providerId, chatId, objective) =>
      transport.invoke(providerIpcChannels.setChatGoal, providerId, chatId, objective),
    setChatTitle: (providerId, chatId, title) =>
      transport.invoke(providerIpcChannels.setChatTitle, providerId, chatId, title),
    generateOneShot: (providerId, message, options) =>
      transport.invoke(providerIpcChannels.generateOneShot, providerId, message, options),
    cancelOneShot: (providerId, generationId) =>
      transport.invoke(providerIpcChannels.cancelOneShot, providerId, generationId),
    startChat: (providerId, message, options, purpose) =>
      transport.invoke(providerIpcChannels.startChat, providerId, message, options, purpose),
    continueChat: (providerId, chatId, message, options) =>
      transport.invoke(providerIpcChannels.continueChat, providerId, chatId, message, options),
    continueChatSummary: (providerId, chatId, message, options) =>
      transport.invoke(
        providerIpcChannels.continueChatSummary,
        providerId,
        chatId,
        message,
        options
      ),
    continueChatInFork: (providerId, chatId, message, purpose, options) =>
      transport.invoke(
        providerIpcChannels.continueChatInFork,
        providerId,
        chatId,
        message,
        purpose,
        options
      ),
    forkChat: (providerId, chatId, messageId) =>
      transport.invoke(providerIpcChannels.forkChat, providerId, chatId, messageId),
    sendActiveChatMessage: (providerId, chatId, message, mode, options) =>
      transport.invoke(
        providerIpcChannels.sendActiveChatMessage,
        providerId,
        chatId,
        message,
        mode,
        options
      ),
    sendActiveChatMessageSummary: (providerId, chatId, message, mode, options) =>
      transport.invoke(
        providerIpcChannels.sendActiveChatMessageSummary,
        providerId,
        chatId,
        message,
        mode,
        options
      ),
    getLimitResetMessages: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.getLimitResetMessages, providerId, chatId),
    addLimitResetMessage: (providerId, chatId, message, options) =>
      transport.invoke(
        providerIpcChannels.addLimitResetMessage,
        providerId,
        chatId,
        message,
        options
      ),
    deleteLimitResetMessage: (providerId, chatId, messageId) =>
      transport.invoke(providerIpcChannels.deleteLimitResetMessage, providerId, chatId, messageId),
    deletePendingMessage: (providerId, chatId, messageId) =>
      transport.invoke(providerIpcChannels.deletePendingMessage, providerId, chatId, messageId),
    beginPendingMessageEdit: (providerId, chatId, messageId, editId) =>
      transport.invoke(
        providerIpcChannels.beginPendingMessageEdit,
        providerId,
        chatId,
        messageId,
        editId
      ),
    cancelPendingMessageEdit: (providerId, chatId, messageId, editId) =>
      transport.invoke(
        providerIpcChannels.cancelPendingMessageEdit,
        providerId,
        chatId,
        messageId,
        editId
      ),
    editPendingMessage: (providerId, chatId, messageId, message, options, editId) =>
      transport.invoke(
        providerIpcChannels.editPendingMessage,
        providerId,
        chatId,
        messageId,
        message,
        options,
        editId
      ),
    steerPendingMessage: (providerId, chatId, messageId) =>
      transport.invoke(providerIpcChannels.steerPendingMessage, providerId, chatId, messageId),
    interruptPendingMessage: (providerId, chatId, messageId) =>
      transport.invoke(providerIpcChannels.interruptPendingMessage, providerId, chatId, messageId),
    editMessage: (providerId, chatId, messageId, message, options) =>
      transport.invoke(
        providerIpcChannels.editMessage,
        providerId,
        chatId,
        messageId,
        message,
        options
      ),
    updateChatPermissions: (providerId, chatId, options) =>
      transport.invoke(providerIpcChannels.updateChatPermissions, providerId, chatId, options),
    resolveApproval: (providerId, chatId, decision) =>
      transport.invoke(providerIpcChannels.resolveApproval, providerId, chatId, decision),
    resolveUserInput: (providerId, chatId, requestId, response, options) =>
      transport.invoke(
        providerIpcChannels.resolveUserInput,
        providerId,
        chatId,
        requestId,
        response,
        options
      ),
    compactChat: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.compactChat, providerId, chatId),
    prepareLinkedChatContext: (providerId, chatId, options) =>
      transport.invoke(providerIpcChannels.prepareLinkedChatContext, providerId, chatId, options),
    cancelLinkedChatContext: (operationId) =>
      transport.invoke(providerIpcChannels.cancelLinkedChatContext, operationId),
    stopChat: (providerId, chatId) =>
      transport.invoke(providerIpcChannels.stopChat, providerId, chatId),
    markChatDone: (providerId, chatId, done) =>
      transport.invoke(providerIpcChannels.markChatDone, providerId, chatId, done),
    markChatsDone: (chatIds) => transport.invoke(providerIpcChannels.markChatsDone, chatIds),
    getCwdNotes: (providerId, cwd) =>
      transport.invoke(providerIpcChannels.getCwdNotes, providerId, cwd),
    setCwdNotes: (providerId, cwd, notes) =>
      transport.invoke(providerIpcChannels.setCwdNotes, providerId, cwd, notes),
    markChatSeen: (providerId, chatId, seenUpdatedAt) =>
      transport.invoke(providerIpcChannels.markChatSeen, providerId, chatId, seenUpdatedAt),
    setChatPinned: (providerId, chatId, pinned) =>
      transport.invoke(providerIpcChannels.setChatPinned, providerId, chatId, pinned),
    setChatOrder: (chatIds) => transport.invoke(providerIpcChannels.setChatOrder, chatIds),
    setViewedChat: (providerId, chatId) =>
      transport.send(providerIpcChannels.viewedChatChanged, providerId, chatId),
    acknowledgeChatUpdate: (sequence, detailApplied) =>
      transport.send(providerIpcChannels.chatUpdateAcknowledged, sequence, detailApplied),
    onChatMetadataUpdated: (listener) => {
      const handler = (_event: unknown, metadata: Parameters<typeof listener>[0]): void =>
        listener(metadata)
      transport.on(providerIpcChannels.chatMetadataUpdated, handler)
      return () => transport.removeListener(providerIpcChannels.chatMetadataUpdated, handler)
    },
    onChatUpdated: (listener): (() => void) => {
      const handleChatUpdated = (_: unknown, event: ProviderWindowChatUpdatedEvent): void => {
        listener(event)
      }

      transport.on(providerIpcChannels.chatUpdated, handleChatUpdated)
      transport.send(providerIpcChannels.chatUpdatesReady)
      return () => {
        transport.removeListener(providerIpcChannels.chatUpdated, handleChatUpdated)
        transport.send(providerIpcChannels.chatUpdatesStopped)
      }
    }
  }

  const terminalApi: TerminalRendererApi = {
    listAgentSessions: () => transport.invoke(terminalIpcChannels.listAgentSessions),
    attachAgentSession: (sessionId, sourceId) =>
      transport.invoke(terminalIpcChannels.attachAgentSession, sessionId, sourceId),
    stopAgentSession: (id) => transport.invoke(terminalIpcChannels.stopAgentSession, id),
    dismissAgentSession: (id) => transport.invoke(terminalIpcChannels.dismissAgentSession, id),
    createSession: (options) => transport.invoke(terminalIpcChannels.createSession, options),
    runCommand: (options) => transport.invoke(terminalIpcChannels.runCommand, options),
    write: (sessionId, data) => transport.send(terminalIpcChannels.write, sessionId, data),
    resize: (sessionId, cols, rows) =>
      transport.send(terminalIpcChannels.resize, sessionId, cols, rows),
    setPaused: (sessionId, paused) =>
      transport.send(terminalIpcChannels.setPaused, sessionId, paused),
    getProcessStatus: (sessionId) =>
      transport.invoke(terminalIpcChannels.getProcessStatus, sessionId),
    closeSession: (sessionId) => transport.invoke(terminalIpcChannels.closeSession, sessionId),
    onData: (listener): (() => void) => {
      const handleData = (_: unknown, event: TerminalDataEvent): void => {
        listener(event)
      }

      transport.on(terminalIpcChannels.data, handleData)
      return () => transport.removeListener(terminalIpcChannels.data, handleData)
    },
    onExit: (listener): (() => void) => {
      const handleExit = (_: unknown, event: TerminalExitEvent): void => {
        listener(event)
      }

      transport.on(terminalIpcChannels.exit, handleExit)
      return () => transport.removeListener(terminalIpcChannels.exit, handleExit)
    }
  }

  const browserApi: BrowserRendererApi = {
    publishTabs: (snapshot) => transport.send(browserIpcChannels.publishTabs, snapshot),
    onSharedOpen: (listener) => {
      const handle = (
        _event: unknown,
        request: import('./browserSync').BrowserSharedOpenRequest
      ): void => listener(request)
      transport.on(browserIpcChannels.sharedOpen, handle)
      return () => transport.removeListener(browserIpcChannels.sharedOpen, handle)
    },
    findCookieProfiles: (options) =>
      transport.invoke(browserIpcChannels.findCookieProfiles, options),
    importCookies: (options) => transport.invoke(browserIpcChannels.importCookies, options),
    onOpenRequested: (listener): (() => void) => {
      const handleOpenRequested = (_: unknown, request: BrowserOpenRequest): void => {
        listener(request)
      }

      transport.on(browserIpcChannels.openRequested, handleOpenRequested)
      return () => transport.removeListener(browserIpcChannels.openRequested, handleOpenRequested)
    },
    onCloseActiveTabRequested: (listener): (() => void) => {
      const handleCloseActiveTabRequested = (): void => listener()

      transport.on(browserIpcChannels.closeActiveTabRequested, handleCloseActiveTabRequested)
      return () =>
        transport.removeListener(
          browserIpcChannels.closeActiveTabRequested,
          handleCloseActiveTabRequested
        )
    },
    onPageShortcutRequested: (listener): (() => void) => {
      const handlePageShortcutRequested = (_: unknown, request: BrowserPageShortcutRequest): void =>
        listener(request)

      transport.on(browserIpcChannels.pageShortcutRequested, handlePageShortcutRequested)
      return () =>
        transport.removeListener(
          browserIpcChannels.pageShortcutRequested,
          handlePageShortcutRequested
        )
    },
    resolvePageZoomScale: (options) =>
      transport.invoke(browserIpcChannels.resolvePageZoomScale, options),
    setActive: (active) => transport.send(browserIpcChannels.setActive, active),
    onAutomationOpen: (listener) => {
      const handle = (_: unknown, id: string): void => listener(id)
      transport.on(browserIpcChannels.automationOpen, handle)
      return () => transport.removeListener(browserIpcChannels.automationOpen, handle)
    },
    onAutomationRequest: (listener) => {
      const handle = (_: unknown, request: import('./browser').BrowserAutomationRequest): void =>
        listener(request)
      transport.on(browserIpcChannels.automationRequest, handle)
      return () => transport.removeListener(browserIpcChannels.automationRequest, handle)
    },
    automationReady: (ready) => transport.send(browserIpcChannels.automationReady, ready),
    automationAccept: (id) => transport.send(browserIpcChannels.automationAccept, id),
    automationRespond: (response) =>
      transport.send(browserIpcChannels.automationResponse, response),
    setAutomationVisible: (visible) =>
      transport.send(browserIpcChannels.automationVisibility, visible),
    onAutomationVisibility: (listener) => {
      const handle = (_: unknown, visible: boolean): void => listener(visible)
      transport.on(browserIpcChannels.automationVisibility, handle)
      return () => transport.removeListener(browserIpcChannels.automationVisibility, handle)
    }
  }

  const localAccessApi: LocalAccessApi = {
    getState: () => transport.invoke(localAccessChannels.getState),
    configure: (options) => transport.invoke(localAccessChannels.configure, options),
    decidePairing: (id, approve) =>
      transport.invoke(localAccessChannels.decidePairing, id, approve),
    revokeDevice: (id) => transport.invoke(localAccessChannels.revokeDevice, id),
    remoteBrowser: (request) => transport.invoke(localAccessChannels.remoteBrowser, request)
  }
  return { appApi, providerApi, terminalApi, browserApi, desktopApi, mcpAppsApi, localAccessApi }
}
