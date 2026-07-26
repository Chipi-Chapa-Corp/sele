type ChatSearchTextSegment = {
  end: number
  node: Text
  start: number
}

const chatSearchMatchHighlightName = 'sele-chat-search-match'
const chatSearchActiveMatchHighlightName = 'sele-chat-search-active-match'
const chatSearchExcludedSelector =
  '.chat-detail__message-footer, [aria-hidden="true"], [data-chat-search-exclude="true"]'
const chatSearchBlockElements = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL'
])

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getSearchableChatText = (
  root: HTMLElement
): { segments: ChatSearchTextSegment[]; value: string } => {
  const segments: ChatSearchTextSegment[] = []
  let value = ''

  const appendSeparator = (): void => {
    if (value.length > 0 && !/\s$/.test(value)) value += ' '
  }

  const visitNode = (node: Node): void => {
    if (node instanceof Text) {
      if (!node.data) return

      const start = value.length
      value += node.data
      segments.push({ end: value.length, node, start })
      return
    }

    if (!(node instanceof HTMLElement) || node.matches(chatSearchExcludedSelector)) return

    if (node.tagName === 'BR') {
      appendSeparator()
      return
    }

    const separatesText = chatSearchBlockElements.has(node.tagName)
    if (separatesText) appendSeparator()
    node.childNodes.forEach(visitNode)
    if (separatesText) appendSeparator()
  }

  root.childNodes.forEach(visitNode)

  return { segments, value }
}

const findSegmentAtOffset = (
  segments: ChatSearchTextSegment[],
  offset: number
): ChatSearchTextSegment | null => {
  let lowerBound = 0
  let upperBound = segments.length - 1

  while (lowerBound <= upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2)
    const segment = segments[middle]

    if (offset < segment.start) {
      upperBound = middle - 1
    } else if (offset >= segment.end) {
      lowerBound = middle + 1
    } else {
      return segment
    }
  }

  return null
}

export const findChatSearchMatches = (root: HTMLElement, query: string): Range[] => {
  if (!query) return []

  const { segments, value } = getSearchableChatText(root)
  if (!value || segments.length === 0) return []

  const matches: Range[] = []
  const expression = new RegExp(escapeRegularExpression(query), 'giu')

  for (const match of value.matchAll(expression)) {
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length
    const startSegment = findSegmentAtOffset(segments, matchStart)
    const endSegment = findSegmentAtOffset(segments, matchEnd - 1)
    if (!startSegment || !endSegment) continue

    const range = document.createRange()
    range.setStart(startSegment.node, matchStart - startSegment.start)
    range.setEnd(endSegment.node, matchEnd - endSegment.start)
    matches.push(range)
  }

  return matches
}

export const clearChatSearchHighlights = (): void => {
  CSS.highlights.delete(chatSearchMatchHighlightName)
  CSS.highlights.delete(chatSearchActiveMatchHighlightName)
}

export const setChatSearchHighlights = (matches: Range[], activeIndex: number): void => {
  clearChatSearchHighlights()
  if (matches.length === 0) return

  const matchHighlight = new Highlight(...matches)
  const activeMatch = matches[activeIndex]
  CSS.highlights.set(chatSearchMatchHighlightName, matchHighlight)

  if (activeMatch) {
    const activeHighlight = new Highlight(activeMatch)
    activeHighlight.priority = 1
    CSS.highlights.set(chatSearchActiveMatchHighlightName, activeHighlight)
  }
}

export const scrollChatSearchMatchIntoView = (
  match: Range,
  scrollContainer: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): void => {
  const matchRect = match.getBoundingClientRect()
  const containerRect = scrollContainer.getBoundingClientRect()
  if (matchRect.height === 0 && matchRect.width === 0) return

  const top =
    scrollContainer.scrollTop +
    matchRect.top -
    containerRect.top -
    scrollContainer.clientHeight / 2 +
    matchRect.height / 2

  scrollContainer.scrollTo({
    behavior,
    top: Math.max(0, Math.min(top, scrollContainer.scrollHeight - scrollContainer.clientHeight))
  })
}
