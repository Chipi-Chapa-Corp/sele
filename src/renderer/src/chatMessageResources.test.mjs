import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatMessagePresentation } from './chatMessageResources.ts'

test('keeps ordinary message content unchanged', () => {
  assert.deepEqual(getChatMessagePresentation('Hello\nworld'), {
    content: 'Hello\nworld',
    resources: []
  })
})

test('removes in-app browser context and presents it as a resource', () => {
  assert.deepEqual(
    getChatMessagePresentation(
      '<in-app-browser-context>\n# In app browser\n- Current URL: https://example.com\n</in-app-browser-context>\nInspect the page'
    ),
    {
      content: 'Inspect the page',
      resources: [{ kind: 'browserContext' }]
    }
  )
})

test('combines browser context with resource mentions', () => {
  assert.deepEqual(
    getChatMessagePresentation(
      '<in-app-browser-context>\r\nBrowser header\r\n</in-app-browser-context>\r\n$browser\r\nInspect the page'
    ),
    {
      content: 'Inspect the page',
      resources: [{ kind: 'skill', name: 'browser' }, { kind: 'browserContext' }]
    }
  )
})

test('removes browser context appended to message content', () => {
  assert.deepEqual(
    getChatMessagePresentation(
      'Inspect the page\n\n<in-app-browser-context>\nBrowser header\n</in-app-browser-context>'
    ),
    {
      content: 'Inspect the page\n\n',
      resources: [{ kind: 'browserContext' }]
    }
  )
})

test('does not hide an incomplete browser context block', () => {
  const content = '<in-app-browser-context>\nBrowser header'

  assert.deepEqual(getChatMessagePresentation(content), {
    content,
    resources: []
  })
})
