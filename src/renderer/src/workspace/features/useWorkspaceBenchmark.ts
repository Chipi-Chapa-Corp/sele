import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppContainerTarget, AppGitBenchmarkWorktrees } from '../../../../shared/app'
import { getProviderChatTurns } from '../../../../shared/chatTurns'
import type {
  ProviderBenchmarkOutcome,
  ProviderBenchmarkResult,
  ProviderBenchmarkCheckpoint,
  ProviderBenchmarkSide,
  ProviderChatDetail,
  ProviderId,
  ProviderTurnOptions,
  ProviderWorkingStep
} from '../../../../shared/provider'
import { appApi } from '../../appApi'
import {
  alignBenchmarkTurns,
  getBenchmarkTurnModel,
  getBenchmarkHistoryCheckpoint,
  getClosedBenchmarkRounds,
  getLatestBenchmarkRound,
  getUserTurnStart,
  joinBenchmarkItems,
  retainBenchmarkHistory,
  splitBenchmarkSideHistory,
  type BenchmarkRound,
  type BenchmarkSideHistory
} from '../../benchmark'
import { getContainerTargetKey } from '../../containerSelection'
import {
  getApprovalAccessOptions,
  type MessageBoxSelection,
  writeStoredChatMessageBoxSelections
} from '../../messageBoxPreferences'
import { providerApi } from '../../providerApi'
import { preferences } from '../../preferences'
import {
  modelHasReasoningEffortOptions,
  getDefaultReasoningEffort
} from '../appearanceControllerUtils'
import {
  chatWorkingItemPageSize,
  chatWorkingItemWindowSize,
  chatWorkingToolPageSize,
  chatWorkingToolWindowSize,
  loadedWorkingStepCacheSize
} from '../controllerTypes'
import { mergeWorkingStepPage, mergeWorkingToolPage } from '../../chatDetailWindow'
import { getChatCwdGroupKey, getChatKey, isActiveChatStatus } from '../chatControllerUtils'
import { useLatestHandler } from '../stableProps'
import type { WorkspaceSession } from '../useWorkspaceSelection'
import type { useWorkspaceChatErrors } from './useWorkspaceChatErrors'
import type { useWorkspaceEffectiveSelection } from './useWorkspaceEffectiveSelection'

type DraftBenchmark = {
  scope: string
  worktrees: AppGitBenchmarkWorktrees
  container: AppContainerTarget | null
}

const sideHistoryKey = (chatKey: string): string => `sele:benchmark-side-history:v1:${chatKey}`

const readSideHistory = (chatKey: string): BenchmarkSideHistory | null => {
  const value = preferences.getItem(sideHistoryKey(chatKey))
  if (!value) return null
  try {
    return JSON.parse(value) as BenchmarkSideHistory
  } catch {
    return null
  }
}

const removeDraftWorktrees = async ({ worktrees, container }: DraftBenchmark): Promise<void> => {
  const failures: unknown[] = []
  for (const { worktreePath } of [worktrees.primary, worktrees.secondary]) {
    try {
      await appApi.removeGitBenchmarkWorktree({
        container,
        cwd: worktrees.repositoryRoot,
        worktreePath
      })
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw failures[0]
}

export function useWorkspaceBenchmark({
  chatState,
  sourceState,
  session,
  providerState,
  provider,
  effectiveSelection,
  chatErrors,
  chatRead,
  chatProjection,
  gitState
}: WorkspaceSession & {
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
}) {
  const { selectedChat, chatDetail, benchmarkDetail, applyBenchmarkDetail } = chatState
  const { newSessionCwd, newSessionNoProject, newSessionProvider, newChatOpen } = sourceState
  const { changesContainer, activeSubagentChatView } = session
  const [draftState, setDraft] = useState<DraftBenchmark | null>(null)
  const draftRef = useRef<DraftBenchmark | null>(null)
  const [draftSelection, setDraftSelection] = useState<Partial<MessageBoxSelection>>({})
  const [selectionRevision, setSelectionRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sideHistoryRevision, setSideHistoryRevision] = useState(0)
  const busyRef = useRef(false)
  const [resultsState, setResults] = useState<{
    chatKey: string
    results: ProviderBenchmarkResult[]
  } | null>(null)
  const [loadedSteps, setLoadedSteps] = useState<{
    chatId: string
    steps: Map<string, ProviderWorkingStep>
  } | null>(null)
  const [olderPage, setOlderPage] = useState<{
    chatId: string
    items: ProviderChatDetail['items']
  } | null>(null)

  const chatKey = selectedChat ? getChatKey(selectedChat) : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: The revision tracks changes to the persisted side history.
  const sideHistory = useMemo(
    () => (chatKey ? readSideHistory(chatKey) : null),
    [chatKey, sideHistoryRevision]
  )
  const companionId = selectedChat?.benchmarkChatId ?? null
  const companion = companionId && benchmarkDetail?.id === companionId ? benchmarkDetail : null
  const selectedProvider = selectedChat?.providerId
  const scope =
    !selectedChat && newChatOpen
      ? JSON.stringify([
          getContainerTargetKey(changesContainer),
          newSessionCwd,
          newSessionNoProject,
          newSessionProvider
        ])
      : null
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const draft = draftState?.scope === scope ? draftState : null
  const ended = selectedChat?.benchmarkEnded === true
  const active = !activeSubagentChatView && Boolean(draft || (companionId && !ended))
  const branchProjectKey = getChatCwdGroupKey(session.changesProjectCwd ?? session.changesCwd)
  const switchingBranch = active && gitState.branchActionProjectKeys.has(branchProjectKey)
  const companionActive = Boolean(active && isActiveChatStatus(companion?.status))
  const blocked =
    busy ||
    switchingBranch ||
    Boolean(active && companionId && (!companion || resultsState?.chatKey !== chatKey))
  const working = isActiveChatStatus(chatDetail?.status) || isActiveChatStatus(companion?.status)

  const saveSideHistory = (key: string, next: BenchmarkSideHistory | null): void => {
    if (next) preferences.setItem(sideHistoryKey(key), JSON.stringify(next))
    else preferences.removeItem(sideHistoryKey(key))
    setSideHistoryRevision((value) => value + 1)
  }

  const appendSideTurn = (
    key: string,
    side: ProviderBenchmarkSide,
    checkpoint: ProviderBenchmarkCheckpoint
  ) => {
    const previous = readSideHistory(key)
    saveSideHistory(key, {
      checkpoint: previous?.checkpoint ?? checkpoint,
      order: [...(previous?.order ?? []), side]
    })
    return () => saveSideHistory(key, previous)
  }

  const checkpoint = async (): Promise<ProviderBenchmarkCheckpoint> => {
    if (sideHistory) return sideHistory.checkpoint
    if (!selectedChat || !companion) throw new Error('Both benchmark chats must be ready.')
    const [primary, secondary] = await Promise.all([
      providerApi.getChat(selectedChat.providerId, selectedChat.id),
      providerApi.getChat(selectedChat.providerId, companion.id)
    ])
    return getBenchmarkHistoryCheckpoint(primary.items, secondary.items)
  }

  const selection = useMemo<MessageBoxSelection>(
    () => ({
      agentMode: effectiveSelection.effectiveAgentMode,
      approvalMode: effectiveSelection.effectiveApprovalMode,
      model: effectiveSelection.effectiveModel,
      reasoningEffort: effectiveSelection.effectiveReasoningEffort,
      sandboxMode: effectiveSelection.effectiveSandboxMode,
      serviceTier: effectiveSelection.effectiveServiceTier
    }),
    [
      effectiveSelection.effectiveAgentMode,
      effectiveSelection.effectiveApprovalMode,
      effectiveSelection.effectiveModel,
      effectiveSelection.effectiveReasoningEffort,
      effectiveSelection.effectiveSandboxMode,
      effectiveSelection.effectiveServiceTier
    ]
  )
  const companionKey =
    selectedProvider && companionId
      ? getChatKey({ providerId: selectedProvider, id: companionId })
      : null
  const secondarySelection = useMemo(
    () => ({
      ...selection,
      ...(companionKey
        ? providerState.chatMessageBoxSelectionsRef.current[companionKey]
        : draftSelection)
      // A secondary selection is saved via the existing per-chat preferences.
      // biome-ignore lint/correctness/useExhaustiveDependencies: selectionRevision signals a preference write.
    }),
    [
      selection,
      companionKey,
      draftSelection,
      selectionRevision,
      providerState.chatMessageBoxSelectionsRef
    ]
  )

  const rememberSelection = (providerId: ProviderId, chatId: string): void => {
    providerState.chatMessageBoxSelectionsRef.current[getChatKey({ providerId, id: chatId })] =
      secondarySelection
    writeStoredChatMessageBoxSelections(providerState.chatMessageBoxSelectionsRef.current)
  }

  const changeSelection = (changes: Partial<MessageBoxSelection>): void => {
    const next = { ...secondarySelection, ...changes }
    if (changes.model && changes.reasoningEffort === undefined) {
      next.reasoningEffort = getDefaultReasoningEffort(
        provider.models.find(({ id }) => id === changes.model)
      )
    }
    if (next.sandboxMode === 'danger-full-access') next.approvalMode = 'never'
    else if (
      secondarySelection.sandboxMode === 'danger-full-access' &&
      changes.approvalMode === undefined
    )
      next.approvalMode = 'ask-user'

    if (!companionKey) setDraftSelection(next)
    else {
      providerState.chatMessageBoxSelectionsRef.current[companionKey] = next
      writeStoredChatMessageBoxSelections(providerState.chatMessageBoxSelectionsRef.current)
      setSelectionRevision((value) => value + 1)
    }
  }

  const getSecondaryOptions = (base: ProviderTurnOptions, cwd: string): ProviderTurnOptions => ({
    ...base,
    ...getApprovalAccessOptions(secondarySelection.approvalMode, secondarySelection.sandboxMode),
    agentMode: secondarySelection.agentMode,
    additionalDirectories: undefined,
    cwd,
    model: secondarySelection.model,
    promptSuggestions: false,
    reasoningEffort: modelHasReasoningEffortOptions(
      provider.models.find(({ id }) => id === secondarySelection.model)
    )
      ? secondarySelection.reasoningEffort
      : undefined,
    review: base.review ? { ...base.review, id: crypto.randomUUID() } : undefined,
    sandboxMode: secondarySelection.sandboxMode,
    serviceTier: secondarySelection.serviceTier
  })

  const takeDraft = (): DraftBenchmark | null => {
    const current = draftRef.current
    if (!current || current.scope !== scopeRef.current) return null
    draftRef.current = null
    setDraft(null)
    return current
  }

  useEffect(() => {
    const previous = draftRef.current
    if (!previous || previous.scope === scope) return
    draftRef.current = null
    void removeDraftWorktrees(previous).catch((error) =>
      chatErrors.handleSendFailure(error, 'Unable to remove benchmark worktrees.')
    )
  }, [scope, chatErrors.handleSendFailure])

  useEffect(() => {
    if (!selectedProvider || !companionId || !chatKey) return
    let current = true
    void Promise.all([
      providerApi.getChat(selectedProvider, companionId),
      providerApi.getBenchmarkResults(selectedProvider, selectedChat.id)
    ])
      .then(([detail, results]) => {
        if (!current) return
        applyBenchmarkDetail(detail)
        setResults((previous) =>
          previous?.chatKey === chatKey
            ? {
                chatKey,
                results: [
                  ...new Map(
                    [...results, ...previous.results].map((result) => [result.turnId, result])
                  ).values()
                ]
              }
            : { chatKey, results }
        )
      })
      .catch((error) => {
        if (current) chatErrors.handleSendFailure(error, 'Unable to load benchmark history.')
      })
    return () => {
      current = false
    }
  }, [
    selectedProvider,
    companionId,
    chatKey,
    selectedChat?.id,
    applyBenchmarkDetail,
    chatErrors.handleSendFailure,
    chatState.chatLoadRequest
  ])

  const primaryStart = chatDetail?.itemsStartTurnIndex ?? 0
  const secondaryStart = companion?.itemsStartTurnIndex ?? 0
  const olderItems = olderPage?.chatId === companionId ? olderPage.items : null
  const retained = useRef<{
    id: string
    older: ProviderChatDetail['items']
    live: ProviderChatDetail['items']
  } | null>(null)
  const liveItems = companion?.items
  const storedCompanionItems = useMemo(() => {
    if (!liveItems || !companionId) return []
    const previous = retained.current?.id === companionId ? retained.current : null
    const older = previous
      ? (retainBenchmarkHistory(previous.older, previous.live, liveItems) ?? [])
      : []
    retained.current = { id: companionId, older, live: liveItems }
    return joinBenchmarkItems(olderItems ?? [], joinBenchmarkItems(older, liveItems))
  }, [companionId, liveItems, olderItems])

  const companionItems = useMemo(
    () =>
      loadedSteps && loadedSteps.chatId === companionId
        ? storedCompanionItems.map((item) =>
            item.type === 'working' && item.status !== 'working'
              ? (loadedSteps.steps.get(item.id) ?? item)
              : item
          )
        : storedCompanionItems,
    [storedCompanionItems, loadedSteps, companionId]
  )
  const getWorkingStep = (id: string) =>
    companionItems.find(
      (item): item is ProviderWorkingStep => item.type === 'working' && item.id === id
    )
  const updateWorkingStep = (
    id: string,
    update: (step: ProviderWorkingStep) => ProviderWorkingStep
  ): void => {
    if (!companionId || chatState.selectedChatRef.current?.benchmarkChatId !== companionId) return
    const step = getWorkingStep(id)
    if (!step) return
    setLoadedSteps((previous) => {
      const steps = new Map(previous?.chatId === companionId ? previous.steps : [])
      const next = update(steps.get(id) ?? step)
      steps.delete(id)
      steps.set(id, next)
      if (steps.size > loadedWorkingStepCacheSize) steps.delete(steps.keys().next().value!)
      return { chatId: companionId, steps }
    })
  }
  const loadWorkingStep = async (id: string, requestedStart?: number): Promise<void> => {
    if (!selectedProvider || !companionId) return
    const step = getWorkingStep(id)
    const start =
      requestedStart ??
      Math.max(0, (step?.itemCount ?? step?.items.length ?? 0) - chatWorkingItemPageSize)
    const page = await providerApi.getChatWorkingStepPage(
      selectedProvider,
      companionId,
      id,
      start,
      chatWorkingItemPageSize
    )
    updateWorkingStep(id, (current) =>
      mergeWorkingStepPage(current, page, chatWorkingItemPageSize, chatWorkingItemWindowSize)
    )
  }
  const loadWorkingItem = async (id: string, itemId: string): Promise<void> => {
    if (!selectedProvider || !companionId) return
    const loaded = await providerApi.getChatWorkingItem(selectedProvider, companionId, id, itemId)
    updateWorkingStep(id, (step) => {
      const replace = (item: ProviderWorkingStep['items'][number]) => {
        if (item.id === itemId) return loaded
        if (item.type !== 'toolGroup' || loaded.type !== 'tool') return item
        return { ...item, tools: item.tools.map((tool) => (tool.id === itemId ? loaded : tool)) }
      }
      return {
        ...step,
        items: step.items.map(replace),
        itemSegments: step.itemSegments?.map((segment) => ({
          ...segment,
          items: segment.items.map(replace)
        }))
      }
    })
  }
  const loadWorkingToolPage = async (id: string, itemId: string, start: number): Promise<void> => {
    if (!selectedProvider || !companionId) return
    const page = await providerApi.getChatWorkingToolPage(
      selectedProvider,
      companionId,
      id,
      itemId,
      start,
      chatWorkingToolPageSize
    )
    updateWorkingStep(id, (step) => {
      const merge = (item: ProviderWorkingStep['items'][number]) =>
        item.type === 'toolGroup' && item.id === itemId
          ? mergeWorkingToolPage(item, page, chatWorkingToolWindowSize)
          : item
      return {
        ...step,
        items: step.items.map(merge),
        itemSegments: step.itemSegments?.map((segment) => ({
          ...segment,
          items: segment.items.map(merge)
        }))
      }
    })
  }

  const earliestPrimary = useMemo(
    () => getProviderChatTurns(chatDetail?.items ?? []).find((turn) => getUserTurnStart(turn)),
    [chatDetail?.items]
  )
  const companionHasEarliest = useMemo(
    () =>
      Boolean(
        earliestPrimary &&
          alignBenchmarkTurns([earliestPrimary], getProviderChatTurns(storedCompanionItems)).size
      ),
    [earliestPrimary, storedCompanionItems]
  )
  const companionOlderCursor = companion?.turnPagination?.olderCursor ?? null
  useEffect(() => {
    if (!selectedProvider || !companionId || !earliestPrimary || companionHasEarliest) return
    if (!companionOlderCursor && secondaryStart <= primaryStart) return
    let current = true
    const fetchOlder = async (): Promise<void> => {
      let items: ProviderChatDetail['items'] = []
      if (companionOlderCursor) {
        let cursor: string | null = companionOlderCursor
        while (current && cursor) {
          const page = await providerApi.getChatTurnCursorPage(
            selectedProvider,
            companionId,
            'older',
            cursor,
            32
          )
          items = [...page.items, ...items]
          const found = alignBenchmarkTurns(
            [earliestPrimary],
            getProviderChatTurns(page.items)
          ).size
          const nextCursor = page.turnPagination?.olderCursor ?? null
          if (found || nextCursor === cursor) break
          cursor = nextCursor
        }
      } else {
        let startIndex = Math.max(0, primaryStart - 8)
        while (current && startIndex < secondaryStart) {
          const page = await providerApi.getChatTurnPage(
            selectedProvider,
            companionId,
            startIndex,
            Math.min(40, secondaryStart - startIndex)
          )
          const count = getProviderChatTurns(page.items).length
          if (!count || page.startIndex + count <= startIndex) break
          items.push(...page.items)
          startIndex = page.startIndex + count
        }
      }
      if (current) setOlderPage({ chatId: companionId, items })
    }
    void fetchOlder().catch((error) => {
      if (current) chatErrors.handleSendFailure(error, 'Unable to load earlier benchmark turns.')
    })
    return () => {
      current = false
    }
  }, [
    selectedProvider,
    companionId,
    secondaryStart,
    primaryStart,
    earliestPrimary,
    companionOlderCursor,
    companionHasEarliest,
    chatErrors.handleSendFailure
  ])

  const results = useMemo(
    () =>
      new Map(
        resultsState?.chatKey === chatKey
          ? resultsState?.results.map((result) => [result.turnId, result])
          : []
      ),
    [chatKey, resultsState]
  )
  const primaryItems = chatDetail?.items
  const sharedItems = useMemo(() => {
    if (!sideHistory || !primaryItems || !liveItems)
      return { primary: primaryItems, secondary: liveItems }
    const shared = splitBenchmarkSideHistory(
      getProviderChatTurns(primaryItems),
      getProviderChatTurns(liveItems),
      sideHistory
    )
    return {
      primary: shared.primary.flatMap(({ items }) => items),
      secondary: shared.secondary.flatMap(({ items }) => items)
    }
  }, [sideHistory, primaryItems, liveItems])
  const round = useMemo(
    () =>
      sharedItems.primary && sharedItems.secondary && !working && active
        ? getLatestBenchmarkRound(sharedItems.primary, sharedItems.secondary)
        : null,
    [sharedItems, working, active]
  )

  const record = async (
    outcome: ProviderBenchmarkOutcome,
    judged = round,
    discardLater = false
  ): Promise<void> => {
    if (!judged || !selectedChat || !companion || !chatKey) return
    const existing = results.get(judged.turnId)
    if (existing && (existing.outcome !== 'tie' || outcome === 'tie')) return
    const result = await providerApi.recordBenchmarkResult(selectedChat.providerId, {
      chatId: selectedChat.id,
      turnId: judged.turnId,
      secondaryTurnId: judged.secondary[0]?.id,
      outcome,
      discardLater,
      primary: {
        chatId: selectedChat.id,
        model: getBenchmarkTurnModel([judged.primary]) ?? selection.model,
        reasoningEffort: selection.reasoningEffort,
        serviceTier: selection.serviceTier
      },
      secondary: {
        chatId: companion.id,
        model: getBenchmarkTurnModel(judged.secondary) ?? secondarySelection.model,
        reasoningEffort: secondarySelection.reasoningEffort,
        serviceTier: secondarySelection.serviceTier
      }
    })
    if (chatState.selectedChatKeyRef.current === chatKey) {
      setResults((previous) => ({
        chatKey,
        results: [
          ...(previous?.chatKey === chatKey
            ? previous.results.filter(({ turnId }) => turnId !== result.turnId)
            : []),
          result
        ]
      }))
    }
  }

  const recordCurrent = useLatestHandler(record)
  const attemptedTies = useRef<{ key: string; turns: Set<string> } | null>(null)
  useEffect(() => {
    if (
      !active ||
      !chatKey ||
      resultsState?.chatKey !== chatKey ||
      !sharedItems.primary ||
      !sharedItems.secondary
    )
      return
    let current = true
    const attempted =
      attemptedTies.current?.key === chatKey ? attemptedTies.current.turns : new Set<string>()
    attemptedTies.current = { key: chatKey, turns: attempted }
    for (const previous of getClosedBenchmarkRounds(sharedItems.primary, sharedItems.secondary)) {
      if (results.has(previous.turnId) || attempted.has(previous.turnId)) continue
      attempted.add(previous.turnId)
      void recordCurrent('tie', previous).catch((error) => {
        if (current) chatErrors.handleSendFailure(error, 'Unable to save the benchmark tie.')
      })
    }
    return () => {
      current = false
    }
  }, [
    active,
    chatKey,
    sharedItems,
    results,
    resultsState?.chatKey,
    recordCurrent,
    chatErrors.handleSendFailure
  ])

  const run = async (action: () => Promise<void>, failure: string): Promise<void> => {
    if (
      busyRef.current ||
      chatState.sendInFlightRef.current ||
      (active && gitState.branchActionProjectKeysRef.current.has(branchProjectKey))
    )
      return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      chatErrors.handleSendFailure(error, failure)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const vote = (side: ProviderBenchmarkSide, judged: BenchmarkRound): void => {
    if (working || !judged.votable || !selectedChat || !companion || !chatKey) return
    const discardLater = round?.turnId !== judged.turnId || Boolean(sideHistory)
    if (discardLater && !window.confirm('Use this answer and discard the messages that follow it?'))
      return
    void run(async () => {
      await record(side, judged, discardLater)
      if (!discardLater) return
      saveSideHistory(chatKey, null)
      const [primary, secondary] = await Promise.all([
        providerApi.getChat(selectedChat.providerId, selectedChat.id),
        providerApi.getChat(selectedChat.providerId, companion.id)
      ])
      chatProjection.applyChatDetail(selectedChat.providerId, primary, { allowEqualRevision: true })
      if (chatState.selectedChatKeyRef.current === chatKey) applyBenchmarkDetail(secondary)
    }, 'Unable to save the benchmark vote.')
  }

  const sync = (side: 'primary' | 'secondary'): void => {
    if (!active || working || !chatDetail?.cwd || !companion?.cwd) return
    const primaryCwd = chatDetail.cwd
    const secondaryCwd = companion.cwd
    void run(async () => {
      await appApi.syncGitWorktreeState({
        container: changesContainer,
        cwd: side === 'primary' ? primaryCwd : secondaryCwd,
        targetCwd: side === 'primary' ? secondaryCwd : primaryCwd
      })
      gitState.setGitChangeLoadRequest((value) => value + 1)
      gitState.setGitBranchLoadRequest((value) => value + 1)
      gitState.setFileTreeLoadRequest((value) => value + 1)
    }, 'Unable to copy the benchmark worktree.')
  }

  const toggle = (): void => {
    void run(
      async () => {
        if (active && selectedChat && companionId) {
          if (working) throw new Error('Stop both agents before ending the benchmark.')
          if (chatKey && sideHistory) {
            const rewound = await providerApi.rewindChatBenchmark(
              selectedChat.providerId,
              selectedChat.id,
              sideHistory.checkpoint
            )
            chatProjection.applyChatDetail(selectedChat.providerId, rewound.primary, {
              allowEqualRevision: true
            })
            if (chatState.selectedChatKeyRef.current === chatKey)
              applyBenchmarkDetail(rewound.secondary)
            saveSideHistory(chatKey, null)
          }
          const metadata = await providerApi.endChatBenchmark(
            selectedChat.providerId,
            selectedChat.id
          )
          chatRead.applyChatMetadata([metadata])
          return
        }
        if (draft) {
          await removeDraftWorktrees(draft)
          takeDraft()
          return
        }
        if (!scope || !newSessionCwd || newSessionNoProject) {
          throw new Error('Choose a Git project before enabling Benchmark.')
        }
        const worktrees = await appApi.createGitBenchmarkWorktrees({
          cwd: newSessionCwd,
          container: changesContainer
        })
        const next = { scope, worktrees, container: changesContainer ?? null }
        if (scopeRef.current !== scope) {
          await removeDraftWorktrees(next)
          return
        }
        setDraftSelection(selection)
        draftRef.current = next
        setDraft(next)
      },
      active ? 'Unable to turn off Benchmark.' : 'Unable to enable Benchmark.'
    )
  }

  return {
    active,
    blocked,
    busy: busy || switchingBranch,
    busyRef,
    canToggle: !activeSubagentChatView && (active || (!selectedChat && newChatOpen)),
    toggleDisabled:
      busy ||
      switchingBranch ||
      working ||
      chatState.sendState === 'sending' ||
      Boolean(active && companionId && !companion),
    toggle,
    takeDraft,
    discardDraft: removeDraftWorktrees,
    worktrees: active
      ? {
          primary: {
            cwd: draft?.worktrees.primary.worktreePath ?? session.changesCwd,
            branchName: draft?.worktrees.primary.branchName ?? selectedChat?.branchName ?? null
          },
          secondary: {
            cwd: draft?.worktrees.secondary.worktreePath ?? companion?.cwd ?? null,
            branchName: draft?.worktrees.secondary.branchName ?? companion?.branchName ?? null
          }
        }
      : null,
    companion,
    companionActive,
    companionItems,
    sideHistory,
    appendSideTurn,
    clearSideHistory: (key: string) => saveSideHistory(key, null),
    checkpoint,
    loadWorkingStep,
    loadWorkingItem,
    loadWorkingToolPage,
    secondarySelection,
    changeSelection,
    rememberSelection,
    getSecondaryOptions,
    results,
    round,
    record,
    vote,
    sync,
    working,
    mergeSuggestion:
      ended && selectedChat?.worktreeBaseBranchName
        ? {
            id: `benchmark-merge:${selectedChat.id}`,
            text: `Merge current branch into ${selectedChat.worktreeBaseBranchName}`
          }
        : null
  }
}

export type WorkspaceBenchmark = ReturnType<typeof useWorkspaceBenchmark>
