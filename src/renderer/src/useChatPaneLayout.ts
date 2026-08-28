import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  chatBlockMinWidth,
  chatResizeHandleCount,
  chatResizeHandleWidth,
  chatSidebarDefaultWidth,
  chatSidebarMinWidth,
  changesSidebarDefaultWidth,
  changesSidebarMinWidth,
  clamp,
  clampChatPanePercentsToAvailable,
  formatChatPanePercent,
  getChatPanePercentsFromWidths,
  getChatPaneWidthsFromPercents,
  getDefaultChatPanePercents,
  readStoredChatPanePercents,
  writeStoredChatPanePercents,
  type ChatPanePercents
} from './chatLayout'
import { toCssRem } from './cssUnits'

type ChatResizeEdge = 'left' | 'right'

type ChatPaneLayout = {
  changesResizeHandleRef: RefObject<HTMLDivElement | null>
  handleStartChatResize: (edge: ChatResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => void
  panelsRef: RefObject<HTMLDivElement | null>
  panelsStyle: CSSProperties
  resizeHandleRef: RefObject<HTMLDivElement | null>
}

export const useChatPaneLayout = (changesSidebarExpanded: boolean): ChatPaneLayout => {
  const [panePercents, setPanePercents] = useState<ChatPanePercents | null>(
    readStoredChatPanePercents
  )
  const [panelsWidth, setPanelsWidth] = useState(0)
  const panelsRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const changesResizeHandleRef = useRef<HTMLDivElement>(null)
  const chatResizeCleanupRef = useRef<(() => void) | null>(null)

  const defaultPanePercents = useMemo(() => getDefaultChatPanePercents(panelsWidth), [panelsWidth])
  const preferredPanePercents = panePercents ?? defaultPanePercents
  const displayedPanePercents = useMemo(
    () => clampChatPanePercentsToAvailable(preferredPanePercents, panelsWidth),
    [panelsWidth, preferredPanePercents]
  )

  useEffect(() => {
    const panels = panelsRef.current
    if (!panels) return

    const updatePanelsWidth = (width: number): void => {
      const roundedWidth = Math.round(width)
      setPanelsWidth((currentWidth) =>
        currentWidth === roundedWidth ? currentWidth : roundedWidth
      )
    }

    updatePanelsWidth(panels.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updatePanelsWidth(entry.contentRect.width)
    })
    observer.observe(panels)

    return () => observer.disconnect()
  }, [])

  useEffect(() => () => chatResizeCleanupRef.current?.(), [])

  useEffect(() => {
    if (!panePercents) return
    writeStoredChatPanePercents(panePercents)
  }, [panePercents])

  useEffect(() => {
    const resizeHandles = [resizeHandleRef.current, changesResizeHandleRef.current].filter(
      (resizeHandle): resizeHandle is HTMLDivElement => Boolean(resizeHandle)
    )
    if (resizeHandles.length === 0) return

    const removeTabStop = (resizeHandle: HTMLDivElement): void => {
      resizeHandle.removeAttribute('tabindex')
      if (document.activeElement === resizeHandle) resizeHandle.blur()
    }

    resizeHandles.forEach(removeTabStop)

    const observers = resizeHandles.map((resizeHandle) => {
      const observer = new MutationObserver(() => removeTabStop(resizeHandle))
      observer.observe(resizeHandle, {
        attributeFilter: ['tabindex'],
        attributes: true
      })

      return observer
    })

    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [])

  const handleStartChatResize = useCallback(
    (edge: ChatResizeEdge, event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return

      const panels = panelsRef.current
      if (!panels) return

      event.preventDefault()
      event.currentTarget.blur()
      chatResizeCleanupRef.current?.()

      const startX = event.clientX
      const totalWidth = panels.getBoundingClientRect().width
      if (!totalWidth) return

      const resizeHandle = event.currentTarget
      const pointerId = event.pointerId
      const startWidths = getChatPaneWidthsFromPercents(displayedPanePercents, totalWidth)
      const handleWidth =
        chatResizeHandleWidth * (changesSidebarExpanded ? 1 : chatResizeHandleCount)
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      resizeHandle.setPointerCapture(pointerId)
      panels.classList.add('chat__panels--resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const deltaX = moveEvent.clientX - startX

        setPanePercents(() => {
          if (edge === 'left') {
            const maxSidebarWidth =
              totalWidth -
              handleWidth -
              (changesSidebarExpanded ? changesSidebarMinWidth : startWidths.changes) -
              (changesSidebarExpanded ? 0 : chatBlockMinWidth)

            return getChatPanePercentsFromWidths(
              {
                sidebar: Math.round(
                  clamp(startWidths.sidebar + deltaX, chatSidebarMinWidth, maxSidebarWidth)
                ),
                changes: startWidths.changes
              },
              totalWidth
            )
          }

          const maxChangesWidth = totalWidth - startWidths.sidebar - handleWidth - chatBlockMinWidth

          return getChatPanePercentsFromWidths(
            {
              sidebar: startWidths.sidebar,
              changes: Math.round(
                clamp(startWidths.changes - deltaX, changesSidebarMinWidth, maxChangesWidth)
              )
            },
            totalWidth
          )
        })
      }

      const handlePointerUp = (): void => {
        panels.classList.remove('chat__panels--resizing')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        chatResizeCleanupRef.current = null
      }

      chatResizeCleanupRef.current = handlePointerUp
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [changesSidebarExpanded, displayedPanePercents]
  )

  const usePercentagePaneTracks = Boolean(panePercents) || panelsWidth > 0
  const panelsStyle = {
    '--chat-sidebar-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.sidebar)
      : toCssRem(chatSidebarDefaultWidth),
    '--chat-changes-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.changes)
      : toCssRem(changesSidebarDefaultWidth)
  } as CSSProperties

  return {
    changesResizeHandleRef,
    handleStartChatResize,
    panelsRef,
    panelsStyle,
    resizeHandleRef
  }
}
