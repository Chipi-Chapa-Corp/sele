import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotationGeometry,
  annotationLength,
  constrainArrow,
  extendAnnotation,
  nextAnnotationNumber
} from './imageAnnotations.ts'

const annotation = (tool, points, number) => ({
  tool,
  points,
  start: points[0],
  end: points.at(-1),
  width: 4,
  fontSize: 24,
  fontWeight: 600,
  ...(number === undefined ? {} : { number })
})
const bounds = { width: 800, height: 500 }

test('Shift straightens both arrow tools without losing their freehand path or number', () => {
  for (const tool of ['arrow', 'numbered-arrow']) {
    const original = annotation(
      tool,
      [
        { x: 10, y: 10 },
        { x: 20, y: 80 },
        { x: 100, y: 10 }
      ],
      tool === 'numbered-arrow' ? 3 : undefined
    )
    const straight = constrainArrow(original, true)
    assert.deepEqual(straight.points, [original.start, original.end])
    assert.equal(straight.number, original.number)
    assert.equal(annotationLength(straight), 90)
    assert.equal(original.points.length, 3)
    assert.equal(constrainArrow(original, false), original)
  }
})

test('Shift leaves brush strokes and number placement unchanged', () => {
  for (const tool of ['brush', 'number']) {
    const original = annotation(tool, [
      { x: 10, y: 10 },
      { x: 20, y: 80 },
      { x: 100, y: 10 }
    ])
    assert.equal(constrainArrow(original, true), original)
  }
})

test('brush strokes follow the path without arrowheads or number increments', () => {
  const brush = annotation('brush', [
    { x: 100, y: 100 },
    { x: 150, y: 200 },
    { x: 200, y: 100 }
  ])
  const geometry = annotationGeometry(brush, bounds)
  assert.equal(geometry.head, '')
  assert.equal(nextAnnotationNumber([annotation('number', [{ x: 20, y: 20 }], 1), brush]), 2)
})

test('arrowheads follow the final section rather than the direction from start to finish', () => {
  const arrow = annotation('arrow', [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 }
  ])
  const geometry = annotationGeometry(arrow, bounds)
  const [tipX, tipY, leftX, leftY, rightX, rightY] = geometry.head
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number)
  assert.deepEqual([tipX, tipY], [200, 200])
  assert.ok(leftX < 200 && rightX > 200)
  assert.equal(leftY, rightY)
  assert.ok(leftY < 200)
})

test('closed strokes retain their length and pointer even when endpoints coincide', () => {
  const loop = annotation(
    'numbered-arrow',
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 100 }
    ],
    1
  )
  assert.ok(annotationLength(loop) > 300)
  assert.ok(annotationGeometry(loop, bounds).head.startsWith('M 100 100 '))
})

test('sampling drops stationary jitter while preserving the exact release position', () => {
  const brush = annotation('brush', [{ x: 10, y: 10 }])
  const moved = extendAnnotation(
    brush,
    [
      { x: 10, y: 10 },
      { x: 10.1, y: 10.1 },
      { x: 20, y: 20 }
    ],
    0.75
  )
  assert.equal(moved.points.length, 2)
  assert.equal(brush.points.length, 1)
  const released = extendAnnotation(moved, [{ x: 20.1, y: 20.1 }], 0)
  assert.deepEqual(released.end, { x: 20.1, y: 20.1 })
  assert.equal(released.points.length, 3)
})
