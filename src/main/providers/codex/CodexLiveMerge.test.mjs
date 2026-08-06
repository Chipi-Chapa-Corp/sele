import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeCodexStreamedText } from './CodexLiveMerge.ts'

test('keeps complete streamed text when a terminal snapshot is a shorter prefix', () => {
  assert.equal(
    mergeCodexStreamedText('The complete queued response.', 'The complete'),
    'The complete queued response.'
  )
  assert.equal(mergeCodexStreamedText('Complete response', ''), 'Complete response')
})

test('accepts snapshots that extend or correct the streamed text', () => {
  assert.equal(
    mergeCodexStreamedText('The response', 'The response is complete'),
    'The response is complete'
  )
  assert.equal(mergeCodexStreamedText('Draft response', 'Final response'), 'Final response')
})

test('uses whichever snapshot exists', () => {
  assert.equal(mergeCodexStreamedText(undefined, 'Response'), 'Response')
  assert.equal(mergeCodexStreamedText('Response', undefined), 'Response')
})
