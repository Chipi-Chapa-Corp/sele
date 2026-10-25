import { useReducedMotionPreference } from './useReducedMotionPreference'
import { animate } from 'motion/react'
import { useLayoutEffect, useRef, type RefObject } from 'react'

// Only a semantic change starts an animation, never an unrelated parent render.
// `selectTargets` narrows the animation to parts of the element; keep it a stable function.
export function useFeedbackMotion<T extends HTMLElement>(
  ref: RefObject<T | null>,
  value: unknown,
  kind: 'bump' | 'panel' = 'bump',
  selectTargets?: (element: T) => Element[]
): void {
  const previous = useRef(value)
  const reduced = useReducedMotionPreference()
  useLayoutEffect(() => {
    const changed = previous.current !== value
    previous.current = value
    if (!changed || reduced || !ref.current) return
    const targets = selectTargets ? selectTargets(ref.current) : [ref.current]
    if (targets.length === 0) return
    const controls = animate(
      targets,
      kind === 'bump'
        ? { transform: ['scale(1)', 'scale(1.045)', 'scale(1)'] }
        : { opacity: [0.55, 1] },
      { duration: kind === 'bump' ? 0.2 : 0.16, ease: 'easeOut' }
    )
    return () => controls.cancel()
  }, [kind, reduced, ref, selectTargets, value])
}
