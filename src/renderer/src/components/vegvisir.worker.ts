import { vegvisirStrokes } from './vegvisirStrokes'

type ArtMessage =
  | { type: 'init'; canvas: OffscreenCanvas; lengths: number[] }
  | { type: 'appearance'; size: number; color: string }

const timingScale = 1.25
const duration = Math.max(
  ...vegvisirStrokes.map(
    (stroke) =>
      Math.round(stroke.delayMs * timingScale) + Math.round(stroke.durationMs * timingScale)
  )
)
const paths = vegvisirStrokes.map((stroke) => new Path2D(stroke.d))
let canvas: OffscreenCanvas | undefined
let context: OffscreenCanvasRenderingContext2D | null = null
let lengths: number[] = []
let color = ''
let startedAt: number | undefined
let frame: number | undefined

// Match the original CSS cubic-bezier(0.22, 1, 0.36, 1).
const ease = (progress: number): number => {
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const t = (low + high) / 2
    const x = 3 * (1 - t) ** 2 * t * 0.22 + 3 * (1 - t) * t ** 2 * 0.36 + t ** 3
    if (x < progress) low = t
    else high = t
  }
  return 1 - (1 - (low + high) / 2) ** 3
}

const draw = (now: number): void => {
  frame = undefined
  if (!canvas || !context || !color) return
  startedAt ??= now
  const elapsed = now - startedAt
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.scale(canvas.width / 1024, canvas.height / 1024)
  context.strokeStyle = color
  context.lineCap = 'round'
  context.lineJoin = 'round'
  vegvisirStrokes.forEach((stroke, index) => {
    const progress =
      (elapsed - Math.round(stroke.delayMs * timingScale)) /
      Math.round(stroke.durationMs * timingScale)
    if (progress <= 0) return
    context!.lineWidth = stroke.width
    if (progress >= 1) {
      context!.setLineDash([])
      context!.lineDashOffset = 0
    } else {
      const length = lengths[index]
      context!.setLineDash([length, length])
      context!.lineDashOffset = length * (1 - ease(progress))
    }
    context!.stroke(paths[index])
  })
  context.restore()
  // Leave the final frame intact. Theme/size changes redraw without restarting the animation.
  if (elapsed < duration) frame = requestAnimationFrame(draw)
}

self.onmessage = ({ data }: MessageEvent<ArtMessage>): void => {
  if (data.type === 'init') {
    canvas = data.canvas
    context = canvas.getContext('2d')
    if (!context) throw new Error('Offscreen 2D canvas is unavailable')
    lengths = data.lengths
  } else if (canvas) {
    if (canvas.width !== data.size) {
      canvas.width = data.size
      canvas.height = data.size
    }
    color = data.color
    if (frame === undefined) frame = requestAnimationFrame(draw)
  }
}
