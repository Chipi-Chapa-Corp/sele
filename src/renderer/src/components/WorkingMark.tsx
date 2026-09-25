import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

// Two rounded, slanted shapes that periodically trade places. They are drawn as a single
// even-odd path, so wherever they overlap the background shows through — no extra shapes involved.

// Geometry in viewBox units (100 × 100, centred at 50,50)
const WIDTH = 56
const HEIGHT = 62
const RADIUS = 13
const SHEAR = 0.2 // top edge shifts right by SHEAR × height/2
const OFFSET = { x: 14, y: 12 } // the pieces rest at +OFFSET and −OFFSET

// Timing
const HOLD_MS = 600
const MOVE_MS = 750
const PULL = 0.35 // how much closer the pieces get while passing each other
const PERIOD_MS = HOLD_MS + MOVE_MS
const SPIN_HOLD_MS = 300
const SPIN_DELAY_MS = 40
const SHRINK_MS = 230
const SPIN_MS = 780
const GROW_MS = 250
const SPIN_PERIOD_MS = SPIN_HOLD_MS + SPIN_DELAY_MS + SPIN_MS
const SPIN_SCALE = 0.55
const SPIN_SPREAD = 0.5
const DEPTH_HOLD_MS = 450
const DEPTH_MOVE_MS = 800
const DEPTH_PERIOD_MS = DEPTH_HOLD_MS + DEPTH_MOVE_MS
const DEPTH_BACK_SCALE = 0.6
const DEPTH_FRONT_SCALE = 1.15

export type WorkingMarkAnimation = 'swap' | 'spin' | 'depth'

const animationSpeed: Record<WorkingMarkAnimation, number> = {
  swap: 1.5,
  spin: 1,
  depth: 1.5
}

const KAPPA = 0.5523 // cubic Bézier approximation of a quarter circle
const REST_RADIUS = Math.hypot(OFFSET.x, OFFSET.y)
const REST_ANGLE = Math.atan2(OFFSET.y, OFFSET.x)

const pieceD = (tx: number, ty: number, scale = 1): string => {
  const point = (x: number, y: number): string =>
    `${(50 + tx + scale * (x - SHEAR * y)).toFixed(2)} ${(50 + ty + scale * y).toFixed(2)}`
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
  const angle = REST_ANGLE + Math.PI * u
  const radius = REST_RADIUS * (1 - PULL * Math.sin(Math.PI * u))
  const x = radius * Math.cos(angle)
  const y = radius * Math.sin(angle)
  return `${pieceD(x, y)} ${pieceD(-x, -y)}`
}

const spinFrameD = (elapsedMs: number): string => {
  const shrinkStart = SPIN_HOLD_MS
  const spinStart = shrinkStart + SPIN_DELAY_MS
  const growStart = SPIN_PERIOD_MS - GROW_MS
  const scale =
    elapsedMs < growStart
      ? 1 - (1 - SPIN_SCALE) * Math.min(1, Math.max(0, (elapsedMs - shrinkStart) / SHRINK_MS))
      : SPIN_SCALE + (1 - SPIN_SCALE) * ((elapsedMs - growStart) / GROW_MS)
  const spinProgress = Math.min(1, Math.max(0, (elapsedMs - spinStart) / SPIN_MS))
  const angle = REST_ANGLE + 2 * Math.PI * spinProgress
  const radius = REST_RADIUS * (1 + SPIN_SPREAD * Math.sin(Math.PI * spinProgress))
  const x = radius * Math.cos(angle)
  const y = radius * Math.sin(angle)
  return `${pieceD(x, y, scale)} ${pieceD(-x, -y, scale)}`
}

const depthFrameD = (elapsedMs: number): string => {
  const u = Math.min(1, Math.max(0, (elapsedMs - DEPTH_HOLD_MS) / DEPTH_MOVE_MS))
  const position = 1 - 2 * u
  const sizeChange = Math.sin(Math.PI * u)
  const backScale = 1 - (1 - DEPTH_BACK_SCALE) * sizeChange
  const frontScale = 1 + (DEPTH_FRONT_SCALE - 1) * sizeChange
  return `${pieceD(OFFSET.x * position, OFFSET.y * position, backScale)} ${pieceD(-OFFSET.x * position, -OFFSET.y * position, frontScale)}`
}

const restD = frameD(0)

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

  useEffect(() => {
    const path = pathRef.current
    if (!path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const elapsed = (now - start) * animationSpeed[animation] * speed
      path.setAttribute(
        'd',
        animation === 'spin'
          ? spinFrameD(elapsed % SPIN_PERIOD_MS)
          : animation === 'depth'
            ? depthFrameD(elapsed % DEPTH_PERIOD_MS)
            : frameD(elapsed % PERIOD_MS)
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animation, speed])

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <path ref={pathRef} d={restD} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
