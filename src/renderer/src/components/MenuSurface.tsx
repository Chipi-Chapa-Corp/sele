import { MotionSurface } from '../motion/MotionSurface'
import { forwardRef, type HTMLAttributes } from 'react'
import './MenuSurface.css'

export type MenuSurfaceProps = HTMLAttributes<HTMLDivElement>

export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(function MenuSurface(
  { className, ...props },
  ref
) {
  return (
    <MotionSurface
      {...props}
      ref={ref}
      className={['ui-menu-surface', className].filter(Boolean).join(' ')}
    />
  )
})
