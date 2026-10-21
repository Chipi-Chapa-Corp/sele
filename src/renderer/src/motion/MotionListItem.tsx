import { useReducedMotionPreference } from './useReducedMotionPreference'
import { motion, useIsPresent } from 'motion/react'
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react'
import { InlinePopLayout } from './InlinePopLayout'

export const MotionListItem = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode
    order: string
    disabled?: boolean
    popLayout?: boolean
  }
>(function MotionListItem({ children, order, disabled = false, popLayout = false }, ref) {
  const present = useIsPresent()
  const reduced = useReducedMotionPreference()
  const elementRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => elementRef.current!, [])
  const content = (
    <motion.div
      ref={elementRef}
      layout={reduced || disabled ? false : 'position'}
      layoutDependency={order}
      initial={reduced ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reduced ? 0 : -10 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut' }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {children}
    </motion.div>
  )
  return popLayout ? (
    <InlinePopLayout present={present} enabled={!reduced} elementRef={elementRef}>
      {content}
    </InlinePopLayout>
  ) : (
    content
  )
})
