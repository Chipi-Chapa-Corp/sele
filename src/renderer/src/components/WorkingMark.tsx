import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

// Two identical rounded, slanted shapes that periodically trade places. They are drawn as a single
// even-odd path, so wherever they overlap the background shows through — no extra shapes involved.

// Geometry in viewBox units (100 × 100, centred at 50,50)
const WIDTH = 56
const HEIGHT = 62
const RADIUS = 13
const SHEAR = 0.2 // top edge shifts right by SHEAR × height/2
const OFFSET = { x: 9, y: 8 } // the pieces rest at +OFFSET and −OFFSET

// Timing
const HOLD_MS = 600
const MOVE_MS = 750
const PULL = 0.35 // how much closer the pieces get while passing each other
const PERIOD_MS = HOLD_MS + MOVE_MS

const KAPPA = 0.5523 // cubic Bézier approximation of a quarter circle
const REST_RADIUS = Math.hypot(OFFSET.x, OFFSET.y)
const REST_ANGLE = Math.atan2(OFFSET.y, OFFSET.x)

const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

const pieceD = (tx: number, ty: number): string => {
  const point = (x: number, y: number): string =>
    `${(50 + tx + x - SHEAR * y).toFixed(2)} ${(50 + ty + y).toFixed(2)}`
  const w = WIDTH / 2
  const h = HEIGHT / 2
  const r = RADIUS
  const k = KAPPA * r
  return [
    `M ${point(-w + r, -h)}`,
    `L ${point(w - r, -h)}`,
    `C ${point(w - r + k, -h)} ${point(w, -h + r - k)} ${point(w, -h + r)}`,
    `L ${point(w, h - r)}`,
    `C ${point(w, h - r + k)} ${point(w - r + k, h)} ${point(w - r, h)}`,
    `L ${point(-w + r, h)}`,
    `C ${point(-w + r - k, h)} ${point(-w, h - r + k)} ${point(-w, h - r)}`,
    `L ${point(-w, -h + r)}`,
    `C ${point(-w, -h + r - k)} ${point(-w + r - k, -h)} ${point(-w + r, -h)}`,
    'Z'
  ].join(' ')
}

const frameD = (elapsedMs: number): string => {
  const u = Math.min(1, Math.max(0, (elapsedMs - HOLD_MS) / MOVE_MS))
  const angle = REST_ANGLE + Math.PI * easeInOut(u)
  const radius = REST_RADIUS * (1 - PULL * Math.sin(Math.PI * u))
  const x = radius * Math.cos(angle)
  const y = radius * Math.sin(angle)
  return `${pieceD(x, y)} ${pieceD(-x, -y)}`
}

const restD = frameD(0)

export function WorkingMark({ className }: { className?: string }): ReactElement {
  const pathRef = useRef<SVGPathElement | null>(null)

  useEffect(() => {
    const path = pathRef.current
    if (!path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      path.setAttribute('d', frameD((now - start) % PERIOD_MS))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <path ref={pathRef} d={restD} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
