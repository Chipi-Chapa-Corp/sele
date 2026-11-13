// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { useCallback } from 'react'
import { renderTreeNode } from '../components/ChangeTree'
import { flushSync } from 'react-dom'
import type { AppSelectedAttachment, AppGitDeleteBranchScope } from '../../../shared/app'
import type {
  ProviderMessage,
  ProviderReview,
  ProviderReviewComment
} from '../../../shared/provider'
import { getRecentChatReferenceKey, type PinnedChatTextReference } from '../chatRecents'
import type { FileEditorTarget } from '../components/FileEditorDialog'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
import { type PinnedRecentReference } from '../recentReferencePins'
import { addRecentlyOpenedFile } from '../recentlyOpenedFiles'
import { type ChatTurnWindow } from '../chatTurnWindow'
import {
  getChangedFileDisplayPath,
  getCollapsedTreeFolders,
  type ChangedFile,
  type ChangeTreeNode,
  type DisplayTreeFile,
  type RepositoryFile,
  type TreeFile
} from '../changeTree'
import { getFileTreeIndexNodes, isFileTreeFolderCollapsed } from '../fileTreeIndex'
import { getContainerTargetKey } from '../containerSelection'
import { getChatDetailTurnCount, mergeChatDetailTurnPage } from '../chatDetailWindow'
import { chatTurnWindowSize } from './controllerTypes'
import { getErrorMessage, getProviderChatKey } from './chatControllerUtils'
import type { useChangesData } from './useChangesData'
import type { useGitViewModel } from './useGitViewModel'
import { useLatestHandler } from './stableProps'
import type { WorkspaceChat } from './composition/useWorkspaceChatModel'

// Return shape is inferred from the controller declarations below.
export function useFileNavigationController({
  gitState,
  session,
  changes,
  gitPresentation,
  panes,
  dialogState,
  chatState,
  viewportState,
  scroll
}: WorkspaceChat & {
  changes: ReturnType<typeof useChangesData>
  gitPresentation: ReturnType<typeof useGitViewModel>
}) {
  const {
    setCollapsedChangeTreeFolders,
    collapsedFileTreeFolders,
    setCollapsedFileTreeFolders,
    collapsedFileTreeFoldersByCwdRef,
    branchActionProjectKeysRef,
    setBranchActionProjectKeys,
    gitBranchRequestIdRef,
    setGitBranchActionState,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    setGitBranches,
    setGitBranchesScope,
    setGitBranchLoadState,
    setGitChangeLoadRequest,
    setFileTreeLoadRequest,
    gitBranchDeleteRetry,
    gitBranchWorktreeDeleteRetry,
    gitBranchActionState,
    collapsedChangeTreeFolders
  } = gitState
  const {
    changesCwd,
    changesContainer,
    gitAvailabilityScopeKey,
    selectedChatKey,
    handleChangesPaneViewChange
  } = session
  const { repositoryFileIndex } = changes
  const {
    branchSwitchDisabled,
    currentProjectKey,
    activeTreeFolderPaths,
    hasCollapsedActiveTreeFolders
  } = gitPresentation
  const { changesPaneView } = panes
  const { setFileEditorTarget, setReviewCommentsDraft, setSelectedReview } = dialogState
  const {
    setRecentlyOpenedFilesByWorkspace,
    setPinnedRecentChatReferences,
    selectedChatRef,
    selectedChatKeyRef,
    chatDetailRef,
    chatTurnWindowRef,
    setChatTurnPageLoadDirection,
    setChatAtConversationBottom,
    setChatDetail,
    setChatTurnWindow
  } = chatState
  const {
    pendingPinnedMessageNavigationRef,
    chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef,
    pendingChatScrollAnchorRef,
    chatViewportAnchorRef,
    chatAutoScrollEnabledRef,
    chatAutoScrollTargetRef
  } = viewportState
  const { scrollPinnedChatMessageIntoView } = scroll

  const handleToggleChangeTreeFolder = (folderPath: string): void => {
    setCollapsedChangeTreeFolders((currentFolders) => ({
      ...currentFolders,
      [folderPath]: !currentFolders[folderPath]
    }))
  }
  const handleToggleFileTreeFolder = (folderPath: string): void => {
    setCollapsedFileTreeFolders((currentFolders) => {
      // Record both directions: nested folders start collapsed when no choice is stored.
      const nextFolders = {
        ...currentFolders,
        [folderPath]: !isFileTreeFolderCollapsed(currentFolders, folderPath)
      }

      if (changesCwd) collapsedFileTreeFoldersByCwdRef.current.set(changesCwd, nextFolders)

      return nextFolders
    })
  }
  const startBranchAction = (): boolean => {
    if (branchActionProjectKeysRef.current.has(currentProjectKey)) return false
    const keys = new Set(branchActionProjectKeysRef.current).add(currentProjectKey)
    branchActionProjectKeysRef.current = keys
    setBranchActionProjectKeys(keys)
    return true
  }
  const finishBranchAction = (): void => {
    const keys = new Set(branchActionProjectKeysRef.current)
    keys.delete(currentProjectKey)
    branchActionProjectKeysRef.current = keys
    setBranchActionProjectKeys(keys)
  }
  const handleSwitchBranch = async (branchName: string, create: boolean): Promise<boolean> => {
    if (branchSwitchDisabled || !changesCwd) return false

    if (!startBranchAction()) return false

    const cwd = changesCwd
    const requestId = ++gitBranchRequestIdRef.current
    setGitBranchActionState('idle')
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)

    try {
      const result = await appApi.switchGitBranch({
        branchName,
        container: changesContainer,
        create,
        cwd
      })
      if (gitBranchRequestIdRef.current === requestId) {
        setGitBranches(result)
        setGitBranchesScope({ sourceKey: gitAvailabilityScopeKey, cwd })
        setGitBranchLoadState('ready')
        setGitBranchActionState('idle')
        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
        setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
      }
      return true
    } catch (error) {
      console.error('[caught:useFileNavigationController:handleSwitchBranch]', error)
      if (gitBranchRequestIdRef.current === requestId) {
        setGitBranchActionState('error')
        setGitBranchError(
          getErrorMessage(
            error,
            create ? 'Unable to create this branch.' : 'Unable to switch branches.'
          )
        )
      }
      return false
    } finally {
      finishBranchAction()
    }
  }
  const handleDeleteBranch = async (
    branchName: string,
    scope?: AppGitDeleteBranchScope,
    force = false,
    removeWorktree = false
  ): Promise<void> => {
    if (branchSwitchDisabled || !changesCwd || !startBranchAction()) return

    const cwd = changesCwd
    const requestId = ++gitBranchRequestIdRef.current
    setGitBranchActionState('idle')
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)

    try {
      const result = await appApi.deleteGitBranch({
        branchName,
        container: changesContainer,
        cwd,
        force,
        removeWorktree,
        scope
      })
      if (gitBranchRequestIdRef.current !== requestId) return

      if (result.branches) {
        setGitBranches(result.branches)
        setGitBranchesScope({ sourceKey: gitAvailabilityScopeKey, cwd })
        setGitBranchLoadState('ready')
      }

      if (result.cancelled) {
        setGitBranchActionState('idle')
        return
      }

      if (result.deleted) {
        setGitBranchActionState('idle')
        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
        setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
        return
      }

      setGitBranchActionState('error')
      setGitBranchError(result.error ?? 'Unable to delete this branch.')
      if (result.forceSuggested && result.scope) {
        setGitBranchDeleteRetry({ branchName, scope: result.scope })
      }
      if (result.worktreePath && result.scope) {
        setGitBranchWorktreeDeleteRetry({
          branchName,
          force: result.force,
          scope: result.scope,
          worktreePath: result.worktreePath
        })
      }
    } catch (error) {
      console.error('[caught:useFileNavigationController:handleDeleteBranch]', error)
      if (gitBranchRequestIdRef.current !== requestId) return

      setGitBranchActionState('error')
      setGitBranchError(getErrorMessage(error, 'Unable to delete this branch.'))
    } finally {
      finishBranchAction()
    }
  }
  const handleForceDeleteBranch = async (): Promise<void> => {
    if (!gitBranchDeleteRetry) return

    await handleDeleteBranch(gitBranchDeleteRetry.branchName, gitBranchDeleteRetry.scope, true)
  }
  const handleDeleteBranchWorktree = async (): Promise<void> => {
    if (!gitBranchWorktreeDeleteRetry) return

    await handleDeleteBranch(
      gitBranchWorktreeDeleteRetry.branchName,
      gitBranchWorktreeDeleteRetry.scope,
      gitBranchWorktreeDeleteRetry.force,
      true
    )
  }
  const handleDismissGitBranchError = (): void => {
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)
    if (gitBranchActionState === 'error') setGitBranchActionState('idle')
  }
  const handleToggleActiveTreeFolders = (): void => {
    if (activeTreeFolderPaths.length === 0) return

    if (changesPaneView === 'files') {
      // Expanding keeps opened nested folders open; collapsing closes every visible folder.
      const nextCollapsedFolders = hasCollapsedActiveTreeFolders
        ? Object.fromEntries(
            Object.entries(collapsedFileTreeFolders).filter(([, collapsed]) => !collapsed)
          )
        : getCollapsedTreeFolders(activeTreeFolderPaths)

      if (changesCwd) {
        collapsedFileTreeFoldersByCwdRef.current.set(changesCwd, nextCollapsedFolders)
      }
      setCollapsedFileTreeFolders(nextCollapsedFolders)
      return
    }

    setCollapsedChangeTreeFolders(
      hasCollapsedActiveTreeFolders ? {} : getCollapsedTreeFolders(activeTreeFolderPaths)
    )
  }
  const openFileEditorTarget = useCallback(
    (target: FileEditorTarget, recordAsOpened = true): void => {
      const targetContainer = target.container === undefined ? changesContainer : target.container
      const normalizedTarget = { ...target, container: targetContainer }

      setFileEditorTarget(normalizedTarget)
      if (!recordAsOpened) return

      const workspaceKey = `${getContainerTargetKey(targetContainer)}\0${target.cwd}`
      const normalizedDisplayPath = target.displayPath.replace(/\\/g, '/')
      const label = normalizedDisplayPath.split('/').at(-1) ?? normalizedDisplayPath
      setRecentlyOpenedFilesByWorkspace((currentFilesByWorkspace) => ({
        ...currentFilesByWorkspace,
        [workspaceKey]: addRecentlyOpenedFile(currentFilesByWorkspace[workspaceKey] ?? [], {
          kind: 'file',
          path: target.path,
          displayPath: target.displayPath,
          label,
          line: target.line,
          endLine: target.endLine
        })
      }))
    },
    [changesContainer]
  )
  const handleOpenFile = (file: TreeFile): void => {
    if (!changesCwd) return

    openFileEditorTarget({
      container: changesContainer,
      cwd: changesCwd,
      path: file.path,
      displayPath: getChangedFileDisplayPath(file),
      kind: file.kind ?? null,
      previousPath: file.previousPath ?? null
    })
  }
  const handleOpenFileLink = useCallback(
    (
      path: string,
      displayPath: string,
      line?: number,
      endLine?: number,
      recordAsOpened = true
    ): void => {
      if (!changesCwd) return

      const normalizedCwd = changesCwd.replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedDisplayPath = displayPath.replace(/\\/g, '/')
      const relativeDisplayPath = normalizedDisplayPath.startsWith(`${normalizedCwd}/`)
        ? normalizedDisplayPath.slice(normalizedCwd.length + 1)
        : normalizedDisplayPath

      openFileEditorTarget(
        {
          container: changesContainer,
          cwd: changesCwd,
          path,
          displayPath: relativeDisplayPath,
          line,
          endLine
        },
        recordAsOpened
      )
    },
    [changesContainer, changesCwd, openFileEditorTarget]
  )
  const handleOpenAttachment = useCallback(
    (attachment: AppSelectedAttachment): void => {
      if (!changesCwd) return

      openFileEditorTarget({
        container: changesContainer,
        cwd: changesCwd,
        path: attachment.path,
        displayPath: attachment.name
      })
    },
    [changesContainer, changesCwd, openFileEditorTarget]
  )
  const handleToggleRecentReferencePinned = useCallback(
    (reference: PinnedRecentReference): void => {
      if (!selectedChatKey) return

      setPinnedRecentChatReferences((currentReferencesByChat) => {
        const currentReferences = currentReferencesByChat[selectedChatKey] ?? []
        const referenceKey = getRecentChatReferenceKey(reference)
        const pinned = currentReferences.some(
          (candidate) => getRecentChatReferenceKey(candidate) === referenceKey
        )
        const nextReferences = pinned
          ? currentReferences.filter(
              (candidate) => getRecentChatReferenceKey(candidate) !== referenceKey
            )
          : [reference, ...currentReferences]
        const nextReferencesByChat = { ...currentReferencesByChat }

        if (nextReferences.length > 0) nextReferencesByChat[selectedChatKey] = nextReferences
        else delete nextReferencesByChat[selectedChatKey]
        return nextReferencesByChat
      })
    },
    [selectedChatKey]
  )
  const handleToggleChatMessagePinned = useCallback(
    (message: ProviderMessage, turnIndex: number, pinned: boolean): void => {
      const chat = selectedChatRef.current
      if (!chat || turnIndex < 0 || !message.content.trim()) return

      handleToggleRecentReferencePinned({
        kind: 'text',
        chatId: chat.id,
        content: message.content,
        messageId: message.id,
        providerId: chat.providerId,
        role: message.role,
        turnIndex
      })
      if (!pinned) handleChangesPaneViewChange('recents')
    },
    [handleChangesPaneViewChange, handleToggleRecentReferencePinned]
  )
  const handleGoToPinnedText = useCallback(
    async (reference: PinnedChatTextReference): Promise<void> => {
      const targetChatKey = getProviderChatKey(reference.providerId, reference.chatId)
      if (selectedChatKeyRef.current !== targetChatKey) return

      pendingPinnedMessageNavigationRef.current = reference
      if (scrollPinnedChatMessageIntoView(reference.messageId)) {
        pendingPinnedMessageNavigationRef.current = null
        return
      }

      const currentDetail = chatDetailRef.current
      if (!currentDetail || currentDetail.id !== reference.chatId) {
        pendingPinnedMessageNavigationRef.current = null
        return
      }

      const knownTotalCount = Math.max(
        getChatDetailTurnCount(currentDetail),
        reference.turnIndex + 1
      )
      const centeredStartIndex = Math.max(
        0,
        reference.turnIndex - Math.floor(chatTurnWindowSize / 2)
      )
      const startIndex = Math.min(
        centeredStartIndex,
        Math.max(0, knownTotalCount - chatTurnWindowSize)
      )
      const navigationKey = getRecentChatReferenceKey(reference)

      try {
        const page = currentDetail.turnPagination
          ? await providerApi.getChatTurnPageForItem(
              reference.providerId,
              reference.chatId,
              reference.messageId,
              chatTurnWindowSize
            )
          : await providerApi.getChatTurnPage(
              reference.providerId,
              reference.chatId,
              startIndex,
              chatTurnWindowSize
            )
        const pendingReference = pendingPinnedMessageNavigationRef.current
        if (
          selectedChatKeyRef.current !== targetChatKey ||
          !pendingReference ||
          getRecentChatReferenceKey(pendingReference) !== navigationKey
        ) {
          return
        }

        const latestDetail = chatDetailRef.current
        if (!latestDetail || latestDetail.id !== reference.chatId) return

        const nextWindow: ChatTurnWindow = {
          chatKey: targetChatKey,
          startIndex: page.startIndex,
          endIndex: Math.min(page.totalCount, page.startIndex + chatTurnWindowSize),
          totalCount: page.totalCount
        }
        const nextDetail = mergeChatDetailTurnPage(latestDetail, page, nextWindow)
        chatTurnPageLoadRequestRef.current += 1
        chatTurnPageLoadInFlightRef.current = false
        chatTurnScrollDirectionRef.current = null
        pendingChatScrollAnchorRef.current = null
        chatViewportAnchorRef.current = null
        chatAutoScrollEnabledRef.current = false
        chatAutoScrollTargetRef.current = null
        chatTurnWindowRef.current = nextWindow
        chatDetailRef.current = nextDetail

        flushSync(() => {
          setChatTurnPageLoadDirection(null)
          setChatAtConversationBottom(false)
          setChatDetail(nextDetail)
          setChatTurnWindow(nextWindow)
        })
      } catch (error) {
        console.error('[caught:useFileNavigationController:useFileNavigationController]', error)
        const pendingReference = pendingPinnedMessageNavigationRef.current
        if (pendingReference && getRecentChatReferenceKey(pendingReference) === navigationKey) {
          pendingPinnedMessageNavigationRef.current = null
        }
      }
    },
    [scrollPinnedChatMessageIntoView]
  )
  const handleReorderPinnedRecentReferences = useCallback(
    (references: PinnedRecentReference[]): void => {
      if (!selectedChatKey) return
      setPinnedRecentChatReferences((currentReferencesByChat) => ({
        ...currentReferencesByChat,
        [selectedChatKey]: references
      }))
    },
    [selectedChatKey]
  )
  const handleUnpinAllRecentReferences = useCallback((): void => {
    if (!selectedChatKey) return
    setPinnedRecentChatReferences((currentReferencesByChat) => {
      if (!currentReferencesByChat[selectedChatKey]) return currentReferencesByChat
      const nextReferencesByChat = { ...currentReferencesByChat }
      delete nextReferencesByChat[selectedChatKey]
      return nextReferencesByChat
    })
  }, [selectedChatKey])
  const handleCloseFileEditor = useCallback((): void => {
    setFileEditorTarget(null)
  }, [])
  const handleReviewCommentsChange = useCallback((comments: ProviderReviewComment[]): void => {
    setReviewCommentsDraft(comments)
    setSelectedReview((review) => (review ? { ...review, comments } : null))
  }, [])
  const handleContinueReview = useCallback((comments: ProviderReviewComment[]): void => {
    setReviewCommentsDraft(comments)
    setSelectedReview((review) => ({
      id: review?.id ?? crypto.randomUUID(),
      comments
    }))
    setFileEditorTarget(null)
  }, [])
  const handleSelectedReviewChange = useCallback(
    (review: Omit<ProviderReview, 'prompt'> | null): void => {
      setSelectedReview(review)
      setReviewCommentsDraft(review?.comments ?? [])
    },
    []
  )
  const handleSelectFileEditorTarget = useCallback(
    (target: FileEditorTarget): void => {
      openFileEditorTarget(target)
    },
    [openFileEditorTarget]
  )
  // Stable, so the memoized changes panel only rerenders for its own changes.
  const openFile = useLatestHandler(handleOpenFile)
  const toggleChangeTreeFolder = useLatestHandler(handleToggleChangeTreeFolder)
  const toggleFileTreeFolder = useLatestHandler(handleToggleFileTreeFolder)
  const renderChangeTreeNode = useCallback(
    (node: ChangeTreeNode<DisplayTreeFile<ChangedFile>>, depth: number): React.ReactElement =>
      renderTreeNode(node, depth, {
        isCollapsed: (folderPath) => Boolean(collapsedChangeTreeFolders[folderPath]),
        getChildren: (_folderPath, children) => children,
        onToggleFolder: toggleChangeTreeFolder,
        onOpenFile: openFile
      }),
    [collapsedChangeTreeFolders, openFile, toggleChangeTreeFolder]
  )
  const renderRepositoryFileTreeNode = useCallback(
    (node: ChangeTreeNode<DisplayTreeFile<RepositoryFile>>, depth: number): React.ReactElement =>
      renderTreeNode(node, depth, {
        isCollapsed: (folderPath) =>
          isFileTreeFolderCollapsed(collapsedFileTreeFolders, folderPath),
        getChildren: (folderPath) =>
          repositoryFileIndex ? getFileTreeIndexNodes(repositoryFileIndex, folderPath) : [],
        onToggleFolder: toggleFileTreeFolder,
        onOpenFile: openFile
      }),
    [collapsedFileTreeFolders, openFile, repositoryFileIndex, toggleFileTreeFolder]
  )

  return {
    handleCloseFileEditor,
    handleContinueReview,
    handleDeleteBranch,
    handleDeleteBranchWorktree,
    handleDismissGitBranchError,
    handleForceDeleteBranch,
    handleGoToPinnedText,
    handleOpenAttachment,
    handleOpenFileLink,
    handleReorderPinnedRecentReferences,
    handleReviewCommentsChange,
    handleSelectFileEditorTarget,
    handleSelectedReviewChange,
    handleSwitchBranch,
    handleToggleActiveTreeFolders,
    handleToggleChatMessagePinned,
    handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences,
    renderChangeTreeNode,
    renderRepositoryFileTreeNode
  }
}
