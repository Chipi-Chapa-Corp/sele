import { useRef } from 'react'
import { type ChatScrollAnchor } from '../../chatLayout'
import { type PinnedChatTextReference } from '../../chatRecents'

export function useWorkspaceViewportState() {
  const contentRef = useRef<HTMLDivElement>(null)

  const chatTurnPageLoadRequestRef = useRef(0)

  const chatTurnPageLoadInFlightRef = useRef(false)

  const chatTurnScrollDirectionRef = useRef<'up' | 'down' | null>(null)

  const previousChatScrollTopRef = useRef<number | null>(null)

  const pendingChatScrollAnchorRef = useRef<ChatScrollAnchor | null>(null)

  const chatViewportAnchorRef = useRef<ChatScrollAnchor | null>(null)

  const chatScrollAdjustmentTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)

  const scrollToLatestTurnAfterRenderRef = useRef(false)

  const pendingPinnedMessageNavigationRef = useRef<PinnedChatTextReference | null>(null)

  const pinnedMessageScrollCleanupRef = useRef<(() => void) | null>(null)

  const chatInitialLayoutKeyRef = useRef<string | null>(null)

  const chatAutoScrollEnabledRef = useRef(true)

  const chatAutoScrollFrameRef = useRef<number | null>(null)

  const chatAutoScrollTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)

  const chatUserScrollIntentRef = useRef(false)

  const chatUserScrollIntentFrameRef = useRef<number | null>(null)
  return {
    contentRef,
    chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef,
    previousChatScrollTopRef,
    pendingChatScrollAnchorRef,
    chatViewportAnchorRef,
    chatScrollAdjustmentTargetRef,
    scrollToLatestTurnAfterRenderRef,
    pendingPinnedMessageNavigationRef,
    pinnedMessageScrollCleanupRef,
    chatInitialLayoutKeyRef,
    chatAutoScrollEnabledRef,
    chatAutoScrollFrameRef,
    chatAutoScrollTargetRef,
    chatUserScrollIntentRef,
    chatUserScrollIntentFrameRef
  }
}
