import { useReducedMotionPreference } from './useReducedMotionPreference'
import { useLayoutEffect, useRef, type RefObject } from 'react'

const revealDuration = 380
const maxRevealSpans = 48

type RevealRange = { start: number; end: number; time: number }

// Markdown replaces its innerHTML on each commit. Remember arrival times in text
// coordinates so a new chunk doesn't cut the previous chunk's fade short.
export function useStreamReveal(
  ref: RefObject<HTMLDivElement | null>,
  html: string,
  streaming: boolean
): void {
  const previous = useRef<{ text: string; streaming: boolean } | null>(null)
  const ranges = useRef<RevealRange[]>([])
  const reduced = useReducedMotionPreference()
  // biome-ignore lint/correctness/useExhaustiveDependencies: HTML is the commit signal for this DOM-owned subtree.
  useLayoutEffect(() => {
    const root = ref.current?.querySelector<HTMLElement>('.chat-detail__message-markdown')
    if (!root) return
    const text = root.textContent ?? ''
    const before = previous.current
    previous.current = { text, streaming }
    const previousText = before?.text.trimEnd() ?? ''
    const now = performance.now()
    if (
      reduced ||
      document.hidden ||
      !before ||
      !(streaming || before.streaming) ||
      !text.startsWith(previousText) ||
      text.length - previousText.length > 8192
    ) {
      ranges.current = []
      return
    }

    ranges.current = ranges.current
      .filter((range) => now - range.time < revealDuration)
      .map((range) => ({ ...range, end: Math.min(range.end, previousText.length) }))
      .filter((range) => range.end > range.start)
    if (text.trimEnd().length > previousText.length) {
      ranges.current.push({ start: previousText.length, end: text.trimEnd().length, time: now })
    }
    if (ranges.current.length > maxRevealSpans) ranges.current = []
    if (!ranges.current.length) return

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    // Walk backwards so work is bounded by the recent tail, not transcript size.
    let last: Node = root
    while (last.lastChild) last = last.lastChild
    walker.currentNode = last
    let node: Node | null = last.nodeType === Node.TEXT_NODE ? last : walker.previousNode()
    let end = text.length
    const additions: { node: Text; start: number; end: number; time: number }[] = []
    while (node && end > ranges.current[0].start) {
      const value = node.textContent ?? ''
      const start = end - value.length
      // Never wrap Markdown's whitespace between blocks. An element there changes
      // :last-child margins and can create anonymous line boxes (and scroll jumps).
      if (
        value.trim() &&
        !node.parentElement?.closest('button, [data-visualization], .chat-detail__mermaid')
      ) {
        for (const range of ranges.current) {
          const from = Math.max(start, range.start) - start
          const to = Math.min(end, range.end) - start
          if (to <= from || !value.slice(from, to).trim()) continue
          if (additions.length === maxRevealSpans) {
            ranges.current = []
            return
          }
          additions.push({ node: node as Text, start: from, end: to, time: range.time })
        }
      }
      end = start
      node = walker.previousNode()
    }

    const animations: Animation[] = []
    const spans: HTMLSpanElement[] = []
    // Split from right to left within each text node to keep offsets stable.
    for (const addition of additions.reverse()) {
      const { node, start, end, time } = addition
      if (end < node.length) node.splitText(end)
      const tail = start ? node.splitText(start) : node
      const span = document.createElement('span')
      span.dataset.streamReveal = ''
      tail.replaceWith(span)
      span.append(tail)
      spans.push(span)
      const animation = span.animate([{ opacity: 0.05 }, { opacity: 1 }], {
        duration: revealDuration,
        easing: 'ease-out'
      })
      animation.currentTime = now - time
      animations.push(animation)
    }
    const cleanup = (): void => {
      animations.forEach((animation) => animation.cancel())
      spans.forEach((span) => {
        if (span.parentNode) span.replaceWith(...span.childNodes)
      })
    }
    const remaining = revealDuration - (now - ranges.current.at(-1)!.time)
    const timer = window.setTimeout(cleanup, remaining + 20)
    return () => {
      window.clearTimeout(timer)
      cleanup()
    }
  }, [html, reduced, ref, streaming])
}
