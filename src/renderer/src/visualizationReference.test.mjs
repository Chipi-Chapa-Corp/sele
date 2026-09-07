import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Marked } from 'marked'
import {
  visualizationExtension,
  parseVisualizationReference,
  decodeVisualizationReference
} from './visualizationReference.ts'

const markdown = new Marked({ extensions: [visualizationExtension] })
const marker = 'visualize{"path":"/work/chart.html","mode":"wide","title":"Chart"}'
test('renders visualization blocks in order with surrounding Markdown', () => {
  const html = markdown.parse(`Before\n\n${marker}\n\nAfter\n\n${marker}`)
  assert.equal((html.match(/data-visualization=/g) || []).length, 2)
  assert.match(html, /^<p>Before<\/p>\n<div data-visualization=/)
  assert.match(html, /<p>After<\/p>/)
})
test('keeps fenced and inline examples literal', () => {
  assert.doesNotMatch(markdown.parse('```text\n' + marker + '\n```'), /data-visualization=/)
  assert.doesNotMatch(markdown.parse('`' + marker + '`'), /data-visualization=/)
})
test('rejects malformed, incomplete, relative and non-HTML references', () => {
  for (const value of [
    '{',
    'null',
    '{"path":"relative.html"}',
    '{"path":"https://example.com/a.html"}',
    '{"path":"/a.txt"}',
    '{"path":"/a.html","mode":"bad"}'
  ]) {
    assert.equal(parseVisualizationReference(value), null)
  }
  assert.doesNotMatch(markdown.parse(marker.slice(0, -1)), /data-visualization=/)
})
test('encodes markup in paths and titles instead of injecting attributes', () => {
  const reference = { path: '/work/a"<>.html', title: '"><img src=x onerror=alert(1)>' }
  const html = markdown.parse(`visualize${JSON.stringify(reference)}`)
  assert.doesNotMatch(html, /<img|onerror=/)
  const encoded = html.match(/data-visualization="([^"]+)"/)[1]
  assert.deepEqual(parseVisualizationReference(decodeURIComponent(encoded)), {
    ...reference,
    mode: undefined
  })
})

test('malformed encoded placeholders cannot crash message rendering', () => {
  assert.equal(decodeVisualizationReference('%invalid'), null)
})
