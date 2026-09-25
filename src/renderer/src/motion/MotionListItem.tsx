import { useReducedMotionPreference } from './useReducedMotionPreference'
import { motion, useIsPresent } from 'motion/react'
import { forwardRef, type ReactNode } from 'react'

export const MotionListItem = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode
    order: string
    disabled?: boolean
  }
>(function MotionListItem({ children, order, disabled = false }, ref) {
  const present = useIsPresent()
  const reduced = useReducedMotionPreference()
  return (
    <motion.div
      ref={ref}
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
})
