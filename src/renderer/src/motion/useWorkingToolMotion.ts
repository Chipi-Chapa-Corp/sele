import { animate } from 'motion/react'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { ProviderWorkingItemSegment, ProviderWorkingStep } from '../../../shared/provider'
import { useReducedMotionPreference } from './useReducedMotionPreference'

// Compare canonical counts, not mounts: moving the bounded tail remounts rows,
// and loading history must never look like newly arriving activity.
export function useWorkingToolMotion(
  ref: RefObject<HTMLDivElement | null>,
  step: ProviderWorkingStep,
  segments: ProviderWorkingItemSegment[],
  visible: boolean
): void {
  const reduced = useReducedMotionPreference()
  const previous = useRef<{
    id: string
    count: number
    visible: boolean
    groups: Map<string, number>
  } | null>(null)
  const animations = useRef(new Map<HTMLElement, ReturnType<typeof animate>>())

  useLayoutEffect(() => {
    const before = previous.current
    const count = Math.max(
      step.itemCount ?? 0,
      ...segments.map((s) => s.startIndex + s.items.length)
    )
    const groups = new Map<string, number>()
    const arrivals = new Set<string>()
    for (const segment of segments) {
      segment.items.forEach((item, offset) => {
        if (item.type === 'message') return
        if (before && segment.kind === 'tail' && segment.startIndex + offset >= before.count) {
          arrivals.add(item.id)
        }
        if (item.type !== 'toolGroup') return
        const total = Math.max(item.toolCount ?? 0, item.tools.length)
        groups.set(item.id, total)
        const priorCount = before?.groups.get(item.id)
        if (priorCount == null || total <= priorCount || arrivals.has(item.id)) return
        const start = item.toolsStartIndex ?? Math.max(0, total - item.tools.length)
        item.tools.forEach((tool, index) => {
          if (start + index >= priorCount) arrivals.add(tool.id)
        })
      })
    }
    previous.current = { id: step.id, count, visible, groups }
    for (const [node, animation] of animations.current) {
      if (!node.isConnected || !visible || reduced) {
        animation.cancel()
        animations.current.delete(node)
      }
    }
    if (
      reduced ||
      document.hidden ||
      !visible ||
      !before?.visible ||
      before.id !== step.id ||
      arrivals.size === 0 ||
      arrivals.size > 8
    )
      return
    const root = ref.current
    if (!root) return
    for (const node of root.querySelectorAll<HTMLElement>('[data-working-motion-id]')) {
      if (animations.current.size >= 8) break
      if (!arrivals.has(node.dataset.workingMotionId!)) continue
      // A new group gets one reveal, not an animation for each of its children.
      const parent = node.parentElement?.closest<HTMLElement>('[data-working-motion-id]')
      if (parent && arrivals.has(parent.dataset.workingMotionId!)) continue
      const animation = animate(node, { opacity: [0.2, 1] }, { duration: 0.18, ease: 'easeOut' })
      animations.current.set(node, animation)
      animation.then(() => {
        animations.current.delete(node)
      })
    }
  }, [reduced, ref, segments, step, visible])

  useLayoutEffect(
    () => () => {
      animations.current.forEach((animation) => animation.cancel())
      animations.current.clear()
    },
    []
  )
}
