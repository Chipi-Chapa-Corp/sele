import { getChatCommitMarkerTerminalStatus } from '../chatCommitMarker'
import { getChatCommitLaunchMode } from '../chatCommitPolicy'
import { appApi } from '../appApi'
import {
  getCommitMessageGenerationPrompt,
  isLargeCommitMessageChange,
  normalizeGeneratedCommitMessage
} from '../gitCommitMessage'
import { providerApi } from '../providerApi'
import { getCommitPatches } from '../changeTree'
import { type ChatCommitMarker } from '../components/AppStatusStates'
import { type ScopedCommitActivity, type StartingScopedCommitActivity } from '../chatCommitStorage'
import { type DirectCommitActivity, type GitCommitPromptAction } from './controllerTypes'
import {
  createChatCommitMarkerId,
  getChatCwdGroupKey,
  getChatProjectCwd,
  getCommitActivityCurrentAction,
  getDirectCommitActivityAction,
  getErrorMessage,
  getLastChatCommitMarkerAnchorId,
  getProviderChatKey,
  getScopedChatCommitPrompt,
  getTimestamp,
  isActiveChatStatus
} from './chatControllerUtils'
import type { CommitControllerDependencies } from './controllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useCommitController(dependencies: CommitControllerDependencies) {
  const {
    startingScopedCommitActivitiesRef,
    scopedCommitActivitiesRef,
    providerUpdateInProgress,
    selectedChat,
    chatDetail,
    changesCwd,
    newSessionProvider,
    changesProjectCwd,
    projectCommitInProgress,
    commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef,
    syncProjectKeysRef,
    sendInFlightRef,
    sendInFlightProjectKeyRef,
    getGitTurnOptions,
    setStartingScopedCommitActivities,
    chatAutoScrollEnabledRef,
    setCommitErrorsByProjectKey,
    setChatCommitMarkers,
    applyChatDetail,
    changesCwdRef,
    setCommitInput,
    setScopedCommitActivities,
    commitMessageGenerationDisabled,
    setCommitMessageGenerationProjectKeys,
    changesContainer,
    effectiveAppSettings,
    aiCommitInstructions,
    commitInputValue,
    getCommitActionDisabled,
    setDirectCommitActivities,
    patchChangeSourceSelected,
    changedFiles,
    setGitChangeLoadRequest,
    pushAfterCommit,
    runSyncChanges,
    getAiCommitActionDisabled,
    cancelingAiCommitKeys,
    setCancelingAiCommitKeys,
    openingAiCommitChatIds,
    chatsRef,
    setOpeningAiCommitChatIds,
    markSelectedChatSeen,
    setSendState,
    setEditingMessage,
    setSearchOpen,
    setSearchQuery,
    subagentChatLoadRequestRef,
    setSubagentChatView,
    setCommitChatReturnTarget,
    applyViewedChatDetail,
    commitChatReturnTarget,
    handleSelectChat,
    hasAiCommitInProgressForProject
  } = dependencies
  const handleScopedChatCommit = async (
    action: GitCommitPromptAction,
    prompt: string
  ): Promise<boolean> => {
    if (providerUpdateInProgress) return false
    if (selectedChat && !chatDetail) return false
    if (!selectedChat && !changesCwd) return false

    const providerId = selectedChat?.providerId ?? newSessionProvider
    const chatId = selectedChat?.id ?? null
    const projectCwd = changesProjectCwd ?? changesCwd
    const projectKey = getChatCwdGroupKey(projectCwd)
    if (
      projectCommitInProgress ||
      hasAiCommitInProgressForProject(projectKey) ||
      commitInFlightProjectKeysRef.current.has(projectKey) ||
      commitMessageGenerationProjectKeysRef.current.has(projectKey) ||
      syncProjectKeysRef.current.has(projectKey)
    ) {
      return false
    }
    if (sendInFlightRef.current && sendInFlightProjectKeyRef.current === projectKey) {
      return false
    }

    const turnOptions = getGitTurnOptions()
    const launchMode = getChatCommitLaunchMode(chatId)
    const markerId = chatId ? createChatCommitMarkerId() : null
    // The operation timestamp is captured only when the user starts the commit.
    const markerStartedAt = Date.now()
    const startingActivity = {
      id: markerId ?? `starting:${providerId}:${markerStartedAt}:${crypto.randomUUID()}`,
      providerId,
      sourceChatId: chatId,
      markerId,
      projectCwd,
      commitAction: action,
      startedAt: markerStartedAt
    } satisfies StartingScopedCommitActivity
    const sourceAnchorItemId =
      chatId && chatDetail?.id === chatId ? getLastChatCommitMarkerAnchorId(chatDetail.items) : null

    const nextStartingActivities = {
      ...startingScopedCommitActivitiesRef.current,
      [projectKey]: startingActivity
    }
    startingScopedCommitActivitiesRef.current = nextStartingActivities
    setStartingScopedCommitActivities(nextStartingActivities)
    chatAutoScrollEnabledRef.current = true
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[projectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[projectKey]
      return nextErrors
    })

    if (chatId && markerId) {
      setChatCommitMarkers((currentMarkers) => ({
        ...currentMarkers,
        [markerId]: {
          id: markerId,
          providerId,
          sourceChatId: chatId,
          commitChatId: null,
          commitAction: action,
          status: 'pending',
          afterItemId: null,
          startedAt: markerStartedAt,
          finishedAt: null
        }
      }))
    }

    try {
      const detail =
        launchMode === 'new'
          ? await providerApi.startChat(
              providerId,
              prompt,
              {
                ...turnOptions,
                cwd: changesCwd ?? undefined
              },
              'commit'
            )
          : await providerApi.continueChatInFork(providerId, chatId!, prompt, 'commit', turnOptions)
      applyChatDetail(providerId, detail)

      if (changesCwdRef.current === changesCwd) setCommitInput('')
      if (markerId) {
        setChatCommitMarkers((currentMarkers) => {
          const marker = currentMarkers[markerId]
          if (!marker) return currentMarkers

          return {
            ...currentMarkers,
            [markerId]: {
              ...marker,
              commitChatId: detail.id,
              status: isActiveChatStatus(detail.status)
                ? 'pending'
                : getChatCommitMarkerTerminalStatus(detail),
              afterItemId: sourceAnchorItemId,
              finishedAt: isActiveChatStatus(detail.status) ? null : Date.now()
            }
          }
        })
      }
      if (isActiveChatStatus(detail.status)) {
        const activityKey = getProviderChatKey(providerId, detail.id)
        const activity = {
          source: 'ai',
          providerId,
          chatId: detail.id,
          sourceChatId: chatId,
          markerId: markerId ?? `untracked:${providerId}:${detail.id}:${markerStartedAt}`,
          projectCwd,
          commitAction: action,
          currentAction: getCommitActivityCurrentAction(detail, action),
          startedAt: markerStartedAt
        } satisfies ScopedCommitActivity

        setScopedCommitActivities((currentActivities) => {
          const nextActivities = {
            ...currentActivities,
            [activityKey]: activity
          }
          scopedCommitActivitiesRef.current = nextActivities
          return nextActivities
        })
      }
      return true
    } catch (error) {
      if (markerId) {
        setChatCommitMarkers((currentMarkers) => {
          const marker = currentMarkers[markerId]
          if (!marker || marker.status !== 'pending') return currentMarkers

          return {
            ...currentMarkers,
            [markerId]: {
              ...marker,
              status: 'failed',
              afterItemId: sourceAnchorItemId,
              finishedAt: Date.now()
            }
          }
        })
      }
      setCommitErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [projectKey]: getErrorMessage(error, 'Unable to start scoped commit in chat.')
      }))
      return false
    } finally {
      const currentStartingActivity = startingScopedCommitActivitiesRef.current[projectKey]
      if (currentStartingActivity?.id === startingActivity.id) {
        const remainingStartingActivities = {
          ...startingScopedCommitActivitiesRef.current
        }
        delete remainingStartingActivities[projectKey]
        startingScopedCommitActivitiesRef.current = remainingStartingActivities
        setStartingScopedCommitActivities(remainingStartingActivities)
      }
    }
  }
  const generateCommitMessage = async (aiInstructions: string): Promise<string | null> => {
    if (commitMessageGenerationDisabled || !changesCwd) return null

    const generationCwd = changesCwd
    const generationProjectKey = getChatCwdGroupKey(changesProjectCwd ?? generationCwd)
    if (
      hasAiCommitInProgressForProject(generationProjectKey) ||
      commitMessageGenerationProjectKeysRef.current.has(generationProjectKey) ||
      commitInFlightProjectKeysRef.current.has(generationProjectKey) ||
      syncProjectKeysRef.current.has(generationProjectKey)
    ) {
      return null
    }

    const providerId = selectedChat?.providerId ?? newSessionProvider
    const nextGenerationProjectKeys = new Set(commitMessageGenerationProjectKeysRef.current).add(
      generationProjectKey
    )
    commitMessageGenerationProjectKeysRef.current = nextGenerationProjectKeys
    setCommitMessageGenerationProjectKeys(nextGenerationProjectKeys)
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[generationProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[generationProjectKey]
      return nextErrors
    })

    try {
      const [context, { messages }] = await Promise.all([
        appApi.getGitCommitMessageContext({ container: changesContainer, cwd: generationCwd }),
        appApi.getRecentGitCommitMessages({
          container: changesContainer,
          cwd: generationCwd,
          limit: 5
        })
      ])
      if (context.fileCount === 0 && !context.diff?.trim()) {
        throw new Error('There is no uncommitted diff to describe.')
      }

      const generatedMessage = await providerApi.generateOneShot(
        providerId,
        getCommitMessageGenerationPrompt(
          context,
          messages,
          aiInstructions,
          effectiveAppSettings.git.commitMessageGeneration
        ),
        {
          ...getGitTurnOptions(),
          ...(isLargeCommitMessageChange(context)
            ? {
                approvalPolicy: 'never' as const,
                approvalsReviewer: 'user' as const,
                sandboxMode: 'read-only' as const
              }
            : {}),
          cwd: generationCwd
        }
      )
      const commitMessage = normalizeGeneratedCommitMessage(generatedMessage)
      if (!commitMessage) throw new Error('AI did not return a commit name.')

      if (changesCwdRef.current === generationCwd) setCommitInput(commitMessage)
      return commitMessage
    } catch (error) {
      setCommitErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [generationProjectKey]: getErrorMessage(error, 'Unable to generate a commit name.')
      }))
      return null
    } finally {
      const remainingGenerationProjectKeys = new Set(commitMessageGenerationProjectKeysRef.current)
      remainingGenerationProjectKeys.delete(generationProjectKey)
      commitMessageGenerationProjectKeysRef.current = remainingGenerationProjectKeys
      setCommitMessageGenerationProjectKeys(remainingGenerationProjectKeys)
    }
  }
  const handleGenerateCommitMessage = async (): Promise<boolean> =>
    Boolean(await generateCommitMessage(aiCommitInstructions))
  const handleCommitChangedFiles = async (
    action: GitCommitPromptAction = 'commit',
    message = commitInputValue
  ): Promise<boolean> => {
    const commitMessage = message.trim()
    if (providerUpdateInProgress) return false
    if (!changesCwd) return false
    const commitProjectKey = getChatCwdGroupKey(changesProjectCwd ?? changesCwd)
    if (
      hasAiCommitInProgressForProject(commitProjectKey) ||
      commitInFlightProjectKeysRef.current.has(commitProjectKey) ||
      commitMessageGenerationProjectKeysRef.current.has(commitProjectKey) ||
      syncProjectKeysRef.current.has(commitProjectKey)
    ) {
      return false
    }
    if (getCommitActionDisabled(action, commitMessage)) return false

    commitInFlightProjectKeysRef.current.add(commitProjectKey)
    const startedAt = getTimestamp()
    const activityId = `git:${changesCwd}:${action}:${startedAt}`
    const activity = {
      source: 'git',
      id: activityId,
      projectCwd: changesProjectCwd ?? changesCwd,
      commitAction: action,
      currentAction: getDirectCommitActivityAction(action),
      startedAt
    } satisfies DirectCommitActivity

    try {
      setCommitErrorsByProjectKey((currentErrors) => {
        if (!currentErrors[commitProjectKey]) return currentErrors

        const nextErrors = { ...currentErrors }
        delete nextErrors[commitProjectKey]
        return nextErrors
      })
      setDirectCommitActivities((currentActivities) => ({
        ...currentActivities,
        [activityId]: activity
      }))

      await appApi.commitGitChanges({
        action,
        container: changesContainer,
        cwd: changesCwd,
        message: action === 'amend' ? null : commitMessage,
        patches: patchChangeSourceSelected ? getCommitPatches(changedFiles) : undefined
      })
      if (changesCwdRef.current === changesCwd) setCommitInput('')
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
      return true
    } catch (error) {
      setCommitErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [commitProjectKey]: getErrorMessage(error, 'Unable to commit changes.')
      }))
      return false
    } finally {
      setDirectCommitActivities((currentActivities) => {
        if (!currentActivities[activityId]) return currentActivities

        const nextActivities = { ...currentActivities }
        delete nextActivities[activityId]
        return nextActivities
      })
      commitInFlightProjectKeysRef.current.delete(commitProjectKey)
    }
  }
  const handleManualCommitChangedFiles = async (): Promise<boolean> => {
    if (!changesCwd) return false

    const commitCwd = changesCwd
    const committed = await handleCommitChangedFiles('commit')
    if (!committed) return false

    if (pushAfterCommit) await runSyncChanges('push', commitCwd)
    return true
  }
  const handleAiCommitChangedFiles = async (pushAfterCommit = false): Promise<boolean> => {
    if (providerUpdateInProgress) return false
    if (getAiCommitActionDisabled()) return false

    return handleScopedChatCommit(
      'commit',
      getScopedChatCommitPrompt(
        'commit',
        aiCommitInstructions,
        effectiveAppSettings.git.commitPrompt,
        pushAfterCommit
      )
    )
  }
  const handleQuickCommitChangedFiles = async (pushAfterCommit = false): Promise<boolean> => {
    if (commitMessageGenerationDisabled) return false
    if (!changesCwd) return false

    const quickCommitCwd = changesCwd
    const quickCommitProjectKey = getChatCwdGroupKey(changesProjectCwd ?? quickCommitCwd)
    if (
      commitInFlightProjectKeysRef.current.has(quickCommitProjectKey) ||
      commitMessageGenerationProjectKeysRef.current.has(quickCommitProjectKey)
    ) {
      return false
    }
    const generatedMessage = await generateCommitMessage(aiCommitInstructions)
    if (!generatedMessage) return false

    const committed = await handleCommitChangedFiles('commit', generatedMessage)
    if (!committed) return false

    if (pushAfterCommit) await runSyncChanges('push', quickCommitCwd)
    return true
  }
  const handleCancelAiCommit = async (activity: ScopedCommitActivity): Promise<void> => {
    const activityKey = getProviderChatKey(activity.providerId, activity.chatId)
    const activityProjectKey = getChatCwdGroupKey(activity.projectCwd)
    if (providerUpdateInProgress || cancelingAiCommitKeys.has(activityKey)) return

    setCancelingAiCommitKeys((currentKeys) => new Set(currentKeys).add(activityKey))
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[activityProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[activityProjectKey]
      return nextErrors
    })

    try {
      const detail = await providerApi.stopChat(activity.providerId, activity.chatId)
      applyChatDetail(activity.providerId, detail)
      setChatCommitMarkers((currentMarkers) => {
        const marker = currentMarkers[activity.markerId]
        if (!marker || marker.status !== 'pending') return currentMarkers

        return {
          ...currentMarkers,
          [marker.id]: {
            ...marker,
            status: 'stopped',
            afterItemId:
              activity.chatId === activity.sourceChatId
                ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                : marker.afterItemId,
            finishedAt: Date.now()
          }
        }
      })
      setScopedCommitActivities((currentActivities) => {
        if (!currentActivities[activityKey]) return currentActivities

        const nextActivities = { ...currentActivities }
        delete nextActivities[activityKey]
        return nextActivities
      })
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
    } catch (error) {
      setCommitErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [activityProjectKey]: getErrorMessage(error, 'Unable to cancel the AI commit.')
      }))
    } finally {
      setCancelingAiCommitKeys((currentKeys) => {
        if (!currentKeys.has(activityKey)) return currentKeys

        const nextKeys = new Set(currentKeys)
        nextKeys.delete(activityKey)
        return nextKeys
      })
    }
  }
  const handleOpenAiCommitChat = async (marker: ChatCommitMarker): Promise<void> => {
    const commitChatId = marker.commitChatId
    if (!commitChatId || openingAiCommitChatIds.has(commitChatId)) return
    const sourceChat =
      selectedChat?.providerId === marker.providerId && selectedChat.id === marker.sourceChatId
        ? selectedChat
        : (chatsRef.current.find(
            (chat) => chat.providerId === marker.providerId && chat.id === marker.sourceChatId
          ) ?? null)
    const markerProjectKey = getChatCwdGroupKey(
      sourceChat ? getChatProjectCwd(sourceChat) : (changesProjectCwd ?? changesCwd)
    )

    setOpeningAiCommitChatIds((currentIds) => new Set(currentIds).add(commitChatId))
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[markerProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[markerProjectKey]
      return nextErrors
    })

    try {
      const detail = await providerApi.getChat(marker.providerId, commitChatId)
      markSelectedChatSeen(true)
      setSendState(sendInFlightRef.current ? 'sending' : 'idle')
      setEditingMessage(null)
      setSearchOpen(false)
      setSearchQuery('')
      subagentChatLoadRequestRef.current += 1
      setSubagentChatView(null)
      setCommitChatReturnTarget(
        sourceChat
          ? {
              providerId: marker.providerId,
              commitChatId,
              sourceChat
            }
          : null
      )
      applyViewedChatDetail(marker.providerId, detail, { select: true })
    } catch (error) {
      setCommitErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [markerProjectKey]: getErrorMessage(error, 'Unable to open the AI commit chat.')
      }))
    } finally {
      setOpeningAiCommitChatIds((currentIds) => {
        if (!currentIds.has(commitChatId)) return currentIds

        const nextIds = new Set(currentIds)
        nextIds.delete(commitChatId)
        return nextIds
      })
    }
  }
  const handleReturnFromAiCommitChat = (): void => {
    if (!commitChatReturnTarget) return

    const { providerId, sourceChat } = commitChatReturnTarget
    const currentSourceChat =
      chatsRef.current.find(
        (chat) => chat.providerId === providerId && chat.id === sourceChat.id
      ) ?? sourceChat
    handleSelectChat(currentSourceChat)
  }

  return {
    handleAiCommitChangedFiles,
    handleCancelAiCommit,
    handleGenerateCommitMessage,
    handleManualCommitChangedFiles,
    handleOpenAiCommitChat,
    handleQuickCommitChangedFiles,
    handleReturnFromAiCommitChat
  }
}
