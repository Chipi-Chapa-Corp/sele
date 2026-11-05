import { useCallback, useEffect } from 'react'
import {
  alignChatContentToBottom,
  clamp,
  getScrollBottomTop,
  readChatScrollAnchor
} from '../../chatLayout'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'

type WorkspaceScrollDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
}

export function useWorkspaceScroll({ chatState, viewportState }: WorkspaceScrollDependencies) {
  const scrollChatContentToBottom = useCallback((contentElement: HTMLElement): void => {
    alignChatContentToBottom(contentElement)
    // Skips the update itself when already at the bottom.
    chatState.setChatAtConversationBottom(true)
    viewportState.chatAutoScrollTargetRef.current = {
      element: contentElement,
      top: contentElement.scrollTop
    }
    // Following the bottom needs only a bottom offset. Capture detailed anchors
    // when the user leaves it, rather than measuring the new Markdown tree here.
    viewportState.chatViewportAnchorRef.current = null
  }, [])

  const scrollPinnedChatMessageIntoView = useCallback((messageId: string): boolean => {
    const contentElement = viewportState.contentRef.current
    if (!contentElement) return false

    const messageElement = Array.from(
      contentElement.querySelectorAll<HTMLElement>('[data-chat-message-id]')
    ).find((element) => element.dataset.chatMessageId === messageId)
    if (!messageElement) return false

    const chatKey = chatState.selectedChatKeyRef.current
    viewportState.chatViewportAnchorRef.current = chatKey
      ? readChatScrollAnchor(contentElement, chatKey)
      : null
    viewportState.chatAutoScrollEnabledRef.current = false
    viewportState.chatAutoScrollTargetRef.current = null
    viewportState.chatUserScrollIntentRef.current = false
    chatState.setChatAtConversationBottom(false)

    viewportState.pinnedMessageScrollCleanupRef.current?.()
    messageElement.classList.remove('chat-detail__message-block--pin-target')

    let settleTimeout: number | null = null
    let fallbackTimeout: number | null = null
    let highlightTimeout: number | null = null
    let stopped = false

    const stopWatchingScroll = (): void => {
      contentElement.removeEventListener('scroll', scheduleHighlight)
      if (settleTimeout !== null) window.clearTimeout(settleTimeout)
      if (fallbackTimeout !== null) window.clearTimeout(fallbackTimeout)
      settleTimeout = null
      fallbackTimeout = null
    }
    const cleanup = (): void => {
      stopped = true
      stopWatchingScroll()
      if (highlightTimeout !== null) window.clearTimeout(highlightTimeout)
      messageElement.classList.remove('chat-detail__message-block--pin-target')
      if (viewportState.pinnedMessageScrollCleanupRef.current === cleanup) {
        viewportState.pinnedMessageScrollCleanupRef.current = null
      }
    }
    const playHighlight = (): void => {
      if (stopped) return
      stopWatchingScroll()
      if (!messageElement.isConnected || viewportState.contentRef.current !== contentElement) {
        cleanup()
        return
      }

      messageElement.classList.remove('chat-detail__message-block--pin-target')
      void messageElement.offsetWidth
      messageElement.classList.add('chat-detail__message-block--pin-target')
      highlightTimeout = window.setTimeout(() => {
        messageElement.classList.remove('chat-detail__message-block--pin-target')
        if (viewportState.pinnedMessageScrollCleanupRef.current === cleanup) {
          viewportState.pinnedMessageScrollCleanupRef.current = null
        }
      }, 1_200)
    }
    function scheduleHighlight(): void {
      if (stopped) return
      if (settleTimeout !== null) window.clearTimeout(settleTimeout)
      settleTimeout = window.setTimeout(playHighlight, 120)
    }

    viewportState.pinnedMessageScrollCleanupRef.current = cleanup
    contentElement.addEventListener('scroll', scheduleHighlight, { passive: true })
    fallbackTimeout = window.setTimeout(playHighlight, 2_000)

    const contentRect = contentElement.getBoundingClientRect()
    const messageRect = messageElement.getBoundingClientRect()
    const centeredTop =
      contentElement.scrollTop +
      messageRect.top -
      contentRect.top -
      (contentElement.clientHeight - messageRect.height) / 2
    const targetTop = clamp(centeredTop, 0, getScrollBottomTop(contentElement))

    contentElement.scrollTo({ behavior: 'smooth', top: targetTop })
    if (Math.abs(contentElement.scrollTop - targetTop) <= 1) {
      window.requestAnimationFrame(playHighlight)
    }
    return true
  }, [])

  const scheduleChatAutoScroll = useCallback(
    (contentElement: HTMLElement | null = viewportState.contentRef.current): void => {
      if (
        !contentElement ||
        !viewportState.chatAutoScrollEnabledRef.current ||
        viewportState.chatAutoScrollFrameRef.current !== null
      ) {
        return
      }

      // Requesting a correction must not measure layout. Item mount effects can
      // call this while the rest of the commit is still changing the transcript.
      // The actual correction records its resulting position in the frame below.
      viewportState.chatAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
        viewportState.chatAutoScrollFrameRef.current = null
        if (
          viewportState.contentRef.current !== contentElement ||
          !viewportState.chatAutoScrollEnabledRef.current
        ) {
          return
        }

        scrollChatContentToBottom(contentElement)
      })
    },
    [scrollChatContentToBottom]
  )

  const handleChatDisclosureToggle = useCallback((): void => {
    const contentElement = viewportState.contentRef.current
    const chatKey = chatState.selectedChatKeyRef.current
    if (!contentElement || !chatKey) return

    if (viewportState.chatAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportState.chatAutoScrollFrameRef.current)
      viewportState.chatAutoScrollFrameRef.current = null
    }
    viewportState.chatAutoScrollEnabledRef.current = false
    viewportState.chatAutoScrollTargetRef.current = null
    viewportState.chatUserScrollIntentRef.current = true
    viewportState.chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, chatKey)
    if (viewportState.chatUserScrollIntentFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportState.chatUserScrollIntentFrameRef.current)
    }
    viewportState.chatUserScrollIntentFrameRef.current = window.requestAnimationFrame(() => {
      viewportState.chatUserScrollIntentFrameRef.current = null
      viewportState.chatUserScrollIntentRef.current = false
    })
  }, [])

  useEffect(
    () => () => {
      if (viewportState.chatAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportState.chatAutoScrollFrameRef.current)
      }
      if (viewportState.chatUserScrollIntentFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportState.chatUserScrollIntentFrameRef.current)
      }
      viewportState.pinnedMessageScrollCleanupRef.current?.()
    },
    []
  )
  return {
    scrollChatContentToBottom,
    scrollPinnedChatMessageIntoView,
    scheduleChatAutoScroll,
    handleChatDisclosureToggle
  }
}
