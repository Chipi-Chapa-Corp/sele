import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import { spinnerImage } from './statusIconImages'
import './Spinner.css'

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
