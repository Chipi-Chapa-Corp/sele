/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { useCallback } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type {
  ProviderChat,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderActiveSendMode,
  ProviderApprovalDecision,
  ProviderReview,
  ProviderAppInput,
  ProviderSkillInput,
  ProviderTurnOptions
} from '../../../shared/provider'
import { unloadWorkingStepItems } from '../../../shared/chatTurns'
import { providerOneShotGenerationCanceledMessage } from '../../../shared/provider'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
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
  getChatKey,
  getChatProjectCwd,
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

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useChatMessagingController(dependencies: ChatMessagingControllerDependencies) {
  const {
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
    selectedChat,
    newSessionCwd,
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

  const handleEditMessage = useCallback(
    (message: ProviderMessage): void => {
      if (
        message.role !== 'user' ||
        message.editTargetId === null ||
        !chatDetail?.capabilities.editMessages ||
        sendInFlightRef.current
      ) {
        return
      }

      setSendState('idle')
      setEditingMessage({
        type: 'message',
        id: message.id,
        targetId: message.editTargetId ?? message.id,
        content: message.content
      })
    },
    [chatDetail?.capabilities.editMessages]
  )
  const handleEditPendingMessage = useCallback(
    (message: ProviderPendingMessage): void => {
      if (!selectedChatId || sendInFlightRef.current) return

      setSendState('idle')
      setEditingMessage({
        type: 'pending',
        id: message.id,
        kind: message.kind,
        content: message.content
      })
    },
    [selectedChatId]
  )
  const handleCancelEditMessage = useCallback((): void => {
    setSendState('idle')
    setEditingMessage(null)
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
        model: resolvedModel.id,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        serviceTier
      }
    },
    [models]
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

    await providerApi.cancelOneShot(generation.providerId, generation.generationId).catch(() => {})
  }, [])
  const handleSendMessage = async (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments: AppSelectedAttachment[] = [],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills: ProviderSkillInput[] = [],
    apps: ProviderAppInput[] = [],
    turnOptionsOverride?: ProviderTurnOptions,
    sendTarget?: 'current' | 'new'
  ): Promise<boolean> => {
    if (
      providerUpdateInProgress ||
      sendInFlightRef.current ||
      (activeSubagentChatView && sendTarget !== 'new')
    ) {
      return false
    }
    const sendProjectKey = getChatCwdGroupKey(
      selectedChat ? (changesProjectCwd ?? getChatProjectCwd(selectedChat)) : newSessionCwd
    )
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
      attachments.length > 0
        ? {
            ...baseTurnOptions,
            files: filePaths.length > 0 ? filePaths.map((path) => ({ path })) : undefined,
            images: imagePaths.length > 0 ? imagePaths.map((path) => ({ path })) : undefined
          }
        : baseTurnOptions

    if (editingMessage && !sendTarget) {
      if (!selectedChat) {
        finishSendInFlight()
        return false
      }

      setSendState('sending')

      try {
        const detail =
          editingMessage.type === 'pending'
            ? await providerApi.editPendingMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.id,
                serializedMessage,
                turnOptions
              )
            : await providerApi.editMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.targetId,
                serializedMessage,
                turnOptions
              )
        applyViewedChatDetail(selectedChat.providerId, detail)
        setEditingMessage(null)
        setSendState('idle')
        return true
      } catch (error) {
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
        let sessionCwd = startingCwd ?? undefined

        if (!startingSelectedChat && newSessionLocation === 'worktree') {
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
            return true
          }

          sessionCwd = worktree.worktreePath
        }

        const detail = await providerApi.startChat(startingProviderId, serializedMessage, {
          ...turnOptions,
          cwd: sessionCwd
        })
        applyViewedChatDetail(
          startingProviderId,
          !hasProviderUserMessage(detail.items)
            ? {
                ...detail,
                items: getOptimisticItems([], messageWithComposerMentions, attachments, review)
              }
            : detail,
          { select: true }
        )
        if (startingCwd?.trim() && startingCwd.trim() === defaultCwd?.trim()) {
          void rememberProject(startingCwd)
        }
        setSendState('idle')
        return true
      } catch (error) {
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
        handleSendFailure(error, 'Unable to send message.')
        return false
      } finally {
        finishSendInFlight()
      }
    }

    if (chatDetail?.id === chatId) {
      applyViewedChatDetail(providerId, {
        ...chatDetail,
        status: 'active',
        contextUsage: chatDetail.contextUsage,
        items: getOptimisticItems(
          chatDetail.items,
          messageWithComposerMentions,
          attachments,
          review
        )
      })
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
      void providerApi
        .getChat(providerId, chatId)
        .then((detail) => applyViewedChatDetail(providerId, detail))
        .catch(() => {})
      handleSendFailure(error, 'Unable to send message.')
      return false
    } finally {
      finishSendInFlight()
    }
  }
  const handleContinueStoppedTurn = useCallback(
    async (workingStepId: string, prompt: string): Promise<void> => {
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

      const retryProjectKey = getChatCwdGroupKey(changesProjectCwd ?? changesCwd)
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
    } catch {
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
  const resolveSelectedUserInput = async (
    response: { kind: 'answer'; answer: string; wasFreeform: boolean } | { kind: 'cancel' }
  ): Promise<void> => {
    if (!selectedChat || !pendingUserInput || userInputResolving || providerUpdateInProgress) return

    const requestId = pendingUserInput.id
    setUserInputResolution({ requestId, resolving: true, error: null })

    try {
      const detail = await providerApi.resolveUserInput(
        selectedChat.providerId,
        selectedChat.id,
        requestId,
        response
      )
      applyViewedChatDetail(selectedChat.providerId, detail)
    } catch (error) {
      setUserInputResolution({
        requestId,
        resolving: false,
        error: getErrorMessage(error, 'Unable to resolve Copilot question.')
      })
      return
    }

    setUserInputResolution((currentResolution) =>
      currentResolution.requestId === requestId
        ? { ...currentResolution, resolving: false }
        : currentResolution
    )
  }
  const handleStopChat = async (): Promise<void> => {
    if (providerUpdateInProgress || !selectedChat || sendInFlightRef.current) return
    const stopProjectKey = getChatCwdGroupKey(getChatProjectCwd(selectedChat))
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
      const pendingMessageProjectKey = getChatCwdGroupKey(
        selectedChatRef.current ? getChatProjectCwd(selectedChatRef.current) : null
      )
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
      const pendingMessageProjectKey = getChatCwdGroupKey(
        selectedChatRef.current ? getChatProjectCwd(selectedChatRef.current) : null
      )
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
    handleSteerPendingMessage,
    handleStopChat,
    resolveSelectedUserInput
  }
}
