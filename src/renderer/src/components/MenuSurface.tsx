import { forwardRef, type HTMLAttributes } from 'react'
import './MenuSurface.css'

export type MenuSurfaceProps = HTMLAttributes<HTMLDivElement>

export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(function MenuSurface(
  { className, ...props },
  ref
) {
  return (
    <div
      {...props}
      ref={ref}
      className={['ui-menu-surface', className].filter(Boolean).join(' ')}
    />
  )
})
