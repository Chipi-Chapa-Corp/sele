import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBrowserCloseShortcutAction,
  getBrowserFaviconUrl,
  getBrowserPageLabel,
  isBrowserPageUrl,
  normalizeBrowserAddress
} from './browser.ts'

test('normalizes browser addresses to safe page URLs', () => {
  assert.equal(normalizeBrowserAddress('example.com/docs'), 'https://example.com/docs')
  assert.equal(normalizeBrowserAddress(' localhost:4173/path '), 'http://localhost:4173/path')
  assert.equal(normalizeBrowserAddress('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/')
  assert.equal(normalizeBrowserAddress('HTTPS://example.com'), 'https://example.com/')
})

test('rejects empty, malformed, and non-page browser addresses', () => {
  assert.equal(normalizeBrowserAddress(''), null)
  assert.equal(normalizeBrowserAddress('mailto:person@example.com'), null)
  assert.equal(normalizeBrowserAddress('javascript:alert(1)'), null)
  assert.equal(normalizeBrowserAddress('http://exa mple.com'), null)
})

test('recognizes renderable page URLs and derives tab labels', () => {
  assert.equal(isBrowserPageUrl('https://example.com/path'), true)
  assert.equal(isBrowserPageUrl('file:///tmp/example.html'), false)
  assert.equal(getBrowserPageLabel('https://docs.example.com/path'), 'docs.example.com')
  assert.equal(getBrowserPageLabel('not a url'), 'New tab')
})

test('builds favicon URLs only for renderable pages', () => {
  assert.equal(
    getBrowserFaviconUrl('https://docs.example.com/path'),
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fdocs.example.com&sz=32'
  )
  assert.equal(getBrowserFaviconUrl('mailto:person@example.com'), null)
})

test('captures close-tab shortcuts without allowing a window-close variant', () => {
  assert.equal(
    getBrowserCloseShortcutAction({ type: 'keyDown', control: true, key: 'w' }),
    'close-tab'
  )
  assert.equal(
    getBrowserCloseShortcutAction({ type: 'keyDown', meta: true, code: 'KeyW' }),
    'close-tab'
  )
  assert.equal(
    getBrowserCloseShortcutAction({ type: 'keyDown', control: true, shift: true, key: 'w' }),
    'suppress-window-close'
  )
  assert.equal(
    getBrowserCloseShortcutAction({ type: 'keyDown', alt: true, control: true, key: 'w' }),
    null
  )
  assert.equal(getBrowserCloseShortcutAction({ type: 'keyDown', control: true, key: 'q' }), null)
})
