import assert from 'node:assert/strict'
import test from 'node:test'
import { getRequestErrorPresentation } from './requestError.ts'

test('replaces active-writer errors with a friendly message', () => {
  assert.deepEqual(
    getRequestErrorPresentation(
      'thread 01a04ec5-b987-7a10-91e7-9b39496d0dbd already has an active writer'
    ),
    {
      label: null,
      summary: 'This chat is opened in another application. Please close it to proceed in Sele'
    }
  )
})

test('preserves the standard request error presentation for other failures', () => {
  assert.deepEqual(getRequestErrorPresentation('Unable to send message.'), {
    label: 'Request failed',
    summary: 'Unable to send message.'
  })
})
