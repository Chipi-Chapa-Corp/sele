// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { useCallback, useEffect, useRef } from 'react'
import { isNoProjectChat, isNoProjectCwd, noProjectGroupKey } from '../../../shared/noProject'
import type { AppSelectedAttachment } from '../../../shared/app'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderId,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderActiveSendMode,
  ProviderApprovalDecision,
  ProviderReview,
  ProviderAppInput,
  ProviderSkillInput,
  ProviderTurnOptions,
  ProviderUserInputResponse
} from '../../../shared/provider'
import { unloadWorkingStepItems } from '../../../shared/chatTurns'
import { providerOneShotGenerationCanceledMessage } from '../../../shared/provider'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
import { getComposerDraftScopeKey } from '../composerDraft'
import { moveComposerDraftScope, updateStoredComposerDrafts } from '../composerDraftStorage'
import { getContainerTargetKey } from '../containerSelection'
import { getAppGitCommitModel } from '../gitCommitModels'
import { getApprovalAccessOptions } from '../messageBoxPreferences'
import {
  hasProviderUserMessage,
  mergeWorkingStepPage,
  mergeWorkingToolPage
} from '../chatDetailWindow'
import {
  chatWorkingItemPageSize,
  chatWorkingItemWindowSize,
  chatWorkingToolPageSize,
  chatWorkingToolWindowSize,
  loadedWorkingStepCacheSize
} from './controllerTypes'
import {
  getDefaultModel,
  getDefaultReasoningEffort,
  modelHasReasoningEffortOptions
} from './appearanceControllerUtils'
import {
  getChatCwdGroupKey,
  getChatGroupKey,
  getChatKey,
  getErrorMessage,
  getOptimisticItems,
  getWorktreeBranchGenerationPrompt,
  modelSupportsReasoningEffort,
  modelSupportsServiceTier,
  normalizeGeneratedWorktreeName,
  serializeComposerMessage,
  serializeReviewMessage
} from './chatControllerUtils'
import type { ChatMessagingControllerDependencies } from './featureControllerDependencies'
import type { SubagentChatView } from './controllerTypes'

// Return shape is inferred from the controller declarations below.
export function useChatMessagingController(dependencies: ChatMessagingControllerDependencies) {
  const {
    authenticationRequired,
    messageBoxSelection,
    rememberStartedChatSelection,
    chatDetail,
    sendInFlightRef,
    setSendState,
    setEditingMessage,
    selectedChatId,
    models,
    changesProjectCwd,
    projectRecordsByCwd,
    agentMode,
    effectiveApprovalMode,
    effectiveSandboxMode,
    changesContainer,
    changesCwd,
    effectiveModel,
    selectedEffectiveModel,
    effectiveReasoningEffort,
    effectiveServiceTier,
    effectiveAppSettings,
    configProviderId,
    configProviderContainerKey,
    worktreeCreationCanceledRef,
    setWorktreeCreationState,
    worktreeBranchGenerationRef,
    providerUpdateInProgress,
    activeSubagentChatView,
    setSubagentChatView,
    selectedChat,
    newSessionCwd,
    newSessionNoProject,
    sendInFlightProjectKeyRef,
    setSendInFlightProjectKey,
    chatAutoScrollEnabledRef,
    setChatAtConversationBottom,
    scrollToLatestTurnAfterRenderRef,
    editingMessage,
    applyViewedChatDetail,
    handleSendFailure,
    newSessionProvider,
    newSessionLocation,
    defaultCwd,
    rememberProject,
    chatHasActiveTurn,
    applyChatSummary,
    markChatSeenAt,
    selectedChatKeyRef,
    setContinuedStoppedWorkingStepsByChat,
    runPromptActionRef,
    selectedChatRef,
    chatDetailRef,
    loadedWorkingStepIdsRef,
    setChatDetail,
    selectedProviderId,
    approvalResolution,
    setApprovalResolution,
    applyChatDetail,
    pendingApproval,
    approvalDecisionInFlight,
    pendingUserInput,
    userInputResolving,
    setUserInputResolution,
    sendState
  } = dependencies

  const editRequestRef = useRef(0)
  const editOpeningRef = useRef(false)
  type PendingEditSession = {
    providerId: ProviderId
    chatId: string
    messageId: string
    editId: string
    ready: Promise<ProviderChatDetail>
    phase: 'opening' | 'editing' | 'saving'
  }
  const pendingEditRef = useRef<PendingEditSession | null>(null)
  const releasePendingEdit = async (session: PendingEditSession): Promise<ProviderChatDetail> => {
    // A failed begin was already released by the main process; just refresh the chat.
    if (
      !(await session.ready.then(
        () => true,
        () => false
      ))
    )
      return providerApi.getChat(session.providerId, session.chatId)
    return providerApi.cancelPendingMessageEdit(
      session.providerId,
      session.chatId,
      session.messageId,
      session.editId
    )
  }
  useEffect(() => {
    editRequestRef.current += 1
    return () => {
      editRequestRef.current += 1
      const session = pendingEditRef.current
      if (session) {
        pendingEditRef.current = null
        void releasePendingEdit(session).catch((error) =>
          console.error('Unable to release pending message edit.', error)
        )
      }
    }
  }, [selectedChatId, selectedChat?.providerId])
  useEffect(() => {
    const session = pendingEditRef.current
    if (
      session?.phase === 'editing' &&
      (!editingMessage || editingMessage.id !== session.messageId)
    ) {
      pendingEditRef.current = null
      void releasePendingEdit(session).catch((error) =>
        console.error('Unable to release pending message edit.', error)
      )
    }
  }, [editingMessage])
  const prepareEditAttachments = async (
    message: ProviderMessage | ProviderPendingMessage
  ): Promise<AppSelectedAttachment[] | null> => {
    const request = ++editRequestRef.current
    const chatKey = selectedChatKeyRef.current
    try {
      const attachments = await appApi.prepareMessageAttachments(message.attachments ?? [], {
        container: changesContainer,
        cwd: changesCwd
      })
      return request === editRequestRef.current && chatKey === selectedChatKeyRef.current
        ? attachments
        : null
    } catch (error) {
      console.error('Unable to load attachments for editing.', error)
      if (request === editRequestRef.current && chatKey === selectedChatKeyRef.current)
        handleSendFailure(error, 'Unable to load message attachments.')
      return null
    }
  }
  const handleEditMessage = useCallback(
    async (message: ProviderMessage): Promise<void> => {
      if (
        message.role !== 'user' ||
        message.editTargetId === null ||
        !chatDetail?.capabilities.editMessages ||
        sendInFlightRef.current
      ) {
        return
      }

      const attachments = await prepareEditAttachments(message)
      if (!attachments || sendInFlightRef.current) return
      setSendState('idle')
      setEditingMessage({
        attachments,
        type: 'message',
        id: message.id,
        targetId: message.editTargetId ?? message.id,
        content: message.content
      })
    },
    [chatDetail?.capabilities.editMessages, changesContainer, changesCwd]
  )
  const handleEditPendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (!selectedChat || sendInFlightRef.current || editOpeningRef.current) return
      editOpeningRef.current = true
      const chatKey = selectedChatKeyRef.current
      const editProviderId = selectedChat.providerId
      const editChatId = selectedChat.id
      let session: PendingEditSession | null = null
      let opened = false
      try {
        const previous = pendingEditRef.current
        if (previous) {
          await releasePendingEdit(previous)
          if (pendingEditRef.current === previous) pendingEditRef.current = null
          setEditingMessage(null)
        }
        if (chatKey !== selectedChatKeyRef.current) return
        const editId = crypto.randomUUID()
        session = {
          providerId: selectedChat.providerId,
          chatId: selectedChat.id,
          messageId: message.id,
          editId,
          phase: 'opening',
          ready: providerApi.beginPendingMessageEdit(
            selectedChat.providerId,
            selectedChat.id,
            message.id,
            editId
          )
        }
        pendingEditRef.current = session
        const detail = await session.ready
        opened = true
        if (pendingEditRef.current !== session || chatKey !== selectedChatKeyRef.current) return
        const current = detail.items.find(
          (item): item is ProviderPendingMessage =>
            item.type === 'pendingMessage' && item.id === message.id
        )
        if (!current) throw new Error('The message is no longer pending.')
        // The provider may accept the message while the editor opens; the main process then
        // reports the settled chat instead of a hold, so never open an editor that cannot save.
        if (current.editable === false) {
          const refreshed = await releasePendingEdit(session).catch(() => detail)
          if (pendingEditRef.current === session) pendingEditRef.current = null
          if (chatKey === selectedChatKeyRef.current)
            applyViewedChatDetail(session.providerId, refreshed, { allowEqualRevision: true })
          return
        }
        const attachments = await prepareEditAttachments(current)
        if (
          !attachments ||
          sendInFlightRef.current ||
          pendingEditRef.current !== session ||
          chatKey !== selectedChatKeyRef.current
        ) {
          await releasePendingEdit(session)
          if (pendingEditRef.current === session) pendingEditRef.current = null
          return
        }
        applyViewedChatDetail(session.providerId, detail)
        session.phase = 'editing'
        setSendState('idle')
        setEditingMessage({
          attachments,
          type: 'pending',
          id: current.id,
          kind: current.kind,
          content: current.content,
          editId
        })
      } catch (error) {
        if (session && pendingEditRef.current === session) {
          pendingEditRef.current = null
          if (opened)
            void releasePendingEdit(session).catch((releaseError) =>
              console.error('Unable to release failed edit.', releaseError)
            )
        }
        if (chatKey === selectedChatKeyRef.current) {
          const detail = await providerApi.getChat(editProviderId, editChatId).catch(() => null)
          if (detail) applyViewedChatDetail(editProviderId, detail, { allowEqualRevision: true })
          // The provider accepted the message while the editor was opening: it is now a normal
          // pending message, which is not an error worth interrupting the user over.
          if (
            detail &&
            !detail.items.some((item) => item.type === 'pendingMessage' && item.id === message.id)
          )
            return
          handleSendFailure(error, 'Unable to edit pending message.')
        }
      } finally {
        editOpeningRef.current = false
      }
    },
    [selectedChat, changesContainer, changesCwd]
  )
  const handleCancelEditMessage = useCallback(async (): Promise<void> => {
    if (sendInFlightRef.current) return
    editRequestRef.current += 1
    const session = pendingEditRef.current
    try {
      if (session) {
        const detail = await releasePendingEdit(session)
        if (pendingEditRef.current !== session) return
        pendingEditRef.current = null
        applyViewedChatDetail(session.providerId, detail)
      }
      setSendState('idle')
      setEditingMessage(null)
    } catch (error) {
      handleSendFailure(error, 'Unable to resume pending message.')
    }
  }, [])
  const normalizeTurnOptionsForModels = useCallback(
    (turnOptions: ProviderTurnOptions): ProviderTurnOptions => {
      const resolvedModel =
        models.find((candidateModel) => candidateModel.id === turnOptions.model) ??
        getDefaultModel(models)
      const {
        reasoningEffort: configuredReasoningEffort,
        serviceTier: configuredServiceTier,
        ...remainingOptions
      } = turnOptions
      const reasoningEffort = modelHasReasoningEffortOptions(resolvedModel)
        ? modelSupportsReasoningEffort(resolvedModel, configuredReasoningEffort)
          ? configuredReasoningEffort
          : getDefaultReasoningEffort(resolvedModel)
        : undefined
      const serviceTier = modelSupportsServiceTier(resolvedModel, configuredServiceTier)
        ? configuredServiceTier
        : (resolvedModel.defaultServiceTier ?? null)

      return {
        ...remainingOptions,
        networkRetry: {
          count: effectiveAppSettings.chat.networkRetryCount,
          delaySeconds: effectiveAppSettings.chat.networkRetryDelaySeconds
        },
        model: resolvedModel.id,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        serviceTier
      }
    },
    [
      models,
      effectiveAppSettings.chat.networkRetryCount,
      effectiveAppSettings.chat.networkRetryDelaySeconds
    ]
  )
  const currentProject = changesProjectCwd ? projectRecordsByCwd.get(changesProjectCwd) : undefined
  const currentProjectDirectories = currentProject
    ? [currentProject.cwd, ...currentProject.additionalCwds]
    : undefined
  const getCurrentTurnOptions = (): ProviderTurnOptions =>
    normalizeTurnOptionsForModels({
      additionalDirectories: currentProjectDirectories,
      agentMode,
      ...getApprovalAccessOptions(effectiveApprovalMode, effectiveSandboxMode),
      container: changesContainer,
      cwd: changesCwd ?? undefined,
      model: effectiveModel,
      ...(modelHasReasoningEffortOptions(selectedEffectiveModel)
        ? { reasoningEffort: effectiveReasoningEffort }
        : {}),
      sandboxMode: effectiveSandboxMode,
      ...(configProviderId === 'codex'
        ? {
            showRecommendedPlugins: effectiveAppSettings.providers.codex.showRecommendedPlugins
          }
        : {}),
      serviceTier: effectiveServiceTier
    })
  const getGitTurnOptions = (): ProviderTurnOptions => {
    const commitModel = getAppGitCommitModel(
      effectiveAppSettings.git.commitModels,
      configProviderId,
      configProviderContainerKey
    )
    const turnOptions = getCurrentTurnOptions()
    if (!commitModel) return turnOptions

    const selectedCommitModel = models.find((candidateModel) => candidateModel.id === commitModel)
    const resolvedCommitModel = selectedCommitModel ?? getDefaultModel(models)

    return normalizeTurnOptionsForModels({
      ...turnOptions,
      model: resolvedCommitModel.id,
      serviceTier: turnOptions.serviceTier
    })
  }
  const handleCancelWorktreeCreation = useCallback(async (): Promise<void> => {
    worktreeCreationCanceledRef.current = true
    setWorktreeCreationState('canceling')

    const generation = worktreeBranchGenerationRef.current
    if (!generation) return

    await providerApi
      .cancelOneShot(generation.providerId, generation.generationId)
      .catch((error) => {
        console.error('[caught:useChatMessagingController:useChatMessagingController]', error)
      })
  }, [])
  const handleSendSubagentMessage = async (
    message: string,
    hasUnsupportedInput: boolean
  ): Promise<boolean> => {
    const view = activeSubagentChatView
    const content = message.trim()
    if (!view?.summary.canMessage || !selectedProviderId || !selectedChatId || !content) {
      return false
    }
    const subagentId = view.summary.id
    const rootChatKey = view.rootChatKey
    const updateView = (update: (current: SubagentChatView) => SubagentChatView): void =>
      setSubagentChatView((current) =>
        current?.rootChatKey === rootChatKey && current.summary.id === subagentId
          ? update(current)
          : current
      )
    if (hasUnsupportedInput) {
      updateView((current) => ({
        ...current,
        error: 'Subagents accept text messages only.'
      }))
      return false
    }
    sendInFlightRef.current = true
    setSendState('sending')
    try {
      await providerApi.sendSubagentMessage(selectedProviderId, selectedChatId, subagentId, content)
      updateView((current) => ({
        ...current,
        summary: {
          ...current.summary,
          status: 'running',
          updatedAt: Date.now()
        },
        error: null,
        refreshRequest: (current.refreshRequest ?? 0) + 1
      }))
      return true
    } catch (error) {
      console.error('[caught:useChatMessagingController:handleSendSubagentMessage]', error)
      updateView((current) => ({
        ...current,
        error: getErrorMessage(error, 'Unable to message this subagent.')
      }))
      return false
    } finally {
      sendInFlightRef.current = false
      setSendState('idle')
    }
  }

  const handleSendMessage = async (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments: AppSelectedAttachment[] = [],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills: ProviderSkillInput[] = [],
    apps: ProviderAppInput[] = [],
    turnOptionsOverride?: ProviderTurnOptions,
    sendTarget?: 'current' | 'new',
    initialGoal?: string
  ): Promise<boolean> => {
    if (
      (configProviderId === 'opencode' && !selectedEffectiveModel) ||
      providerUpdateInProgress ||
      sendInFlightRef.current ||
      authenticationRequired ||
      (chatDetailRef.current?.historyPreview && sendTarget !== 'new') ||
      (chatDetailRef.current?.authenticationRequired && sendTarget !== 'new') ||
      (activeSubagentChatView && sendTarget !== 'new' && !activeSubagentChatView.summary.canMessage)
    ) {
      return false
    }
    if (activeSubagentChatView && sendTarget !== 'new') {
      return handleSendSubagentMessage(
        message,
        attachments.length > 0 || Boolean(review) || skills.length > 0 || apps.length > 0
      )
    }
    const sendProjectKey = selectedChat
      ? getChatGroupKey(selectedChat)
      : newSessionNoProject
        ? noProjectGroupKey
        : getChatCwdGroupKey(newSessionCwd)
    const finishSendInFlight = (): void => {
      sendInFlightRef.current = false
      if (sendInFlightProjectKeyRef.current === sendProjectKey) {
        sendInFlightProjectKeyRef.current = null
      }
      setSendInFlightProjectKey((currentKey) => (currentKey === sendProjectKey ? null : currentKey))
    }

    sendInFlightRef.current = true
    sendInFlightProjectKeyRef.current = sendProjectKey
    setSendInFlightProjectKey(sendProjectKey)
    chatAutoScrollEnabledRef.current = true
    setChatAtConversationBottom(true)
    scrollToLatestTurnAfterRenderRef.current = true
    const messageWithComposerMentions = serializeComposerMessage(message, skills, apps)
    const serializedMessage = review
      ? serializeReviewMessage(messageWithComposerMentions, review)
      : messageWithComposerMentions
    const baseTurnOptions = {
      ...normalizeTurnOptionsForModels(turnOptionsOverride ?? getCurrentTurnOptions()),
      review: review
        ? {
            ...review,
            prompt: messageWithComposerMentions.trim()
          }
        : undefined,
      skills: skills.length > 0 ? skills : undefined
    }
    const imagePaths = attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => attachment.path)
    const filePaths = attachments
      .filter((attachment) => attachment.kind === 'file')
      .map((attachment) => attachment.path)
    const turnOptions =
      attachments.length > 0 || editingMessage
        ? {
            ...baseTurnOptions,
            files: filePaths.map((path) => ({ path })),
            images: imagePaths.map((path) => ({ path }))
          }
        : baseTurnOptions

    if (editingMessage && !sendTarget) {
      if (!selectedChat) {
        finishSendInFlight()
        return false
      }

      setSendState('sending')
      const pendingEdit = pendingEditRef.current
      if (pendingEdit) pendingEdit.phase = 'saving'

      try {
        const detail =
          editingMessage.type === 'pending'
            ? await providerApi.editPendingMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.id,
                serializedMessage,
                turnOptions,
                editingMessage.editId
              )
            : await providerApi.editMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.targetId,
                serializedMessage,
                turnOptions
              )
        applyViewedChatDetail(selectedChat.providerId, detail)
        if (pendingEditRef.current === pendingEdit) pendingEditRef.current = null
        setEditingMessage(null)
        setSendState('idle')
        return true
      } catch (error) {
        console.error('[caught:useChatMessagingController:handleSendMessage]', error)
        if (pendingEdit && pendingEditRef.current === pendingEdit) pendingEdit.phase = 'editing'
        handleSendFailure(error, 'Unable to edit message.')
        return false
      } finally {
        finishSendInFlight()
      }
    }

    if (!selectedChat || sendTarget === 'new') {
      setSendState('sending')

      try {
        const startingSelectedChat = sendTarget === 'new' ? selectedChat : null
        const startingProviderId = startingSelectedChat?.providerId ?? newSessionProvider
        const startingCwd = startingSelectedChat ? changesProjectCwd : newSessionCwd
        const noProject =
          isNoProjectChat(startingSelectedChat) ||
          isNoProjectCwd(startingCwd) ||
          (!startingSelectedChat && newSessionNoProject)
        let sessionCwd = startingCwd ?? undefined

        if (!startingSelectedChat && !newSessionNoProject && newSessionLocation === 'worktree') {
          if (!newSessionCwd) throw new Error('Choose a folder before creating a worktree.')

          const generationId = crypto.randomUUID()
          worktreeCreationCanceledRef.current = false
          worktreeBranchGenerationRef.current = { generationId, providerId: newSessionProvider }
          setWorktreeCreationState('creating')

          const generatedName = await providerApi.generateOneShot(
            newSessionProvider,
            getWorktreeBranchGenerationPrompt(
              messageWithComposerMentions.trim() || serializedMessage.trim() || 'File attachment',
              effectiveAppSettings.git.worktree
            ),
            {
              ...getGitTurnOptions(),
              cwd: newSessionCwd,
              generationId
            }
          )
          if (worktreeCreationCanceledRef.current) {
            setSendState('idle')
            if (initialGoal) throw new Error('Worktree creation was canceled.')
            return true
          }

          const worktreeName = normalizeGeneratedWorktreeName(generatedName)
          if (!worktreeName) throw new Error('AI did not return a branch name.')

          const worktree = await appApi.createGitWorktree({
            container: changesContainer,
            cwd: newSessionCwd,
            name: worktreeName
          })
          if (worktreeCreationCanceledRef.current) {
            setSendState('idle')
            if (initialGoal) throw new Error('Worktree creation was canceled.')
            return true
          }

          sessionCwd = worktree.worktreePath
        }

        const detail = await providerApi.startChat(startingProviderId, serializedMessage, {
          ...turnOptions,
          ...(initialGoal ? { initialGoal } : {}),
          noProject,
          cwd: noProject ? undefined : sessionCwd,
          additionalDirectories: noProject ? undefined : turnOptions.additionalDirectories
        })
        rememberStartedChatSelection(startingProviderId, detail.id, messageBoxSelection)
        const startedChatKey = getChatKey({ providerId: startingProviderId, id: detail.id })
        if (!selectedChat) {
          const workspaceKey = `${getContainerTargetKey(changesContainer)}\0${newSessionCwd ?? ''}`
          updateStoredComposerDrafts((state) =>
            moveComposerDraftScope(
              state,
              getComposerDraftScopeKey(null, workspaceKey),
              startedChatKey
            )
          )
        }
        applyViewedChatDetail(
          startingProviderId,
          !initialGoal && !hasProviderUserMessage(detail.items)
            ? {
                ...detail,
                items: getOptimisticItems([], messageWithComposerMentions, attachments, review)
              }
            : detail,
          { select: true }
        )
        // The provider starts producing events before startChat resolves. Until this chat is
        // selected, the main process intentionally delivers those events as sidebar-only
        // summaries, so a quick response can finish without ever sending its transcript to the
        // renderer. Select it immediately (rather than waiting for the React selection effect),
        // then read the current snapshot once to recover any events from that startup window.
        providerApi.setViewedChat(startingProviderId, detail.id)
        void providerApi
          .getChat(startingProviderId, detail.id)
          .then((latestDetail) => {
            if (selectedChatKeyRef.current !== startedChatKey) return
            applyViewedChatDetail(startingProviderId, latestDetail, { allowEqualRevision: true })
          })
          .catch((error) => {
            console.error('[caught:useChatMessagingController:handleSendMessage]', error)

            // Live updates continue normally; reopening the chat remains a manual recovery path.
          })
        if (startingCwd?.trim() && startingCwd.trim() === defaultCwd?.trim()) {
          void rememberProject(startingCwd)
        }
        setSendState('idle')
        return true
      } catch (error) {
        console.error('[caught:useChatMessagingController:handleSendMessage]', error)
        // Keep the goal dialog open with the native error so its draft can be retried.
        if (initialGoal) {
          setSendState('idle')
          throw error
        }
        if (
          worktreeCreationCanceledRef.current ||
          (error instanceof Error && error.message === providerOneShotGenerationCanceledMessage)
        ) {
          setSendState('idle')
          return true
        } else {
          handleSendFailure(error, 'Unable to start chat.')
          return false
        }
      } finally {
        worktreeBranchGenerationRef.current = null
        worktreeCreationCanceledRef.current = false
        setWorktreeCreationState('idle')
        finishSendInFlight()
      }
    }

    const providerId = selectedChat.providerId
    const chatId = selectedChat.id
    setSendState('sending')

    if (chatHasActiveTurn && chatDetail?.capabilities.activeMessages) {
      try {
        const summary = await providerApi.sendActiveChatMessageSummary(
          providerId,
          chatId,
          serializedMessage,
          activeMode ?? 'queue',
          turnOptions
        )
        applyChatSummary(providerId, summary, false)
        // Reading the clock happens only after the asynchronous send completes.
        markChatSeenAt(providerId, chatId, Date.now())
        setSendState('idle')
        return true
      } catch (error) {
        console.error('[caught:useChatMessagingController:handleSendMessage]', error)
        handleSendFailure(error, 'Unable to send message.')
        return false
      } finally {
        finishSendInFlight()
      }
    }

    if (chatDetail?.id === chatId) {
      applyViewedChatDetail(
        providerId,
        {
          ...chatDetail,
          status: 'active',
          contextUsage: chatDetail.contextUsage,
          tokenUsage: chatDetail.tokenUsage,
          items: getOptimisticItems(
            chatDetail.items,
            messageWithComposerMentions,
            attachments,
            review
          )
        },
        { allowEqualRevision: true }
      )
    }

    try {
      const summary = await providerApi.continueChatSummary(
        providerId,
        chatId,
        serializedMessage,
        turnOptions
      )
      applyChatSummary(providerId, summary, false)
      // Reading the clock happens only after the asynchronous send completes.
      markChatSeenAt(providerId, chatId, Date.now())
      setSendState('idle')
      return true
    } catch (error) {
      console.error('[caught:useChatMessagingController:handleSendMessage]', error)
      void providerApi
        .getChat(providerId, chatId)
        .then((detail) => applyViewedChatDetail(providerId, detail, { allowEqualRevision: true }))
        .catch((error) => {
          console.error('[caught:useChatMessagingController:handleSendMessage]', error)
        })
      handleSendFailure(error, 'Unable to send message.')
      return false
    } finally {
      finishSendInFlight()
    }
  }

  const handleStartGoalChat = async (objective: string): Promise<void> => {
    const goal = objective.trim()
    if (!goal) throw new Error('Enter a goal description.')
    if (selectedChat) throw new Error('Select a new chat before starting a goal.')
    const started = await handleSendMessage(
      goal,
      undefined,
      [],
      null,
      [],
      [],
      undefined,
      'new',
      goal
    )
    if (!started)
      throw new Error('Unable to start a goal right now. Try again when the chat is ready.')
  }

  const handleContinueStoppedTurn = useCallback(
    async (workingStepId: string, prompt: string): Promise<void> => {
      if (chatDetailRef.current?.authenticationRequired || chatDetailRef.current?.historyPreview)
        return
      const chatKey = selectedChatKeyRef.current
      if (chatKey) {
        setContinuedStoppedWorkingStepsByChat((currentStepsByChat) => {
          const currentStepIds = currentStepsByChat[chatKey] ?? []
          if (currentStepIds.includes(workingStepId)) return currentStepsByChat

          return {
            ...currentStepsByChat,
            [chatKey]: [...currentStepIds, workingStepId]
          }
        })
      }

      await runPromptActionRef.current(prompt, 'current')
    },
    []
  )
  const handleLoadWorkingStep = useCallback(
    async (workingStepId: string, requestedStartIndex?: number): Promise<void> => {
      const chat = selectedChatRef.current
      if (!chat) throw new Error('No chat selected')

      const chatKey = getChatKey(chat)
      const currentWorkingStep = chatDetailRef.current?.items.find(
        (item): item is ProviderWorkingStep => item.type === 'working' && item.id === workingStepId
      )
      const totalCount = currentWorkingStep?.itemCount ?? currentWorkingStep?.items.length ?? 0
      const startIndex = Math.max(
        0,
        requestedStartIndex ?? Math.max(0, totalCount - chatWorkingItemPageSize)
      )
      const page = await providerApi.getChatWorkingStepPage(
        chat.providerId,
        chat.id,
        workingStepId,
        startIndex,
        chatWorkingItemPageSize
      )
      if (selectedChatKeyRef.current !== chatKey) return

      const nextLoadedStepIds = [
        ...loadedWorkingStepIdsRef.current.filter((id) => id !== workingStepId),
        workingStepId
      ].slice(-loadedWorkingStepCacheSize)
      loadedWorkingStepIdsRef.current = nextLoadedStepIds
      const retainedLoadedStepIds = new Set(nextLoadedStepIds)

      setChatDetail((currentDetail) => {
        if (currentDetail?.id !== chat.id) return currentDetail

        const itemIndex = currentDetail.items.findIndex((item) => item.id === workingStepId)
        const currentItem = currentDetail.items[itemIndex]
        if (currentItem?.type !== 'working') return currentDetail

        const mergedWorkingStep = mergeWorkingStepPage(
          currentItem,
          page,
          chatWorkingItemPageSize,
          chatWorkingItemWindowSize
        )

        const items = currentDetail.items.map((item, index) => {
          if (index === itemIndex && item.type === 'working') return mergedWorkingStep
          if (
            item.type === 'working' &&
            item.itemsLoaded !== false &&
            item.status !== 'working' &&
            !retainedLoadedStepIds.has(item.id)
          ) {
            return unloadWorkingStepItems(item)
          }
          return item
        })
        const nextDetail = { ...currentDetail, items }
        chatDetailRef.current = nextDetail
        return nextDetail
      })
    },
    []
  )
  const handleLoadWorkingToolPage = useCallback(
    async (workingStepId: string, workingItemId: string, startIndex: number): Promise<void> => {
      const chat = selectedChatRef.current
      if (!chat) throw new Error('No chat selected')

      const chatKey = getChatKey(chat)
      const page = await providerApi.getChatWorkingToolPage(
        chat.providerId,
        chat.id,
        workingStepId,
        workingItemId,
        startIndex,
        chatWorkingToolPageSize
      )
      if (selectedChatKeyRef.current !== chatKey) return

      setChatDetail((currentDetail) => {
        if (currentDetail?.id !== chat.id) return currentDetail
        const workingStepIndex = currentDetail.items.findIndex(
          (item) => item.type === 'working' && item.id === workingStepId
        )
        const workingStep = currentDetail.items[workingStepIndex]
        if (workingStep?.type !== 'working') return currentDetail

        const mergeItem = (item: ProviderWorkingItem): ProviderWorkingItem =>
          item.type === 'toolGroup' && item.id === workingItemId
            ? mergeWorkingToolPage(item, page, chatWorkingToolWindowSize)
            : item
        const workingItems = workingStep.items.map(mergeItem)
        const itemSegments = workingStep.itemSegments?.map((segment) => ({
          ...segment,
          items: segment.items.map(mergeItem)
        }))
        const items = [...currentDetail.items]
        items[workingStepIndex] = {
          ...workingStep,
          items: workingItems,
          itemSegments
        }
        const nextDetail = { ...currentDetail, items }
        chatDetailRef.current = nextDetail
        return nextDetail
      })
    },
    []
  )
  const handleLoadWorkingItem = useCallback(
    async (workingStepId: string, workingItemId: string): Promise<void> => {
      const chat = selectedChatRef.current
      if (!chat) throw new Error('No chat selected')

      const chatKey = getChatKey(chat)
      const loadedItem = await providerApi.getChatWorkingItem(
        chat.providerId,
        chat.id,
        workingStepId,
        workingItemId
      )
      if (selectedChatKeyRef.current !== chatKey) return

      setChatDetail((currentDetail) => {
        if (currentDetail?.id !== chat.id) return currentDetail
        const workingStepIndex = currentDetail.items.findIndex(
          (item) => item.type === 'working' && item.id === workingStepId
        )
        const workingStep = currentDetail.items[workingStepIndex]
        if (workingStep?.type !== 'working') return currentDetail
        let replaced = false
        const replaceItem = (item: ProviderWorkingItem): ProviderWorkingItem => {
          if (item.id === workingItemId) {
            replaced = true
            return loadedItem
          }
          if (item.type !== 'toolGroup' || loadedItem.type !== 'tool') return item
          const toolIndex = item.tools.findIndex((tool) => tool.id === workingItemId)
          if (toolIndex < 0) return item
          const tools = [...item.tools]
          tools[toolIndex] = loadedItem
          replaced = true
          return { ...item, tools }
        }
        const workingItems = workingStep.items.map(replaceItem)
        if (!replaced) return currentDetail
        const itemSegments = workingStep.itemSegments?.map((segment) => ({
          ...segment,
          items: segment.items.map(replaceItem)
        }))
        const items = [...currentDetail.items]
        items[workingStepIndex] = { ...workingStep, items: workingItems, itemSegments }
        const nextDetail = { ...currentDetail, items }
        chatDetailRef.current = nextDetail
        return nextDetail
      })
    },
    []
  )
  const handleRetryStoppedTurn = useCallback(
    async (message: ProviderMessage): Promise<void> => {
      if (
        providerUpdateInProgress ||
        chatDetail?.authenticationRequired ||
        !selectedProviderId ||
        !selectedChatId ||
        message.editTargetId === null ||
        !chatDetail?.capabilities.editMessages ||
        sendInFlightRef.current
      ) {
        return
      }

      const attachments = message.attachments ?? []
      const imagePaths = attachments.flatMap((attachment) =>
        attachment.kind === 'image' && attachment.path ? [attachment.path] : []
      )
      const filePaths = attachments.flatMap((attachment) =>
        attachment.kind === 'file' && attachment.path ? [attachment.path] : []
      )
      const reviewAttachment = attachments.find(
        (attachment): attachment is Extract<(typeof attachments)[number], { kind: 'review' }> =>
          attachment.kind === 'review'
      )
      const review = reviewAttachment
        ? {
            id: reviewAttachment.id,
            comments: reviewAttachment.comments
          }
        : null
      const turnOptions = normalizeTurnOptionsForModels({
        additionalDirectories: currentProject
          ? [currentProject.cwd, ...currentProject.additionalCwds]
          : undefined,
        agentMode,
        ...getApprovalAccessOptions(effectiveApprovalMode, effectiveSandboxMode),
        container: changesContainer,
        cwd: changesCwd ?? undefined,
        model: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
        sandboxMode: effectiveSandboxMode,
        serviceTier: effectiveServiceTier,
        review: review
          ? {
              ...review,
              prompt: message.content
            }
          : undefined,
        images: imagePaths.length > 0 ? imagePaths.map((path) => ({ path })) : undefined,
        files: filePaths.length > 0 ? filePaths.map((path) => ({ path })) : undefined
      })

      const retryProjectKey = selectedChat
        ? getChatGroupKey(selectedChat)
        : getChatCwdGroupKey(changesProjectCwd ?? changesCwd)
      sendInFlightRef.current = true
      sendInFlightProjectKeyRef.current = retryProjectKey
      setSendInFlightProjectKey(retryProjectKey)
      chatAutoScrollEnabledRef.current = true
      setSendState('sending')

      try {
        const detail = await providerApi.editMessage(
          selectedProviderId,
          selectedChatId,
          message.editTargetId ?? message.id,
          review ? serializeReviewMessage(message.content, review) : message.content,
          turnOptions
        )
        applyViewedChatDetail(selectedProviderId, detail)
        // Reading the clock happens only after the asynchronous retry completes.
        markChatSeenAt(selectedProviderId, selectedChatId, Date.now())
        setSendState('idle')
      } catch (error) {
        console.error('[caught:useChatMessagingController:useChatMessagingController]', error)
        handleSendFailure(error, 'Unable to retry message.')
      } finally {
        sendInFlightRef.current = false
        if (sendInFlightProjectKeyRef.current === retryProjectKey) {
          sendInFlightProjectKeyRef.current = null
        }
        setSendInFlightProjectKey((currentKey) =>
          currentKey === retryProjectKey ? null : currentKey
        )
      }
    },
    [
      applyViewedChatDetail,
      chatDetail?.capabilities.editMessages,
      changesContainer,
      changesCwd,
      changesProjectCwd,
      currentProject,
      effectiveApprovalMode,
      effectiveModel,
      effectiveReasoningEffort,
      effectiveSandboxMode,
      effectiveServiceTier,
      handleSendFailure,
      markChatSeenAt,
      normalizeTurnOptionsForModels,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId
    ]
  )
  const resolveChatApproval = async (
    chat: ProviderChat,
    approval: NonNullable<ProviderChat['pendingApproval']>,
    decision: ProviderApprovalDecision,
    options: { markViewed: boolean }
  ): Promise<void> => {
    if (providerUpdateInProgress || approvalResolution.decision) return

    const approvalId = approval.id
    setApprovalResolution({ approvalId, decision, error: null })

    try {
      const detail = await providerApi.resolveApproval(chat.providerId, chat.id, decision)
      if (options.markViewed) applyViewedChatDetail(chat.providerId, detail)
      else applyChatDetail(chat.providerId, detail)
    } catch (error) {
      console.error('[caught:useChatMessagingController:resolveChatApproval]', error)
      setApprovalResolution({
        approvalId,
        decision: null,
        error: 'Unable to resolve approval.'
      })
    } finally {
      setApprovalResolution((currentResolution) =>
        currentResolution.approvalId === approvalId
          ? { ...currentResolution, decision: null }
          : currentResolution
      )
    }
  }
  const handleResolveApproval = async (decision: ProviderApprovalDecision): Promise<void> => {
    if (!selectedChat || !pendingApproval || approvalDecisionInFlight) return

    await resolveChatApproval(selectedChat, pendingApproval, decision, { markViewed: true })
  }
  const handleResolveChatApproval = async (
    chat: ProviderChat,
    decision: ProviderApprovalDecision
  ): Promise<void> => {
    const approval =
      chat.pendingApproval ??
      (selectedChat?.providerId === chat.providerId && chatDetail?.id === chat.id
        ? chatDetail.pendingApproval
        : null)
    if (!approval) return

    await resolveChatApproval(chat, approval, decision, { markViewed: false })
  }
  const resolveSelectedUserInput = async (response: ProviderUserInputResponse): Promise<void> => {
    if (
      !selectedChat ||
      !pendingUserInput ||
      (userInputResolving &&
        !(response.kind === 'cancel' && pendingUserInput.elicitation?.mode === 'verification')) ||
      providerUpdateInProgress
    )
      return

    const requestId = pendingUserInput.id
    setUserInputResolution({ requestId, resolving: true, error: null })

    try {
      const detail = await providerApi.resolveUserInput(
        selectedChat.providerId,
        selectedChat.id,
        requestId,
        response,
        response.kind === 'answer' && !pendingUserInput.isBlocking
          ? getCurrentTurnOptions()
          : undefined
      )
      applyViewedChatDetail(selectedChat.providerId, detail)
    } catch (error) {
      console.error('[caught:useChatMessagingController:resolveSelectedUserInput]', error)
      setUserInputResolution({
        requestId,
        resolving: false,
        error: getErrorMessage(error, 'Unable to submit your answer.')
      })
      return
    }

    setUserInputResolution((currentResolution) =>
      currentResolution.requestId === requestId
        ? { ...currentResolution, resolving: false }
        : currentResolution
    )
  }
  const handleCompactChat = async (): Promise<void> => {
    if (providerUpdateInProgress || !selectedChat || chatHasActiveTurn || sendInFlightRef.current)
      return
    const compactProjectKey = getChatGroupKey(selectedChat)
    sendInFlightRef.current = true
    sendInFlightProjectKeyRef.current = compactProjectKey
    setSendInFlightProjectKey(compactProjectKey)
    setSendState('sending')

    try {
      const detail = await providerApi.compactChat(selectedChat.providerId, selectedChat.id)
      applyViewedChatDetail(selectedChat.providerId, detail)
      markChatSeenAt(selectedChat.providerId, selectedChat.id, Date.now())
      setSendState('idle')
    } catch (error) {
      console.error('[caught:useChatMessagingController:handleCompactChat]', error)
      handleSendFailure(error, 'Unable to compact chat context.')
    } finally {
      sendInFlightRef.current = false
      if (sendInFlightProjectKeyRef.current === compactProjectKey) {
        sendInFlightProjectKeyRef.current = null
      }
      setSendInFlightProjectKey((currentKey) =>
        currentKey === compactProjectKey ? null : currentKey
      )
    }
  }
  const handleStopChat = async (): Promise<void> => {
    if (providerUpdateInProgress || !selectedChat || sendInFlightRef.current) return
    const stopProjectKey = getChatGroupKey(selectedChat)
    sendInFlightRef.current = true
    sendInFlightProjectKeyRef.current = stopProjectKey
    setSendInFlightProjectKey(stopProjectKey)
    setSendState('sending')

    try {
      const detail = await providerApi.stopChat(selectedChat.providerId, selectedChat.id)
      applyViewedChatDetail(selectedChat.providerId, detail)
      markChatSeenAt(selectedChat.providerId, selectedChat.id, Date.now())
      setSendState('idle')
    } catch (error) {
      console.error('[caught:useChatMessagingController:handleStopChat]', error)
      handleSendFailure(error, 'Unable to stop chat.')
    } finally {
      sendInFlightRef.current = false
      if (sendInFlightProjectKeyRef.current === stopProjectKey) {
        sendInFlightProjectKeyRef.current = null
      }
      setSendInFlightProjectKey((currentKey) => (currentKey === stopProjectKey ? null : currentKey))
    }
  }
  const handleDeletePendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (providerUpdateInProgress || !selectedProviderId || !selectedChatId) return

      try {
        const detail = await providerApi.deletePendingMessage(
          selectedProviderId,
          selectedChatId,
          message.id
        )
        applyViewedChatDetail(selectedProviderId, detail)
        if (sendState === 'error') setSendState('idle')
      } catch (error) {
        console.error('[caught:useChatMessagingController:useChatMessagingController]', error)
        handleSendFailure(error, 'Unable to delete queued message.')
      }
    },
    [
      applyViewedChatDetail,
      handleSendFailure,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId,
      sendState
    ]
  )
  const handleInterruptPendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (
        providerUpdateInProgress ||
        !selectedProviderId ||
        !selectedChatId ||
        sendInFlightRef.current
      ) {
        return
      }
      const pendingMessageProjectKey = selectedChatRef.current
        ? getChatGroupKey(selectedChatRef.current)
        : getChatCwdGroupKey(null)
      sendInFlightRef.current = true
      sendInFlightProjectKeyRef.current = pendingMessageProjectKey
      setSendInFlightProjectKey(pendingMessageProjectKey)
      setSendState('sending')

      try {
        const detail = await providerApi.interruptPendingMessage(
          selectedProviderId,
          selectedChatId,
          message.id
        )
        applyViewedChatDetail(selectedProviderId, detail)
        setSendState('idle')
      } catch (error) {
        console.error('[caught:useChatMessagingController:useChatMessagingController]', error)
        handleSendFailure(error, 'Unable to send queued message.')
      } finally {
        sendInFlightRef.current = false
        if (sendInFlightProjectKeyRef.current === pendingMessageProjectKey) {
          sendInFlightProjectKeyRef.current = null
        }
        setSendInFlightProjectKey((currentKey) =>
          currentKey === pendingMessageProjectKey ? null : currentKey
        )
      }
    },
    [
      applyViewedChatDetail,
      handleSendFailure,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId
    ]
  )
  const handleSteerPendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (
        providerUpdateInProgress ||
        !selectedProviderId ||
        !selectedChatId ||
        sendInFlightRef.current
      ) {
        return
      }
      const pendingMessageProjectKey = selectedChatRef.current
        ? getChatGroupKey(selectedChatRef.current)
        : getChatCwdGroupKey(null)
      sendInFlightRef.current = true
      sendInFlightProjectKeyRef.current = pendingMessageProjectKey
      setSendInFlightProjectKey(pendingMessageProjectKey)
      setSendState('sending')

      try {
        const detail = await providerApi.steerPendingMessage(
          selectedProviderId,
          selectedChatId,
          message.id
        )
        applyViewedChatDetail(selectedProviderId, detail)
        setSendState('idle')
      } catch (error) {
        console.error('[caught:useChatMessagingController:useChatMessagingController]', error)
        handleSendFailure(error, 'Unable to steer with queued message.')
      } finally {
        sendInFlightRef.current = false
        if (sendInFlightProjectKeyRef.current === pendingMessageProjectKey) {
          sendInFlightProjectKeyRef.current = null
        }
        setSendInFlightProjectKey((currentKey) =>
          currentKey === pendingMessageProjectKey ? null : currentKey
        )
      }
    },
    [
      applyViewedChatDetail,
      handleSendFailure,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId
    ]
  )

  return {
    getGitTurnOptions,
    handleCancelEditMessage,
    handleCancelWorktreeCreation,
    handleContinueStoppedTurn,
    handleDeletePendingMessage,
    handleEditMessage,
    handleEditPendingMessage,
    handleInterruptPendingMessage,
    handleLoadWorkingItem,
    handleLoadWorkingStep,
    handleLoadWorkingToolPage,
    handleResolveApproval,
    handleResolveChatApproval,
    handleRetryStoppedTurn,
    handleSendMessage,
    handleStartGoalChat,
    handleSteerPendingMessage,
    handleCompactChat,
    handleStopChat,
    resolveSelectedUserInput
  }
}
