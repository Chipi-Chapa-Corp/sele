import { useEffect, useRef, type ReactElement } from 'react'
import { useReducedMotionPreference } from '../motion/useReducedMotionPreference'
import {
  animationSpeed,
  getWorkingMarkAnimation,
  restD,
  type WorkingMarkAnimation
} from './workingMarkAnimation'

export type { WorkingMarkAnimation } from './workingMarkAnimation'

export function WorkingMark({
  className,
  animation = 'swap',
  speed = 1
}: {
  className?: string
  animation?: WorkingMarkAnimation
  speed?: number
}): ReactElement {
  const pathRef = useRef<SVGPathElement | null>(null)
  const reduced = useReducedMotionPreference()
  useEffect(() => {
    const path = pathRef.current
    if (!path || reduced || !Number.isFinite(speed) || speed <= 0) return
    const { frames, duration } = getWorkingMarkAnimation(animation)
    const motion = path.animate(frames, {
      duration: duration / (animationSpeed[animation] * speed),
      iterations: Infinity
    })
    const updateVisibility = (): void => {
      if (path.ownerDocument.hidden) motion.pause()
      else motion.play()
    }
    updateVisibility()
    path.ownerDocument.addEventListener('visibilitychange', updateVisibility)
    return () => {
      path.ownerDocument.removeEventListener('visibilitychange', updateVisibility)
      motion.cancel()
    }
  }, [animation, speed, reduced])

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <path ref={pathRef} d={restD} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
