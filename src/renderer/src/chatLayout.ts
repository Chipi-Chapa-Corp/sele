import type { ChatTurnWindow } from './chatTurnWindow'

export type ChatScrollAnchor = {
  chatKey: string
  offset: number
  turnId: string
}

export type ChatPaneWidths = {
  sidebar: number
  changes: number
}

export type ChatPanePercents = {
  sidebar: number
  changes: number
}

export const chatSidebarDefaultWidth = 224
export const changesSidebarDefaultWidth = 192
export const chatSidebarMinWidth = 176
export const changesSidebarMinWidth = 176
export const chatBlockMinWidth = 256
export const chatResizeHandleWidth = 16
export const chatResizeHandleCount = 2
const chatPaneDefaultReferenceWidth = 1200
const chatPanePreferenceStorageKey = 'sele:chat-pane-preference:v1'

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

export const getScrollBottomTop = (element: HTMLElement): number =>
  Math.max(0, element.scrollHeight - element.clientHeight)

export const isScrolledToBottom = (element: HTMLElement): boolean =>
  getScrollBottomTop(element) - element.scrollTop <= 1

export const readChatScrollAnchor = (
  contentElement: HTMLElement,
  chatKey: string,
  retainedWindow?: Pick<ChatTurnWindow, 'startIndex' | 'endIndex'>
): ChatScrollAnchor | null => {
  const contentRect = contentElement.getBoundingClientRect()
  const turnElements = contentElement.querySelectorAll<HTMLElement>('[data-chat-turn-id]')

  for (const turnElement of turnElements) {
    const turnIndex = Number(turnElement.dataset.chatTurnIndex)
    if (
      retainedWindow &&
      (!Number.isInteger(turnIndex) ||
        turnIndex < retainedWindow.startIndex ||
        turnIndex >= retainedWindow.endIndex)
    ) {
      continue
    }

    const turnRect = turnElement.getBoundingClientRect()
    if (turnRect.bottom <= contentRect.top || turnRect.top >= contentRect.bottom) continue

    const turnId = turnElement.dataset.chatTurnId
    if (!turnId) continue

    return {
      chatKey,
      offset: turnRect.top - contentRect.top,
      turnId
    }
  }

  return null
}

export const restoreChatScrollAnchor = (
  contentElement: HTMLElement,
  anchor: ChatScrollAnchor
): boolean => {
  const turnElements = contentElement.querySelectorAll<HTMLElement>('[data-chat-turn-id]')
  let anchorElement: HTMLElement | null = null
  for (const turnElement of turnElements) {
    if (turnElement.dataset.chatTurnId === anchor.turnId) {
      anchorElement = turnElement
      break
    }
  }
  if (!anchorElement) return false

  const contentRect = contentElement.getBoundingClientRect()
  const nextOffset = anchorElement.getBoundingClientRect().top - contentRect.top
  const adjustment = nextOffset - anchor.offset
  if (Math.abs(adjustment) >= 0.5) contentElement.scrollTop += adjustment
  return true
}

export const resetDocumentScroll = (): void => {
  window.scrollTo(0, 0)
  document.body.scrollLeft = 0
  document.body.scrollTop = 0

  if (document.scrollingElement instanceof HTMLElement) {
    document.scrollingElement.scrollLeft = 0
    document.scrollingElement.scrollTop = 0
  }
}

const roundPanePercent = (value: number): number => Math.round(value * 1000) / 1000

export const getChatPanePercentsFromWidths = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPanePercents => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: roundPanePercent((widths.sidebar / referenceWidth) * 100),
    changes: roundPanePercent((widths.changes / referenceWidth) * 100)
  }
}

export const getDefaultChatPanePercents = (totalWidth: number): ChatPanePercents =>
  getChatPanePercentsFromWidths(
    {
      sidebar: chatSidebarDefaultWidth,
      changes: changesSidebarDefaultWidth
    },
    totalWidth
  )

export const getChatPaneWidthsFromPercents = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPaneWidths => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: (percents.sidebar / 100) * referenceWidth,
    changes: (percents.changes / 100) * referenceWidth
  }
}

export const clampChatPaneWidthsToAvailable = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPaneWidths => {
  if (!totalWidth) return widths

  const handleWidth = chatResizeHandleWidth * chatResizeHandleCount
  const availableForSidebars = Math.max(0, totalWidth - handleWidth - chatBlockMinWidth)
  const minimumSidebarTotal = chatSidebarMinWidth + changesSidebarMinWidth

  if (availableForSidebars <= minimumSidebarTotal) {
    return {
      sidebar: chatSidebarMinWidth,
      changes: changesSidebarMinWidth
    }
  }

  let sidebar = Math.max(widths.sidebar, chatSidebarMinWidth)
  let changes = Math.max(widths.changes, changesSidebarMinWidth)
  const overflow = sidebar + changes - availableForSidebars

  if (overflow > 0) {
    const sidebarShrinkCapacity = sidebar - chatSidebarMinWidth
    const changesShrinkCapacity = changes - changesSidebarMinWidth
    const shrinkCapacity = sidebarShrinkCapacity + changesShrinkCapacity

    if (shrinkCapacity > 0) {
      sidebar -= overflow * (sidebarShrinkCapacity / shrinkCapacity)
      changes -= overflow * (changesShrinkCapacity / shrinkCapacity)
    }
  }

  return {
    sidebar: Math.round(sidebar),
    changes: Math.round(changes)
  }
}

export const clampChatPanePercentsToAvailable = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPanePercents => {
  if (!totalWidth) return percents

  return getChatPanePercentsFromWidths(
    clampChatPaneWidthsToAvailable(getChatPaneWidthsFromPercents(percents, totalWidth), totalWidth),
    totalWidth
  )
}

export const formatChatPanePercent = (percent: number): string => `${roundPanePercent(percent)}%`

const isChatPanePercentValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100

export const readStoredChatPanePercents = (): ChatPanePercents | null => {
  try {
    const storedValue = window.localStorage.getItem(chatPanePreferenceStorageKey)
    if (!storedValue) return null

    const parsedValue = JSON.parse(storedValue) as Partial<ChatPanePercents> | null
    if (!parsedValue || typeof parsedValue !== 'object') return null
    if (!isChatPanePercentValue(parsedValue.sidebar)) return null
    if (!isChatPanePercentValue(parsedValue.changes)) return null

    return {
      sidebar: roundPanePercent(parsedValue.sidebar),
      changes: roundPanePercent(parsedValue.changes)
    }
  } catch {
    return null
  }
}

export const writeStoredChatPanePercents = (percents: ChatPanePercents): void => {
  try {
    window.localStorage.setItem(chatPanePreferenceStorageKey, JSON.stringify(percents))
  } catch {
    // Layout preferences are non-critical; ignore unavailable storage.
  }
}
