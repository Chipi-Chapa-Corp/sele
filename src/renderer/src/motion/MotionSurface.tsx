import { useReducedMotionPreference } from './useReducedMotionPreference'
import { animate, usePresence } from 'motion/react'
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type HTMLAttributes
} from 'react'

// Presence changes presentation only. Callers commit actions immediately and keep
// AnimatePresence mounted outside their conditional (including inside portals).
export const MotionSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    motionKind?: 'popup' | 'overlay'
  }
>(function MotionSurface({ motionKind = 'popup', ...props }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null)
  const [present, safeToRemove] = usePresence()
  const reduced = useReducedMotionPreference()
  useImperativeHandle(forwardedRef, () => ref.current!, [])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (reduced) {
      element.style.opacity = '1'
      element.style.transform = 'none'
      if (!present) safeToRemove?.()
      return
    }
    const controls = animate(
      element,
      motionKind === 'overlay'
        ? { opacity: present ? [0, 1] : 0 }
        : {
            opacity: present ? [0, 1] : 0,
            y: present ? [5, 0] : 3,
            scale: present ? [0.98, 1] : 0.99
          },
      {
        duration: present ? 0.16 : 0.12,
        ease: 'easeOut',
        onComplete: () => {
          if (!present) safeToRemove?.()
        }
      }
    )
    return () => controls.stop()
  }, [motionKind, present, reduced, safeToRemove])
  return (
    <div
      {...props}
      ref={ref}
      inert={!present || props.inert}
      aria-hidden={!present || props['aria-hidden']}
    />
  )
})
