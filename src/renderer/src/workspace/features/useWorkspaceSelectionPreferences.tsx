import { useEffect, useLayoutEffect } from 'react'
import type { AppProject } from '../../../../shared/app'
import { readAccountModelPreferences } from '../../accountModelPreferences'
import {
  selectChatPreferences,
  selectionsEqual,
  updateChatPreferences
} from '../../chatModelPreferences'
import {
  getApprovalAccessOptions,
  readStoredChatMessageBoxSelections,
  readStoredMessageBoxSelections,
  writeStoredChatMessageBoxSelections,
  writeStoredMessageBoxSelections,
  type MessageBoxSelection
} from '../../messageBoxPreferences'
import { onPreferencesChanged } from '../../preferences'
import { providerApi } from '../../providerApi'
import { getFallbackModels } from '../../providerSettings'
import { appChatManualDropdownValue } from '../../settings'
import { getDefaultModel, getDefaultReasoningEffort } from '../appearanceControllerUtils'
import { getChatKey, isActiveChatStatus } from '../chatControllerUtils'
import { fallbackDefaultApprovalMode, fallbackDefaultSandboxMode } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceProviderContext } from './useWorkspaceProviderContext'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'

type WorkspaceSelectionPreferencesDependencies = {
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  projectRecordsByCwd: Map<string, AppProject>
}

export function useWorkspaceSelectionPreferences({
  providerState,
  chatState,
  provider,
  settings,
  projectRecordsByCwd
}: WorkspaceSelectionPreferencesDependencies) {
  useEffect(
    () =>
      onPreferencesChanged((keys) => {
        if (keys.has('sele:account-model-preferences:v1'))
          providerState.accountModelPreferencesRef.current = readAccountModelPreferences()
        if (keys.has('sele:message-box-selections:v2'))
          providerState.messageBoxSelectionsRef.current = readStoredMessageBoxSelections()
        if (keys.has('sele:chat-message-box-selections:v1'))
          providerState.chatMessageBoxSelectionsRef.current = readStoredChatMessageBoxSelections()
        if (
          keys.has('sele:chat-message-box-selections:v1') ||
          keys.has('sele:message-box-selections:v2')
        ) {
          const chatKey = providerState.messageBoxSelectionChatKeyRef.current
          const selection =
            (chatKey ? providerState.chatMessageBoxSelectionsRef.current[chatKey] : undefined) ??
            providerState.messageBoxSelectionsRef.current[
              providerState.messageBoxSelectionProviderRef.current
            ]
          if (selection) {
            if (selection.agentMode) providerState.setAgentMode(selection.agentMode)
            if (selection.approvalMode) providerState.setApprovalMode(selection.approvalMode)
            if (selection.sandboxMode) providerState.setSandboxMode(selection.sandboxMode)
            if (selection.model) providerState.setModel(selection.model)
            if (selection.reasoningEffort)
              providerState.setReasoningEffort(selection.reasoningEffort)
            providerState.setServiceTier(selection.serviceTier ?? null)
          }
        }
      }),
    []
  )

  const messageBoxChatKey = chatState.selectedChat ? getChatKey(chatState.selectedChat) : null

  useLayoutEffect(() => {
    const currentSelection: MessageBoxSelection = {
      agentMode: providerState.agentMode,
      approvalMode: providerState.approvalMode,
      model: providerState.model,
      reasoningEffort: providerState.reasoningEffort,
      sandboxMode: providerState.sandboxMode,
      serviceTier: providerState.serviceTier
    }
    const previousProviderId = providerState.messageBoxSelectionProviderRef.current

    const chatKey = messageBoxChatKey
    const previousChatKey = providerState.messageBoxSelectionChatKeyRef.current

    if (previousProviderId !== provider.configProviderId || previousChatKey !== chatKey) {
      let preferencesChanged = false
      if (
        previousChatKey &&
        !selectionsEqual(
          providerState.chatMessageBoxSelectionsRef.current[previousChatKey],
          currentSelection
        )
      ) {
        providerState.chatMessageBoxSelectionsRef.current[previousChatKey] = currentSelection
        preferencesChanged = true
      }
      const nextSelections = providerState.messageBoxSelectionsRef.current
      const nextSelection = selectChatPreferences(
        providerState.chatMessageBoxSelectionsRef.current,
        nextSelections,
        provider.configProviderId,
        chatKey,
        chatKey && !previousChatKey && previousProviderId === provider.configProviderId
          ? currentSelection
          : undefined
      )
      const fallbackModels = getFallbackModels(provider.configProviderId)
      const nextModel =
        fallbackModels.find((candidateModel) => candidateModel.id === nextSelection.model) ??
        getDefaultModel(fallbackModels)

      providerState.messageBoxSelectionsRef.current = nextSelections
      providerState.messageBoxSelectionProviderRef.current = provider.configProviderId
      providerState.messageBoxSelectionChatKeyRef.current = chatKey
      providerState.modelManuallySelectedRef.current = Boolean(nextSelection.model)
      providerState.reasoningManuallySelectedRef.current = Boolean(nextSelection.reasoningEffort)
      providerState.approvalModeManuallySelectedRef.current = Boolean(nextSelection.approvalMode)
      providerState.sandboxModeManuallySelectedRef.current = Boolean(nextSelection.sandboxMode)
      providerState.approvalModeBeforeFullAccessRef.current = null

      const restoredSelection: MessageBoxSelection = {
        agentMode: nextSelection.agentMode ?? 'interactive',
        approvalMode: nextSelection.approvalMode ?? fallbackDefaultApprovalMode,
        sandboxMode: nextSelection.sandboxMode ?? fallbackDefaultSandboxMode,
        model: nextSelection.model ?? nextModel.id,
        reasoningEffort: nextSelection.reasoningEffort ?? getDefaultReasoningEffort(nextModel),
        serviceTier: nextSelection.serviceTier ?? null
      }
      providerState.lastMessageBoxSelectionRef.current = restoredSelection
      if (
        chatKey &&
        !selectionsEqual(
          providerState.chatMessageBoxSelectionsRef.current[chatKey],
          restoredSelection
        )
      ) {
        providerState.chatMessageBoxSelectionsRef.current[chatKey] = restoredSelection
        preferencesChanged = true
      }
      if (preferencesChanged) {
        writeStoredChatMessageBoxSelections(providerState.chatMessageBoxSelectionsRef.current)
      }
      // This layout effect runs while a chat switch still has a transition pending,
      // so React can't skip even unchanged values: any call forces another full
      // workspace render before the first paint. Only set what actually changes.
      if (restoredSelection.agentMode !== providerState.agentMode)
        providerState.setAgentMode(restoredSelection.agentMode)
      if (restoredSelection.approvalMode !== providerState.approvalMode) {
        providerState.setApprovalMode(restoredSelection.approvalMode)
      }
      if (restoredSelection.sandboxMode !== providerState.sandboxMode) {
        providerState.setSandboxMode(restoredSelection.sandboxMode)
      }
      if (restoredSelection.model !== providerState.model)
        providerState.setModel(restoredSelection.model)
      if (restoredSelection.reasoningEffort !== providerState.reasoningEffort) {
        providerState.setReasoningEffort(restoredSelection.reasoningEffort)
      }
      if (restoredSelection.serviceTier !== providerState.serviceTier) {
        providerState.setServiceTier(restoredSelection.serviceTier)
      }
      return
    }

    // Restoring a chat is navigation, not a dropdown change to propagate.
    if (selectionsEqual(providerState.lastMessageBoxSelectionRef.current, currentSelection)) return
    const previousSelection = providerState.lastMessageBoxSelectionRef.current
    providerState.lastMessageBoxSelectionRef.current = currentSelection
    if (
      chatState.selectedChat &&
      previousSelection &&
      isActiveChatStatus(
        chatState.chatDetailRef.current?.status ?? chatState.selectedChat.status
      ) &&
      (previousSelection.approvalMode !== currentSelection.approvalMode ||
        previousSelection.sandboxMode !== currentSelection.sandboxMode)
    ) {
      const access =
        settings.effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
          ? currentSelection.sandboxMode
          : settings.effectiveAppSettings.chat.forceAccess
      const review =
        settings.effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
          ? currentSelection.approvalMode
          : settings.effectiveAppSettings.chat.forceReview
      const project = projectRecordsByCwd.get(
        chatState.selectedChat.projectCwd ?? chatState.selectedChat.cwd ?? ''
      )
      void providerApi
        .updateChatPermissions(chatState.selectedChat.providerId, chatState.selectedChat.id, {
          ...getApprovalAccessOptions(review, access),
          sandboxMode: access,
          additionalDirectories: project ? [project.cwd, ...project.additionalCwds] : undefined
        })
        .catch((error) => console.error('Unable to update active chat permissions.', error))
    }
    providerState.chatMessageBoxSelectionsRef.current = updateChatPreferences(
      providerState.chatMessageBoxSelectionsRef.current,
      chatKey,
      currentSelection,
      settings.effectiveAppSettings.chat.updateExistingChats
        ? chatState.chatsRef.current
            .filter((chat) => chat.providerId === provider.configProviderId)
            .map(getChatKey)
        : []
    )
    writeStoredChatMessageBoxSelections(providerState.chatMessageBoxSelectionsRef.current)

    if (!chatKey || settings.effectiveAppSettings.chat.updateNewChats) {
      const nextSelections = {
        ...providerState.messageBoxSelectionsRef.current,
        [provider.configProviderId]: currentSelection
      }
      providerState.messageBoxSelectionsRef.current = nextSelections
      writeStoredMessageBoxSelections(nextSelections)
    }
  }, [
    providerState.agentMode,
    providerState.approvalMode,
    provider.configProviderId,
    messageBoxChatKey,
    providerState.model,
    providerState.reasoningEffort,
    providerState.sandboxMode,
    providerState.serviceTier,
    settings.effectiveAppSettings.chat.updateExistingChats,
    settings.effectiveAppSettings.chat.updateNewChats
  ])

  useEffect(() => {
    if (
      providerState.sandboxMode !== 'danger-full-access' ||
      providerState.approvalMode === 'never'
    )
      return

    providerState.approvalModeBeforeFullAccessRef.current = providerState.approvalMode
    queueMicrotask(() => providerState.setApprovalMode('never'))
  }, [providerState.approvalMode, providerState.sandboxMode])
  return {}
}
