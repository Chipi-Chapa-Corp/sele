/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import type { ProviderSubagent, ProviderUsageOptions } from '../../../shared/provider'
import { providerIds } from '../../../shared/provider'
import type { AppAction } from '../actions'
import { getAppActionsForProject, getAppActionKeybindingFromEvent } from '../actions'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
import { terminalApi } from '../terminalApi'
import {
  clearChatSearchHighlights,
  findChatSearchMatches,
  scrollChatSearchMatchIntoView,
  setChatSearchHighlights
} from '../chatSearch'
import {
  getChatChangedFiles,
  getCommitPatches,
  getDefaultFileTreeCollapsedFolders,
  getLastTurnChangedFiles,
  getPatchFilterSignature,
  getRepositoryFiles,
  isPatchChangeSource,
  type GitChangeSource,
  type PatchFilterScope
} from '../changeTree'
import {
  isScrolledToBottom,
  readChatScrollAnchor,
  resetDocumentScroll,
  restoreChatScrollAnchor
} from '../chatLayout'
import { getContainerTargetKey, normalizeContainerTarget } from '../containerSelection'
import {
  preserveOptimisticChatDetail,
  shouldPreserveOptimisticTurnUntilUserMessage
} from '../chatDetailWindow'
import {
  type ChangesPaneView,
  type FileTreeScope,
  type GitBranchesScope,
  type GitChangesScope,
  type GitCommitPromptAction
} from './controllerTypes'
import { isAppActionShortcutTargetBlocked } from './gitControllerUtils'
import {
  getChatKey,
  getErrorMessage,
  getLatestChatPlan,
  isActiveChatStatus,
  isChatDetailSnapshotStale,
  mergeAccountUsage
} from './chatControllerUtils'
import type { WorkspaceSelectionDependencies } from './selectionDependencies'

const areSubagentSummariesEqual = (first: ProviderSubagent, second: ProviderSubagent): boolean =>
  first.id === second.id &&
  first.parentId === second.parentId &&
  first.turnId === second.turnId &&
  first.beforeItemId === second.beforeItemId &&
  first.afterItemId === second.afterItemId &&
  first.title === second.title &&
  first.description === second.description &&
  first.status === second.status &&
  first.createdAt === second.createdAt &&
  first.updatedAt === second.updatedAt

const areSubagentListsEqual = (first: ProviderSubagent[], second: ProviderSubagent[]): boolean =>
  first.length === second.length &&
  first.every((subagent, index) => areSubagentSummariesEqual(subagent, second[index]))

// Return shape is inferred from the synchronized selection declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useWorkspaceSelection(dependencies: WorkspaceSelectionDependencies) {
  const {
    selectedChat,
    subagentChatView,
    subagentListState,
    chatDetail,
    setSubagentListState,
    setSubagentChatView,
    selectedChatKeyRef,
    subagentChatLoadRequestRef,
    chatDetailResyncRequestIdRef,
    chatDetailResyncRef,
    scopedCommitActivities,
    startingScopedCommitActivities,
    chatCommitMarkers,
    extractedChatPlan,
    effectiveAppSettings,
    setExtractedChatPlan,
    newSessionProvider,
    newSessionProviderAvailable,
    newSessionSourceAvailabilityReady,
    newSessionCwd,
    newSessionContainer,
    gitSourceAvailability,
    lastGitAvailable,
    changesContainerRef,
    changeSourceRef,
    changeSource,
    setGitSourceAvailability,
    setLastGitAvailable,
    setGitAvailabilityChangeId,
    gitAvailableRef,
    gitBranchLoadRequest,
    gitChangeLoadRequest,
    setTerminalOpened,
    setBrowserOpened,
    lastNonTerminalChangesPaneViewRef,
    setChangesPaneView,
    changesPaneView,
    setAppSettings,
    runPromptActionRef,
    setTerminalCommandLaunchRequest,
    updateAppearanceZoomLevel,
    settingsOpen,
    fileEditorTarget,
    appSettings,
    changesCwdRef,
    approvalResolution,
    userInputResolution,
    setAccountUsage,
    setAccountUsageState,
    setAccountUsageError,
    loadState,
    providerAccountRevision,
    chatDetailRef,
    cacheRecentChatDetail,
    selectedChatUpdatedAtRef,
    setChatDetail,
    setChatLoadState,
    markChatSeenAt,
    chatLoadRequest,
    chatInitialLayoutKeyRef,
    contentRef,
    chatAutoScrollEnabledRef,
    chatUserScrollIntentRef,
    chatAutoScrollTargetRef,
    scrollChatContentToBottom,
    scheduleChatAutoScroll,
    loadedWorkingStepIdsRef,
    chatScrollAdjustmentTargetRef,
    pendingChatScrollAnchorRef,
    chatViewportAnchorRef,
    previousChatScrollTopRef,
    searchOpen,
    searchInputRef,
    chatSearchReturnFocusRef,
    resetChatSearch,
    chatTurnWindowRef,
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchInputRef,
    chatSearchContentRef,
    chatSearchQuery,
    chatSearchActiveIndexRef,
    chatSearchMatchesRef,
    setChatSearchMatchCount,
    setChatSearchActiveIndex,
    setGitBranchActionState,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    setGitChangeLoadError,
    setUncommittedPatchFilterError,
    setGitChangeLoadErrorDismissed,
    newChatOpen,
    setDefaultCwd,
    setNewSessionCwd,
    gitBranchRequestIdRef,
    setGitBranches,
    setGitBranchesScope,
    setGitBranchLoadState,
    gitAvailabilityChangeId,
    setGitChangeLoadScope,
    setGitChangeLoadState,
    setGitChanges,
    setGitChangesScope,
    setUncommittedPatchFilterState,
    setUncommittedPatchFilter,
    setFileTreeLoadScope,
    setFileTreeLoadState,
    setFileTree,
    setFileTreeScope,
    setLastOpenedFileTreeFolderPath,
    lastOpenedFileTreeFolderByCwdRef,
    collapsedFileTreeFoldersByCwdRef,
    setCollapsedFileTreeFolders,
    fileTreeLoadRequest
  } = dependencies

  const selectedProviderId = selectedChat?.providerId
  const selectedChatId = selectedChat?.id
  const selectedChatStatus = selectedChat?.status ?? null
  const selectedChatKey =
    selectedProviderId && selectedChatId
      ? getChatKey({ providerId: selectedProviderId, id: selectedChatId })
      : null
  const activeSubagentChatView =
    subagentChatView?.rootChatKey === selectedChatKey ? subagentChatView : null
  const activeSubagentId = activeSubagentChatView?.summary.id ?? null
  const selectedChatSubagents = useMemo(
    () => (subagentListState?.rootChatKey === selectedChatKey ? subagentListState.items : []),
    [selectedChatKey, subagentListState]
  )
  useEffect(() => {
    if (
      !selectedProviderId ||
      !selectedChatId ||
      !selectedChatKey ||
      chatDetail?.id !== selectedChatId ||
      chatDetail.purpose === 'commit'
    ) {
      setSubagentListState(null)
      setSubagentChatView(null)
      return
    }

    if (chatDetail.subagents !== undefined) {
      const subagents = chatDetail.subagents
      setSubagentListState((currentState) =>
        currentState?.rootChatKey === selectedChatKey &&
        currentState.loadState === 'ready' &&
        currentState.error === null &&
        areSubagentListsEqual(currentState.items, subagents)
          ? currentState
          : {
              rootChatKey: selectedChatKey,
              items: subagents,
              loadState: 'ready',
              error: null
            }
      )
      setSubagentChatView((currentView) => {
        if (currentView?.rootChatKey !== selectedChatKey) return currentView
        const updatedSummary = subagents.find((subagent) => subagent.id === currentView.summary.id)
        return updatedSummary && !areSubagentSummariesEqual(currentView.summary, updatedSummary)
          ? { ...currentView, summary: updatedSummary }
          : currentView
      })
      return
    }

    let active = true
    setSubagentListState((currentState) =>
      currentState?.rootChatKey === selectedChatKey
        ? currentState
        : { rootChatKey: selectedChatKey, items: [], loadState: 'loading', error: null }
    )

    const timeoutId = window.setTimeout(() => {
      void providerApi
        .getSubagents(selectedProviderId, selectedChatId)
        .then((subagents) => {
          if (!active || selectedChatKeyRef.current !== selectedChatKey) return

          setSubagentListState({
            rootChatKey: selectedChatKey,
            items: subagents,
            loadState: 'ready',
            error: null
          })
          setSubagentChatView((currentView) => {
            if (currentView?.rootChatKey !== selectedChatKey) return currentView
            const updatedSummary = subagents.find(
              (subagent) => subagent.id === currentView.summary.id
            )
            return updatedSummary ? { ...currentView, summary: updatedSummary } : currentView
          })
        })
        .catch((error) => {
          if (!active || selectedChatKeyRef.current !== selectedChatKey) return

          setSubagentListState((currentState) => ({
            rootChatKey: selectedChatKey,
            items: currentState?.rootChatKey === selectedChatKey ? currentState.items : [],
            loadState: 'error',
            error: getErrorMessage(error, 'Unable to load subagent chats.')
          }))
        })
    }, 120)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [
    chatDetail?.id,
    chatDetail?.purpose,
    chatDetail?.subagents,
    selectedChatId,
    selectedChatKey,
    selectedProviderId
  ])
  useEffect(() => {
    if (!selectedProviderId || !selectedChatId || !selectedChatKey || !activeSubagentId) return

    let active = true
    let timeoutId: number | null = null
    const requestId = subagentChatLoadRequestRef.current

    const scheduleRefresh = (delay: number): void => {
      timeoutId = window.setTimeout(() => void refresh(), delay)
    }
    const refresh = async (): Promise<void> => {
      try {
        const detail = await providerApi.getSubagent(
          selectedProviderId,
          selectedChatId,
          activeSubagentId
        )
        if (
          !active ||
          subagentChatLoadRequestRef.current !== requestId ||
          selectedChatKeyRef.current !== selectedChatKey
        ) {
          return
        }

        setSubagentChatView((currentView) =>
          currentView?.rootChatKey === selectedChatKey &&
          currentView.summary.id === activeSubagentId
            ? {
                rootChatKey: selectedChatKey,
                summary: detail,
                detail,
                loadState: 'ready',
                error: null
              }
            : currentView
        )

        if (
          detail.status === 'pending' ||
          detail.status === 'running' ||
          detail.status === 'idle' ||
          detail.status === 'unknown'
        ) {
          scheduleRefresh(1_500)
        }
      } catch {
        if (
          active &&
          subagentChatLoadRequestRef.current === requestId &&
          selectedChatKeyRef.current === selectedChatKey
        ) {
          scheduleRefresh(2_000)
        }
      }
    }

    scheduleRefresh(750)
    return () => {
      active = false
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [activeSubagentId, selectedChatId, selectedChatKey, selectedProviderId])
  useEffect(() => {
    chatDetailResyncRequestIdRef.current += 1
    chatDetailResyncRef.current = null
    providerApi.setViewedChat(selectedProviderId ?? null, selectedChatId ?? null)
  }, [selectedChatId, selectedProviderId])
  const committingChatActions = useMemo(() => {
    const actions = new Map<string, GitCommitPromptAction>()

    Object.values(scopedCommitActivities).forEach((activity) => {
      if (!activity.sourceChatId) return

      actions.set(
        getChatKey({ providerId: activity.providerId, id: activity.sourceChatId }),
        activity.commitAction
      )
    })
    Object.values(startingScopedCommitActivities).forEach((activity) => {
      if (!activity.sourceChatId) return

      actions.set(
        getChatKey({ providerId: activity.providerId, id: activity.sourceChatId }),
        activity.commitAction
      )
    })

    return actions
  }, [scopedCommitActivities, startingScopedCommitActivities])
  const committingChatKeys = useMemo(
    () => new Set(committingChatActions.keys()),
    [committingChatActions]
  )
  const latestCommitFinishedAtByChatKey = useMemo(() => {
    const finishedAtByChatKey = new Map<string, number>()

    Object.values(chatCommitMarkers).forEach((marker) => {
      if (marker.status !== 'finished' || marker.finishedAt === null) return

      const chatKey = getChatKey({ providerId: marker.providerId, id: marker.sourceChatId })
      const currentFinishedAt = finishedAtByChatKey.get(chatKey) ?? 0
      if (marker.finishedAt > currentFinishedAt) {
        finishedAtByChatKey.set(chatKey, marker.finishedAt)
      }
    })

    return finishedAtByChatKey
  }, [chatCommitMarkers])
  const selectedChatCommitMarkers = useMemo(
    () =>
      selectedProviderId && selectedChatId
        ? Object.values(chatCommitMarkers)
            .filter(
              (marker) =>
                marker.providerId === selectedProviderId && marker.sourceChatId === selectedChatId
            )
            .sort((firstMarker, secondMarker) => firstMarker.startedAt - secondMarker.startedAt)
        : [],
    [chatCommitMarkers, selectedChatId, selectedProviderId]
  )
  const scopedCommitActivitiesByMarkerId = useMemo(
    () =>
      new Map(
        Object.values(scopedCommitActivities).map((activity) => [activity.markerId, activity])
      ),
    [scopedCommitActivities]
  )
  const messageBoxPlan =
    extractedChatPlan?.contextKey === selectedChatKey ? extractedChatPlan : null
  useEffect(() => {
    if (
      effectiveAppSettings.chat.hidePlans ||
      !selectedChatKey ||
      !selectedChatId ||
      chatDetail?.id !== selectedChatId
    ) {
      return
    }

    let active = true
    let timeoutId: number | null = null
    const items = chatDetail.items
    const contextKey = selectedChatKey
    const animationFrame = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (!active) return

        const nextPlan = getLatestChatPlan(items, contextKey)
        setExtractedChatPlan((currentPlan) =>
          currentPlan?.contextKey === nextPlan?.contextKey &&
          currentPlan?.signature === nextPlan?.signature
            ? currentPlan
            : nextPlan
        )
      }, 0)
    })

    return () => {
      active = false
      window.cancelAnimationFrame(animationFrame)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [
    effectiveAppSettings.chat.hidePlans,
    chatDetail?.id,
    chatDetail?.items,
    selectedChatId,
    selectedChatKey
  ])
  const usageProviderId = selectedProviderId ?? newSessionProvider
  const usageProviderAvailable = selectedChat ? true : newSessionProviderAvailable
  const usageProviderAvailabilityReady = selectedChat ? true : newSessionSourceAvailabilityReady
  const changesCwd = selectedChat ? (chatDetail?.cwd ?? selectedChat.cwd) : newSessionCwd
  const changesProjectCwd = selectedChat
    ? (chatDetail?.projectCwd ?? selectedChat.projectCwd ?? changesCwd)
    : newSessionCwd
  const changesContainer = selectedChat
    ? (chatDetail?.container ?? selectedChat.container)
    : newSessionContainer
  const changesContainerKey = getContainerTargetKey(changesContainer)
  const recentlyOpenedFilesWorkspaceKey = `${changesContainerKey}\0${changesCwd ?? ''}`
  const terminalWorkspaceKey = `${changesContainerKey}\0${changesProjectCwd ?? changesCwd ?? ''}`
  const browserWorkspaceKey =
    effectiveAppSettings.browser.view === 'global'
      ? 'global'
      : effectiveAppSettings.browser.view === 'chat'
        ? `chat:${selectedChatKey ?? `new:${terminalWorkspaceKey}`}`
        : `project:${terminalWorkspaceKey}`
  const gitAvailableForCurrentSource =
    gitSourceAvailability?.containerKey === changesContainerKey
      ? gitSourceAvailability.availability.gitAvailable
      : lastGitAvailable
  const gitAvailabilityError =
    gitSourceAvailability?.containerKey === changesContainerKey ? gitSourceAvailability.error : null
  const gitAvailabilityScopeKey: 'missing' | 'available' =
    gitAvailableForCurrentSource === false ? 'missing' : 'available'
  useEffect(() => {
    changesContainerRef.current = changesContainer
  }, [changesContainer])
  useEffect(() => {
    changeSourceRef.current = changeSource
  }, [changeSource])
  useEffect(() => {
    let active = true
    const container = normalizeContainerTarget(changesContainer)
    const containerKey = getContainerTargetKey(container)

    appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        if (!active) return

        setGitSourceAvailability({ containerKey, availability, error: null })
        setLastGitAvailable(availability.gitAvailable)
        setGitAvailabilityChangeId((currentChangeId) => {
          const previousAvailable = gitAvailableRef.current
          gitAvailableRef.current = availability.gitAvailable
          return previousAvailable === availability.gitAvailable
            ? currentChangeId
            : currentChangeId + 1
        })
      })
      .catch((error) => {
        if (!active) return

        setGitSourceAvailability({
          containerKey,
          availability: {
            gitAvailable: false,
            providers: providerIds.map((providerId) => ({ providerId, available: false }))
          },
          error: getErrorMessage(error, 'Unable to check Git availability.')
        })
        setLastGitAvailable(false)
        setGitAvailabilityChangeId((currentChangeId) => {
          const previousAvailable = gitAvailableRef.current
          gitAvailableRef.current = false
          return previousAvailable === false ? currentChangeId : currentChangeId + 1
        })
      })

    return () => {
      active = false
    }
  }, [changesContainer, changesContainerKey, gitBranchLoadRequest, gitChangeLoadRequest])
  const handleChangesPaneViewChange = useCallback(
    (view: ChangesPaneView): void => {
      if (view === 'browser' && !effectiveAppSettings.browser.enabled) return

      if (view === 'terminal') {
        setTerminalOpened(true)
      } else {
        if (view === 'browser') setBrowserOpened(true)
        lastNonTerminalChangesPaneViewRef.current = view
      }

      setChangesPaneView(view)
    },
    [effectiveAppSettings.browser.enabled]
  )
  const handleToggleTerminal = useCallback((): void => {
    handleChangesPaneViewChange(
      changesPaneView === 'terminal' ? lastNonTerminalChangesPaneViewRef.current : 'terminal'
    )
  }, [changesPaneView, handleChangesPaneViewChange])
  const handleRunAction = useCallback(
    async (action: AppAction): Promise<void> => {
      const targetCwd = changesCwd
      const markActionUsed = (): void => {
        setAppSettings((currentSettings) =>
          currentSettings.lastActionId === action.id
            ? currentSettings
            : {
                ...currentSettings,
                lastActionId: action.id
              }
        )
      }

      if (action.type === 'prompt') {
        await runPromptActionRef.current(action.prompt, action.sendInNewChat ? 'new' : 'current')
        markActionUsed()
        return
      }

      if (action.openInTerminal) {
        setTerminalOpened(true)
        setTerminalCommandLaunchRequest({
          id: crypto.randomUUID(),
          command: action.command,
          container: changesContainer,
          cwd: targetCwd,
          projectCwd: changesProjectCwd,
          workspaceKey: terminalWorkspaceKey,
          label: action.name,
          focus: true,
          closeOnFinish: action.closeTerminalOnFinish
        })
        handleChangesPaneViewChange('terminal')
        markActionUsed()
        return
      }

      await terminalApi.runCommand({
        command: action.command,
        container: changesContainer,
        cwd: targetCwd
      })
      markActionUsed()
    },
    [
      changesContainer,
      changesCwd,
      changesProjectCwd,
      handleChangesPaneViewChange,
      terminalWorkspaceKey
    ]
  )
  useEffect(
    () => appApi.onWindowZoomLevelUpdated((level) => updateAppearanceZoomLevel(level)),
    [updateAppearanceZoomLevel]
  )
  useEffect(() => {
    const handleTerminalShortcut = (event: KeyboardEvent): void => {
      if (settingsOpen || fileEditorTarget) return
      if (
        event.code !== 'Backquote' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      handleToggleTerminal()
    }

    document.addEventListener('keydown', handleTerminalShortcut, true)
    return () => document.removeEventListener('keydown', handleTerminalShortcut, true)
  }, [fileEditorTarget, handleToggleTerminal, settingsOpen])
  useEffect(() => {
    const handleActionShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || settingsOpen || fileEditorTarget) return
      if (isAppActionShortcutTargetBlocked(event.target)) return

      const keybinding = getAppActionKeybindingFromEvent(event)
      if (!keybinding) return

      const action = getAppActionsForProject(appSettings.actions, changesProjectCwd).find(
        (candidateAction) => candidateAction.keybinding === keybinding
      )
      if (!action) return

      event.preventDefault()
      event.stopPropagation()
      void handleRunAction(action)
    }

    document.addEventListener('keydown', handleActionShortcut, true)
    return () => document.removeEventListener('keydown', handleActionShortcut, true)
  }, [appSettings.actions, changesProjectCwd, fileEditorTarget, handleRunAction, settingsOpen])
  useEffect(() => {
    changesCwdRef.current = changesCwd
  }, [changesCwd])
  const pendingApproval = chatDetail?.pendingApproval ?? null
  const currentApprovalResolution =
    approvalResolution.approvalId === pendingApproval?.id ? approvalResolution : null
  const approvalDecisionInFlight = currentApprovalResolution?.decision ?? null
  const resolvingApprovalId = approvalResolution.decision ? approvalResolution.approvalId : null
  const approvalError = currentApprovalResolution?.error ?? null
  const pendingUserInput = chatDetail?.pendingUserInput ?? null
  const pendingUserInputId = pendingUserInput?.id ?? null
  const currentUserInputResolution =
    userInputResolution.requestId === pendingUserInput?.id ? userInputResolution : null
  const userInputResolving = currentUserInputResolution?.resolving ?? false
  const userInputError = currentUserInputResolution?.error ?? null
  const refreshAccountUsage = useCallback(
    async (options: ProviderUsageOptions = {}): Promise<void> => {
      if (!usageProviderAvailable) {
        setAccountUsage(null)
        setAccountUsageState(usageProviderAvailabilityReady ? 'ready' : 'loading')
        setAccountUsageError(null)
        return
      }

      const providerId = usageProviderId
      const container = normalizeContainerTarget(changesContainer)
      setAccountUsageState('loading')
      setAccountUsageError(null)

      try {
        const usage = await providerApi.getUsage(providerId, { ...options, container })
        setAccountUsage((currentUsage) => mergeAccountUsage(currentUsage, usage))
        setAccountUsageState('ready')
      } catch (error) {
        setAccountUsageState('error')
        setAccountUsageError(getErrorMessage(error, 'Unable to load usage.'))
      }
    },
    [changesContainer, usageProviderAvailabilityReady, usageProviderAvailable, usageProviderId]
  )
  const resetAccountRateLimits = useCallback(() => {
    if (!usageProviderAvailable) return Promise.resolve('nothingToReset' as const)

    return providerApi.resetRateLimits(usageProviderId, {
      container: normalizeContainerTarget(changesContainer)
    })
  }, [changesContainer, usageProviderAvailable, usageProviderId])
  useEffect(() => {
    let active = true

    if (
      !usageProviderAvailabilityReady ||
      !usageProviderAvailable ||
      (!selectedChatId && loadState === 'loading')
    ) {
      queueMicrotask(() => {
        if (!active) return
        setAccountUsage(null)
        setAccountUsageState(
          usageProviderAvailabilityReady && usageProviderAvailable && loadState !== 'loading'
            ? 'ready'
            : 'loading'
        )
        setAccountUsageError(null)
      })

      return () => {
        active = false
      }
    }

    const providerId = usageProviderId
    const container = normalizeContainerTarget(changesContainer)

    queueMicrotask(() => {
      if (!active) return
      setAccountUsageState('loading')
      setAccountUsageError(null)
    })

    providerApi
      .getUsage(providerId, { container })
      .then((usage) => {
        if (!active) return
        setAccountUsage((currentUsage) => mergeAccountUsage(currentUsage, usage))
        setAccountUsageState('ready')
      })
      .catch((error) => {
        if (!active) return
        setAccountUsageState('error')
        setAccountUsageError(getErrorMessage(error, 'Unable to load usage.'))
      })

    return () => {
      active = false
    }
  }, [
    changesContainer,
    loadState,
    selectedChatId,
    selectedChatStatus,
    usageProviderAvailabilityReady,
    usageProviderAvailable,
    usageProviderId,
    providerAccountRevision
  ])
  useEffect(() => {
    if (!selectedProviderId || !selectedChatId) return

    let active = true

    providerApi
      .getChat(selectedProviderId, selectedChatId)
      .then((detail) => {
        if (!active) return
        const currentDetail = chatDetailRef.current
        if (isChatDetailSnapshotStale(detail, currentDetail)) {
          setChatLoadState('ready')
          return
        }
        const loadedDetail =
          shouldPreserveOptimisticTurnUntilUserMessage(selectedProviderId) &&
          isActiveChatStatus(detail.status)
            ? preserveOptimisticChatDetail(currentDetail, detail)
            : detail
        chatDetailRef.current = loadedDetail
        cacheRecentChatDetail(
          selectedProviderId,
          loadedDetail,
          selectedChatUpdatedAtRef.current ?? Date.now(),
          true
        )
        startTransition(() => {
          setChatDetail(loadedDetail)
          setChatLoadState('ready')
        })
        markChatSeenAt(selectedProviderId, selectedChatId, Date.now())
      })
      .catch(() => {
        if (active) setChatLoadState('error')
      })

    return () => {
      active = false
    }
  }, [cacheRecentChatDetail, chatLoadRequest, markChatSeenAt, selectedProviderId, selectedChatId])
  useLayoutEffect(() => {
    if (!chatDetail || !selectedChatKey) {
      chatInitialLayoutKeyRef.current = null
      return
    }

    const contentElement = contentRef.current
    if (!contentElement) return

    const initialLayout = chatInitialLayoutKeyRef.current !== selectedChatKey
    chatInitialLayoutKeyRef.current = selectedChatKey
    if (initialLayout) {
      selectedChatKeyRef.current = selectedChatKey
      chatAutoScrollEnabledRef.current = true
      chatUserScrollIntentRef.current = false
      chatAutoScrollTargetRef.current = null
    } else if (!chatAutoScrollEnabledRef.current) {
      return
    }

    if (initialLayout || !isActiveChatStatus(chatDetail.status)) {
      scrollChatContentToBottom(contentElement)
    }
  }, [chatDetail, scrollChatContentToBottom, selectedChatCommitMarkers, selectedChatKey])
  useEffect(() => {
    if (!pendingUserInputId) return

    const contentElement = contentRef.current
    if (!contentElement) return

    chatAutoScrollEnabledRef.current = true
    chatUserScrollIntentRef.current = false
    chatAutoScrollTargetRef.current = null
    scrollChatContentToBottom(contentElement)
    scheduleChatAutoScroll(contentElement)
  }, [pendingUserInputId, scheduleChatAutoScroll, scrollChatContentToBottom])
  useEffect(() => {
    chatAutoScrollEnabledRef.current = true
    loadedWorkingStepIdsRef.current = []
    chatAutoScrollTargetRef.current = null
    chatScrollAdjustmentTargetRef.current = null
    pendingChatScrollAnchorRef.current = null
    chatViewportAnchorRef.current = null
    previousChatScrollTopRef.current = null
    scheduleChatAutoScroll()
    resetDocumentScroll()
  }, [scheduleChatAutoScroll, selectedProviderId, selectedChatId])
  useEffect(() => {
    if (!selectedChatKey) return

    const contentElement = contentRef.current
    const contentInnerElement = contentElement?.querySelector<HTMLElement>(
      '.chat-detail__messages-inner'
    )
    if (!contentElement || !contentInnerElement) return

    const observer = new ResizeObserver(() => {
      if (contentRef.current !== contentElement || !contentElement.contains(contentInnerElement)) {
        return
      }

      if (chatAutoScrollEnabledRef.current) {
        // Media resolves asynchronously after the initial chat layout. Correct the bottom
        // position inside ResizeObserver so the intermediate height never reaches a paint.
        scrollChatContentToBottom(contentElement)
        return
      }

      const anchor = chatViewportAnchorRef.current
      if (pendingChatScrollAnchorRef.current || !anchor || anchor.chatKey !== selectedChatKey) {
        return
      }

      const previousScrollTop = contentElement.scrollTop
      if (!restoreChatScrollAnchor(contentElement, anchor)) return
      if (contentElement.scrollTop !== previousScrollTop) {
        chatScrollAdjustmentTargetRef.current = {
          element: contentElement,
          top: contentElement.scrollTop
        }
      }
      chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, selectedChatKey)
    })
    observer.observe(contentElement)
    observer.observe(contentInnerElement)

    return () => observer.disconnect()
  }, [scrollChatContentToBottom, selectedChatKey])
  useEffect(() => {
    if (selectedChat) return

    chatAutoScrollEnabledRef.current = true
    chatAutoScrollTargetRef.current = null
    chatScrollAdjustmentTargetRef.current = null
    pendingChatScrollAnchorRef.current = null
    chatViewportAnchorRef.current = null
    previousChatScrollTopRef.current = null
    contentRef.current?.scrollTo({ top: 0 })
    resetDocumentScroll()
  }, [selectedChat])
  const focusSearchInput = useCallback((searchInput: HTMLInputElement | null): void => {
    if (!searchInput) return

    const focusInput = (): void => {
      if (!searchInput.isConnected) return

      window.focus()
      searchInput.focus({ preventScroll: true })
      const caretPosition = searchInput.value.length
      searchInput.setSelectionRange(caretPosition, caretPosition)
    }

    focusInput()
    window.requestAnimationFrame(focusInput)
  }, [])
  useLayoutEffect(() => {
    if (searchOpen) focusSearchInput(searchInputRef.current)
  }, [focusSearchInput, searchOpen])
  const closeChatSearch = useCallback((): void => {
    const returnFocusElement = chatSearchReturnFocusRef.current

    resetChatSearch()

    const contentElement = contentRef.current
    const currentTurnWindow = chatTurnWindowRef.current
    chatAutoScrollEnabledRef.current = contentElement
      ? Boolean(
          isScrolledToBottom(contentElement) &&
          currentTurnWindow &&
          currentTurnWindow.endIndex >= currentTurnWindow.totalCount
        )
      : true
    if (chatAutoScrollEnabledRef.current) {
      scheduleChatAutoScroll(contentElement)
    } else {
      chatAutoScrollTargetRef.current = null
    }

    window.requestAnimationFrame(() => {
      if (returnFocusElement?.isConnected) returnFocusElement.focus({ preventScroll: true })
    })
  }, [resetChatSearch, scheduleChatAutoScroll])
  const openChatSearch = useCallback((): void => {
    if (!selectedChatKey) return

    if (!chatSearchOpen && document.activeElement instanceof HTMLElement) {
      chatSearchReturnFocusRef.current = document.activeElement
    }

    flushSync(() => setChatSearchOpen(true))
    focusSearchInput(chatSearchInputRef.current)
    chatSearchInputRef.current?.select()
  }, [chatSearchOpen, focusSearchInput, selectedChatKey])
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || settingsOpen || fileEditorTarget) return

      if (
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === 'f' &&
        selectedChatKey
      ) {
        event.preventDefault()
        if (chatSearchOpen) closeChatSearch()
        else openChatSearch()
        return
      }

      if (event.key === 'Escape' && chatSearchOpen) {
        event.preventDefault()
        closeChatSearch()
      }
    }

    document.addEventListener('keydown', handleSearchShortcut)

    return () => document.removeEventListener('keydown', handleSearchShortcut)
  }, [
    chatSearchOpen,
    closeChatSearch,
    fileEditorTarget,
    openChatSearch,
    selectedChatKey,
    settingsOpen
  ])
  useLayoutEffect(() => {
    if (chatSearchOpen) focusSearchInput(chatSearchInputRef.current)
  }, [chatSearchOpen, focusSearchInput])
  useEffect(() => {
    if (!chatSearchOpen) return

    const searchContent = chatSearchContentRef.current
    if (!searchContent) return

    let searchFrame: number | null = null

    const refreshMatches = (resetActiveMatch: boolean): void => {
      const matches = findChatSearchMatches(searchContent, chatSearchQuery)
      const activeIndex =
        matches.length === 0
          ? 0
          : resetActiveMatch
            ? 0
            : Math.min(chatSearchActiveIndexRef.current, matches.length - 1)

      chatSearchMatchesRef.current = matches
      chatSearchActiveIndexRef.current = activeIndex
      setChatSearchMatchCount(matches.length)
      setChatSearchActiveIndex(activeIndex)
      setChatSearchHighlights(matches, activeIndex)
      chatAutoScrollEnabledRef.current = false
      chatAutoScrollTargetRef.current = null

      if (resetActiveMatch && matches[activeIndex]) {
        scrollChatSearchMatchIntoView(
          matches[activeIndex],
          contentRef.current ?? searchContent,
          'auto'
        )
      }
    }

    refreshMatches(true)

    const observer = new MutationObserver(() => {
      if (searchFrame !== null) window.cancelAnimationFrame(searchFrame)

      searchFrame = window.requestAnimationFrame(() => {
        searchFrame = null
        refreshMatches(false)
      })
    })
    observer.observe(searchContent, { characterData: true, childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (searchFrame !== null) window.cancelAnimationFrame(searchFrame)
      clearChatSearchHighlights()
    }
  }, [chatSearchOpen, chatSearchQuery, selectedChatKey])
  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (!active) return

      setGitBranchActionState('idle')
      setGitBranchError(null)
      setGitBranchDeleteRetry(null)
      setGitBranchWorktreeDeleteRetry(null)
      setGitChangeLoadError(null)
      setUncommittedPatchFilterError(null)
      setGitChangeLoadErrorDismissed(false)
    })

    return () => {
      active = false
    }
  }, [changesCwd, newChatOpen, selectedChatId, selectedProviderId])
  useEffect(() => {
    let active = true

    appApi
      .getDefaultCwd()
      .then((cwd) => {
        if (active) {
          setDefaultCwd(cwd)
          setNewSessionCwd(cwd)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    let active = true
    const requestId = ++gitBranchRequestIdRef.current

    if (!changesCwd) {
      queueMicrotask(() => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(null)
        setGitBranchesScope(null)
        setGitBranchLoadState('ready')
      })

      return () => {
        active = false
      }
    }

    const scope: GitBranchesScope = { sourceKey: gitAvailabilityScopeKey, cwd: changesCwd }

    if (gitAvailableForCurrentSource === false) {
      queueMicrotask(() => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(null)
        setGitBranchesScope(scope)
        setGitBranchLoadState('error')
        setGitBranchError(gitAvailabilityError ?? 'Git is not available in this source.')
      })

      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (!active || gitBranchRequestIdRef.current !== requestId) return
      setGitBranchLoadState('loading')
      setGitBranchError(null)
      setGitBranchDeleteRetry(null)
      setGitBranchWorktreeDeleteRetry(null)
    })

    appApi
      .getGitBranches({ container: changesContainerRef.current, cwd: changesCwd })
      .then((result) => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(result)
        setGitBranchesScope(scope)
        setGitBranchLoadState('ready')
      })
      .catch((error) => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranchLoadState('error')
        setGitBranchError(getErrorMessage(error, 'Unable to load branches.'))
      })

    return () => {
      active = false
    }
  }, [
    changesCwd,
    gitAvailabilityError,
    gitAvailabilityChangeId,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    gitBranchLoadRequest
  ])
  useEffect(() => {
    if (!changesCwd) return

    let active = true
    const gitChangeSource: GitChangeSource = 'uncommitted'
    const gitChangeScope: GitChangesScope = {
      sourceKey: gitAvailabilityScopeKey,
      cwd: changesCwd,
      source: gitChangeSource
    }
    const visibleChangeSource = changeSourceRef.current

    if (gitAvailableForCurrentSource === false) {
      queueMicrotask(() => {
        if (!active) return
        const error = gitAvailabilityError ?? 'Git is not available in this source.'
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadErrorDismissed(false)
        setGitChangeLoadError({
          scope: gitChangeScope,
          cwd: changesCwd,
          error,
          operation: 'Load Git changes'
        })
        if (visibleChangeSource === 'uncommitted') setGitChangeLoadState('error')
      })

      return () => {
        active = false
      }
    }

    if (visibleChangeSource === 'uncommitted') {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadErrorDismissed(false)
        setGitChangeLoadError(null)
        setGitChangeLoadState('loading')
      })
    }

    appApi
      .getGitChanges({
        container: changesContainerRef.current,
        cwd: changesCwd,
        source: gitChangeSource
      })
      .then((result) => {
        if (!active) return
        setGitChanges(result)
        setGitChangesScope(gitChangeScope)
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadErrorDismissed(false)
        setGitChangeLoadError(null)
        if (changeSourceRef.current === 'uncommitted') setGitChangeLoadState('ready')
      })
      .catch((error) => {
        if (!active) return
        const message = getErrorMessage(error, 'Unable to load changes.')
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadErrorDismissed(false)
        setGitChangeLoadError({
          scope: gitChangeScope,
          cwd: changesCwd,
          error: message,
          operation: 'Load Git changes'
        })
        if (changeSourceRef.current === 'uncommitted') setGitChangeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [
    changesCwd,
    gitAvailabilityError,
    gitAvailabilityChangeId,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    gitChangeLoadRequest
  ])
  useEffect(() => {
    let active = true

    if (!changesCwd || !isPatchChangeSource(changeSource)) {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError(null)
        setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    const sourceFiles =
      changeSource === 'chat'
        ? getChatChangedFiles(chatDetail?.items)
        : getLastTurnChangedFiles(chatDetail?.items)
    const patches = getCommitPatches(sourceFiles)
    const scope: PatchFilterScope = {
      containerKey: changesContainerKey,
      cwd: changesCwd,
      source: changeSource,
      signature: getPatchFilterSignature(patches)
    }

    if (patches.length === 0) {
      queueMicrotask(() => {
        if (!active) return

        setUncommittedPatchFilter({ scope, patches: [] })
        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError(null)
        setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (!active) return
      setGitChangeLoadErrorDismissed(false)
      setUncommittedPatchFilterError(null)
      setUncommittedPatchFilterState('loading')
    })

    appApi
      .getUncommittedGitPatchChanges({ container: changesContainer, cwd: changesCwd, patches })
      .then((result) => {
        if (!active) return

        setUncommittedPatchFilter({ scope, patches: result.patches })
        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError(null)
        setUncommittedPatchFilterState('ready')
      })
      .catch((error) => {
        if (!active) return

        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError({
          scope,
          cwd: changesCwd,
          error: getErrorMessage(error, 'Unable to filter Git changes.'),
          operation: 'Filter Git changes'
        })
        setUncommittedPatchFilterState('error')
      })

    return () => {
      active = false
    }
  }, [
    changeSource,
    changesContainer,
    changesContainerKey,
    changesCwd,
    chatDetail?.items,
    gitChangeLoadRequest
  ])
  useEffect(() => {
    if (changesPaneView !== 'files' || !changesCwd) return

    let active = true
    const nextFileTreeScope: FileTreeScope = { containerKey: changesContainerKey, cwd: changesCwd }

    queueMicrotask(() => {
      if (!active) return
      setFileTreeLoadScope(nextFileTreeScope)
      setFileTreeLoadState('loading')
    })

    appApi
      .getFileTree({ container: changesContainer, cwd: changesCwd })
      .then((result) => {
        if (!active) return
        setFileTree(result)
        setFileTreeScope(nextFileTreeScope)
        setFileTreeLoadScope(nextFileTreeScope)
        setFileTreeLoadState('ready')
        setLastOpenedFileTreeFolderPath(
          lastOpenedFileTreeFolderByCwdRef.current.get(nextFileTreeScope.cwd) ?? null
        )
        const rememberedCollapsedFolders = collapsedFileTreeFoldersByCwdRef.current.get(
          nextFileTreeScope.cwd
        )
        const nextCollapsedFolders =
          rememberedCollapsedFolders ??
          getDefaultFileTreeCollapsedFolders(getRepositoryFiles(result))

        setCollapsedFileTreeFolders(nextCollapsedFolders)
        collapsedFileTreeFoldersByCwdRef.current.set(nextFileTreeScope.cwd, nextCollapsedFolders)
      })
      .catch(() => {
        if (!active) return
        setFileTreeLoadScope(nextFileTreeScope)
        setFileTreeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [changesContainer, changesContainerKey, changesCwd, changesPaneView, fileTreeLoadRequest])

  return {
    activeSubagentChatView,
    approvalDecisionInFlight,
    approvalError,
    browserWorkspaceKey,
    changesContainer,
    changesContainerKey,
    changesCwd,
    changesProjectCwd,
    closeChatSearch,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    handleChangesPaneViewChange,
    handleRunAction,
    messageBoxPlan,
    pendingApproval,
    pendingUserInput,
    recentlyOpenedFilesWorkspaceKey,
    refreshAccountUsage,
    resetAccountRateLimits,
    resolvingApprovalId,
    scopedCommitActivitiesByMarkerId,
    selectedChatCommitMarkers,
    selectedChatId,
    selectedChatKey,
    selectedChatSubagents,
    selectedProviderId,
    terminalWorkspaceKey,
    userInputError,
    userInputResolving
  }
}
