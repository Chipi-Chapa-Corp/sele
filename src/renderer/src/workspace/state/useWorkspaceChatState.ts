import { useCallback, useRef, useState } from 'react'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatItem
} from '../../../../shared/provider'
import { type RecentChatReference } from '../../chatRecents'
import {
  chatSidebarFilters,
  readChatSidebarFilter,
  readChatSidebarTabs
} from '../../chatSidebarFilter'
import { useSleepingChats } from '../../chatSleep'
import { type ChatTurnWindow } from '../../chatTurnWindow'
import type { ChatPlanData } from '../../components/ChatPlan'
import type { MessageBoxQuoteRequest } from '../../components/MessageBox'
import { readManuallyUnreadChats } from '../../manualChatReadState'
import {
  readStoredPinnedRecentChatReferences,
  type PinnedRecentChatReferencesByChat
} from '../../recentReferencePins'
import {
  readStoredRecentlyOpenedFiles,
  type RecentlyOpenedFilesByWorkspace
} from '../../recentlyOpenedFiles'
import { usePreferenceState } from '../../usePreferenceState'
import {
  type ApprovalResolutionState,
  type ChatTurnPageLoadDirection,
  type CommittedChatUpdate,
  type EditingMessage,
  type LoadState,
  type SendState,
  type UserInputResolutionState
} from '../controllerTypes'
import { useChatViewState } from '../useChatViewState'

export function useWorkspaceChatState() {
  const [chats, setChats] = useState<ProviderChat[]>([])

  const [loadState, setLoadState] = useState<LoadState>('loading')

  const { selectedChat, setSelectedChat, chatDetail, setChatDetail, selectChatView } =
    useChatViewState()

  const [recentChatReferencesCache, setRecentChatReferencesCache] = useState<{
    chatKey: string
    references: RecentChatReference[]
  } | null>(null)

  const [recentChatReferencePage, setRecentChatReferencePage] = useState<{
    chatKey: string
    items: ProviderChatItem[]
    latestItemId: string | null
    messageLimit: number
    totalTurnCount: number
  } | null>(null)

  const [pinnedRecentChatReferences, setPinnedRecentChatReferences] =
    usePreferenceState<PinnedRecentChatReferencesByChat>(readStoredPinnedRecentChatReferences)

  const [recentlyOpenedFilesByWorkspace, setRecentlyOpenedFilesByWorkspace] =
    usePreferenceState<RecentlyOpenedFilesByWorkspace>(readStoredRecentlyOpenedFiles)

  const sleepingChats = useSleepingChats()

  const [manuallyUnreadChatKeys, setManuallyUnreadChatKeys] =
    usePreferenceState(readManuallyUnreadChats)

  const [chatSidebarTabs, setChatSidebarTabs] = usePreferenceState(readChatSidebarTabs)

  const [chatSidebarFilter, setChatSidebarFilter] = useState(readChatSidebarFilter)

  const activeChatSidebarFilter = chatSidebarTabs[chatSidebarFilter]
    ? chatSidebarFilter
    : (chatSidebarFilters.find(({ value }) => chatSidebarTabs[value])?.value ?? 'all')

  const [chatTurnWindow, setChatTurnWindow] = useState<ChatTurnWindow | null>(null)

  const [chatTurnPageLoadDirection, setChatTurnPageLoadDirection] =
    useState<ChatTurnPageLoadDirection | null>(null)

  const [chatAtConversationBottom, setChatAtConversationBottomState] = useState(true)

  // Scroll events report this on every scroll, including each turn mounted while
  // a chat opens. An unchanged set during a pending transition still rerenders the
  // whole workspace, so only forward real changes. The ref holds the latest request.
  const setChatAtConversationBottom = useCallback((value: React.SetStateAction<boolean>): void => {
    const next = typeof value === 'function' ? value(chatAtConversationBottomRef.current) : value
    if (next === chatAtConversationBottomRef.current) return
    chatAtConversationBottomRef.current = next
    setChatAtConversationBottomState(next)
  }, [])

  const [extractedChatPlan, setExtractedChatPlan] = useState<ChatPlanData | null>(null)

  const [chatLoadState, setChatLoadState] = useState<LoadState>('ready')

  const [chatLoadError, setChatLoadError] = useState<{
    chatKey: string
    message: string
  } | null>(null)

  const [chatLoadRequest, setChatLoadRequest] = useState(0)

  const [committedChatUpdate, setCommittedChatUpdate] = useState<CommittedChatUpdate | null>(null)

  const [sendState, setSendState] = useState<SendState>('idle')

  const [sendInFlightProjectKey, setSendInFlightProjectKey] = useState<string | null>(null)

  const [sendError, setSendError] = useState<string | null>(null)

  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)

  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null)

  const [messageBoxQuoteRequest, setMessageBoxQuoteRequest] =
    useState<MessageBoxQuoteRequest | null>(null)
  const handleQuoteRequestHandled = useCallback((id: number): void => {
    setMessageBoxQuoteRequest((request) => (request?.id === id ? null : request))
  }, [])

  const [approvalResolution, setApprovalResolution] = useState<ApprovalResolutionState>({
    approvalId: null,
    decision: null,
    error: null
  })

  const [userInputResolution, setUserInputResolution] = useState<UserInputResolutionState>({
    requestId: null,
    resolving: false,
    error: null
  })

  const chatTurnWindowRef = useRef<ChatTurnWindow | null>(chatTurnWindow)

  const chatDetailRef = useRef<ProviderChatDetail | null>(chatDetail)

  const chatDetailResyncRef = useRef<{ chatKey: string; requestId: number } | null>(null)

  const chatDetailResyncRequestIdRef = useRef(0)

  const loadedWorkingStepIdsRef = useRef<string[]>([])

  const sendInFlightRef = useRef(false)

  const forkInFlightRef = useRef(false)

  const sendInFlightProjectKeyRef = useRef<string | null>(null)

  const runPromptActionRef = useRef<(prompt: string, target: 'current' | 'new') => Promise<void>>(
    async () => {}
  )

  const chatAtConversationBottomRef = useRef(chatAtConversationBottom)

  const chatsRef = useRef(chats)

  const selectedChatKeyRef = useRef<string | null>(null)

  const selectedChatUpdatedAtRef = useRef<number | null>(null)

  const chatOrderMutationsRef = useRef(new Map<string, number>())

  const selectedChatRef = useRef<ProviderChat | null>(selectedChat)
  return {
    chats,
    setChats,
    loadState,
    setLoadState,
    selectedChat,
    setSelectedChat,
    chatDetail,
    setChatDetail,
    selectChatView,
    recentChatReferencesCache,
    setRecentChatReferencesCache,
    recentChatReferencePage,
    setRecentChatReferencePage,
    pinnedRecentChatReferences,
    setPinnedRecentChatReferences,
    recentlyOpenedFilesByWorkspace,
    setRecentlyOpenedFilesByWorkspace,
    sleepingChats,
    manuallyUnreadChatKeys,
    setManuallyUnreadChatKeys,
    chatSidebarTabs,
    setChatSidebarTabs,
    setChatSidebarFilter,
    activeChatSidebarFilter,
    chatTurnWindow,
    setChatTurnWindow,
    chatTurnPageLoadDirection,
    setChatTurnPageLoadDirection,
    chatAtConversationBottom,
    setChatAtConversationBottom,
    extractedChatPlan,
    setExtractedChatPlan,
    chatLoadState,
    setChatLoadState,
    chatLoadError,
    setChatLoadError,
    chatLoadRequest,
    setChatLoadRequest,
    committedChatUpdate,
    setCommittedChatUpdate,
    sendState,
    setSendState,
    sendInFlightProjectKey,
    setSendInFlightProjectKey,
    sendError,
    setSendError,
    forkingMessageId,
    setForkingMessageId,
    editingMessage,
    setEditingMessage,
    messageBoxQuoteRequest,
    setMessageBoxQuoteRequest,
    handleQuoteRequestHandled,
    approvalResolution,
    setApprovalResolution,
    userInputResolution,
    setUserInputResolution,
    chatTurnWindowRef,
    chatDetailRef,
    chatDetailResyncRef,
    chatDetailResyncRequestIdRef,
    loadedWorkingStepIdsRef,
    sendInFlightRef,
    forkInFlightRef,
    sendInFlightProjectKeyRef,
    runPromptActionRef,
    chatsRef,
    selectedChatKeyRef,
    selectedChatUpdatedAtRef,
    chatOrderMutationsRef,
    selectedChatRef
  }
}
