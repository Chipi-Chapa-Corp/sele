export type ChatTurnWindow = {
  chatKey: string
  endIndex: number
  startIndex: number
  totalCount: number
}

export const getLatestChatTurnWindow = (
  chatKey: string,
  totalCount: number,
  pageSize: number
): ChatTurnWindow => ({
  chatKey,
  startIndex: Math.max(0, totalCount - Math.max(1, pageSize)),
  endIndex: totalCount,
  totalCount
})

export const getEffectiveChatTurnWindow = (
  currentWindow: ChatTurnWindow | null,
  latestWindow: ChatTurnWindow,
  followLatest: boolean
): ChatTurnWindow => {
  if (!currentWindow || currentWindow.chatKey !== latestWindow.chatKey) return latestWindow

  const currentWindowIncludesLatest = currentWindow.endIndex >= currentWindow.totalCount
  if (
    followLatest &&
    currentWindowIncludesLatest &&
    currentWindow.totalCount !== latestWindow.totalCount
  ) {
    return latestWindow
  }

  return currentWindow
}

export const shiftChatTurnWindow = (
  currentWindow: ChatTurnWindow,
  direction: 'older' | 'newer',
  loadedStartIndex: number,
  loadedEndIndex: number,
  totalCount: number,
  windowSize: number
): ChatTurnWindow => {
  const boundedWindowSize = Math.max(1, windowSize)
  let startIndex =
    direction === 'older'
      ? Math.min(loadedStartIndex, currentWindow.startIndex)
      : currentWindow.startIndex
  let endIndex =
    direction === 'newer'
      ? Math.max(currentWindow.endIndex, loadedEndIndex)
      : currentWindow.endIndex

  if (endIndex - startIndex > boundedWindowSize) {
    if (direction === 'older') endIndex = startIndex + boundedWindowSize
    else startIndex = endIndex - boundedWindowSize
  }

  return {
    chatKey: currentWindow.chatKey,
    startIndex,
    endIndex,
    totalCount: Math.max(currentWindow.totalCount, totalCount)
  }
}
