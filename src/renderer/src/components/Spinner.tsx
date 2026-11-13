import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import './Spinner.css'

// Static masks rasterize once. Animate their HTML hosts' transform and opacity;
// SVG image timelines repaint their pixels on the renderer thread.
// Loader-circle geometry follows Lucide (ISC).
const spinnerImage = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>')}")`

export function Spinner({
  size,
  className = '',
  style,
  ...props
}: ComponentPropsWithoutRef<'span'> & { size?: number | string }): ReactElement {
  return (
    <span
      role={props['aria-label'] ? 'img' : undefined}
      {...props}
      className={`ui-spinner ${className}`}
      style={{ maskImage: spinnerImage, width: size, height: size, ...style }}
    />
  )
}
