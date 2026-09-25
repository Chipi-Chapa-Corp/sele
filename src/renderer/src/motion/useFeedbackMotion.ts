import { useReducedMotionPreference } from './useReducedMotionPreference'
import { animate } from 'motion/react'
import { useLayoutEffect, useRef, type RefObject } from 'react'

// Only a semantic change starts an animation, never an unrelated parent render.
export function useFeedbackMotion<T extends HTMLElement>(
  ref: RefObject<T | null>,
  value: unknown,
  kind: 'bump' | 'panel' = 'bump'
): void {
  const previous = useRef(value)
  const reduced = useReducedMotionPreference()
  useLayoutEffect(() => {
    const changed = previous.current !== value
    previous.current = value
    if (!changed || reduced || !ref.current) return
    const controls = animate(
      ref.current,
      kind === 'bump' ? { scale: [1, 1.045, 1] } : { opacity: [0.55, 1] },
      { duration: kind === 'bump' ? 0.2 : 0.16, ease: 'easeOut' }
    )
    return () => controls.cancel()
  }, [kind, reduced, ref, value])
}
