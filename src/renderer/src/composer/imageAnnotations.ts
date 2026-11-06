export type AnnotationPoint = { x: number; y: number }
export type AnnotationTool = 'brush' | 'arrow' | 'numbered-arrow' | 'number'
export type ImageAnnotation = {
  tool: AnnotationTool
  start: AnnotationPoint
  end: AnnotationPoint
  points: AnnotationPoint[]
  width: number
  fontSize: number
  fontWeight: number
  number?: number
}

export const nextAnnotationNumber = (annotations: readonly ImageAnnotation[]): number =>
  annotations.reduce((number, annotation) => Math.max(number, annotation.number ?? 0), 0) + 1

export function constrainArrow(annotation: ImageAnnotation, straight: boolean): ImageAnnotation {
  if (!straight || (annotation.tool !== 'arrow' && annotation.tool !== 'numbered-arrow'))
    return annotation
  return { ...annotation, points: [annotation.start, annotation.end] }
}

export const annotationLength = ({ points }: ImageAnnotation): number =>
  points.reduce(
    (length, point, index) =>
      index === 0
        ? 0
        : length + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y),
    0
  )

export function extendAnnotation(
  annotation: ImageAnnotation,
  samples: AnnotationPoint[],
  spacing: number
): ImageAnnotation {
  const points = [...annotation.points]
  for (const sample of samples) {
    const previous = points[points.length - 1]
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y)
    if (distance > 0 && distance >= spacing) points.push(sample)
  }
  return { ...annotation, points, end: points[points.length - 1] }
}

function strokePath(points: AnnotationPoint[]): string {
  const start = points[0]
  let path = `M ${start.x} ${start.y}`
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index]
    const next = points[index + 1]
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const end = points[points.length - 1]
  return `${path} L ${end.x} ${end.y}`
}

export function annotationGeometry(
  annotation: ImageAnnotation,
  bounds: { width: number; height: number }
): {
  shaft: string
  head: string
  label: AnnotationPoint
} {
  const { start, end, points, width, fontSize } = annotation
  const headLength =
    annotation.tool === 'brush' || annotation.tool === 'number'
      ? 0
      : Math.min(annotationLength(annotation) * 0.6, width * 5)
  const shaftPoints = [...points]
  let remaining = headLength
  while (remaining > 0 && shaftPoints.length > 1) {
    const last = shaftPoints[shaftPoints.length - 1]
    const previous = shaftPoints[shaftPoints.length - 2]
    const distance = Math.hypot(last.x - previous.x, last.y - previous.y)
    if (distance <= remaining) {
      remaining -= distance
      shaftPoints.pop()
    } else {
      shaftPoints[shaftPoints.length - 1] = {
        x: last.x + ((previous.x - last.x) * remaining) / distance,
        y: last.y + ((previous.y - last.y) * remaining) / distance
      }
      remaining = 0
    }
  }
  const base = shaftPoints[shaftPoints.length - 1]
  const angle = Math.atan2(end.y - base.y, end.x - base.x)
  const first = points[1] ?? start
  const labelAngle = Math.atan2(first.y - start.y, first.x - start.x)
  const half = headLength * 0.45
  const label =
    annotation.tool === 'number'
      ? start
      : {
          x: start.x - Math.sin(labelAngle) * fontSize * 0.8,
          y: start.y + Math.cos(labelAngle) * fontSize * 0.8
        }
  const paddingX = fontSize * String(annotation.number ?? '').length * 0.35
  const paddingY = fontSize * 0.6
  return {
    shaft: strokePath(shaftPoints),
    head: headLength
      ? `M ${end.x} ${end.y} L ${base.x - Math.sin(angle) * half} ${base.y + Math.cos(angle) * half} L ${base.x + Math.sin(angle) * half} ${base.y - Math.cos(angle) * half} Z`
      : '',
    label: {
      x: Math.max(paddingX, Math.min(bounds.width - paddingX, label.x)),
      y: Math.max(paddingY, Math.min(bounds.height - paddingY, label.y))
    }
  }
}
