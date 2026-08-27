import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appWindowZoomLevelDefault,
  appWindowZoomLevelToFactor,
  appWindowZoomLevelToPercent,
  appWindowZoomPercentToLevel,
  getAppWindowZoomShortcutAction
} from './app.ts'
import {
  getBrowserCloseShortcutAction,
  getBrowserFaviconUrl,
  getBrowserPageLabel,
  getBrowserPageHostname,
  getBrowserPageShortcutAction,
  getBrowserPageScale,
  getBrowserPageZoomFactor,
  getNextBrowserZoomScale,
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

test('derives normalized hostnames only from browser page URLs', () => {
  assert.equal(getBrowserPageHostname('https://Docs.Example.com/path'), 'docs.example.com')
  assert.equal(getBrowserPageHostname('http://localhost:4173'), 'localhost')
  assert.equal(getBrowserPageHostname('file:///tmp/example.html'), null)
  assert.equal(getBrowserPageHostname('not a url'), null)
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

test('recognizes browser reload and page-search shortcuts', () => {
  assert.equal(
    getBrowserPageShortcutAction({ type: 'keyDown', control: true, code: 'KeyR', key: 'r' }),
    'reload'
  )
  assert.equal(
    getBrowserPageShortcutAction({ type: 'keyDown', meta: true, code: 'KeyR', key: 'r' }),
    'reload'
  )
  assert.equal(getBrowserPageShortcutAction({ type: 'keyDown', code: 'F5', key: 'F5' }), 'reload')
  assert.equal(
    getBrowserPageShortcutAction({ type: 'keyDown', control: true, code: 'KeyF', key: 'f' }),
    'find'
  )
  assert.equal(getBrowserPageShortcutAction({ type: 'keyDown', code: 'F2', key: 'F2' }), 'find')
})

test('rejects modified, repeated, and key-up browser page shortcuts', () => {
  assert.equal(
    getBrowserPageShortcutAction({ type: 'keyDown', control: true, shift: true, key: 'r' }),
    null
  )
  assert.equal(getBrowserPageShortcutAction({ type: 'keyDown', alt: true, key: 'F5' }), null)
  assert.equal(getBrowserPageShortcutAction({ type: 'keyDown', repeat: true, key: 'F2' }), null)
  assert.equal(
    getBrowserPageShortcutAction({ type: 'keyUp', control: true, code: 'KeyF', key: 'f' }),
    null
  )
})

test('recognizes unshifted equals as browser zoom in', () => {
  assert.equal(
    getAppWindowZoomShortcutAction({ type: 'keyDown', control: true, key: '=', code: 'Equal' }),
    'in'
  )
  assert.equal(
    getAppWindowZoomShortcutAction({ type: 'keyDown', meta: true, key: '=', code: 'Equal' }),
    'in'
  )
  assert.equal(
    getAppWindowZoomShortcutAction({
      type: 'keyDown',
      control: true,
      shift: true,
      key: '+',
      code: 'Equal'
    }),
    'in'
  )
})

test('converts application zoom between Electron levels and percentages', () => {
  assert.equal(appWindowZoomLevelToPercent(appWindowZoomLevelDefault), 125)
  assert.equal(appWindowZoomLevelToFactor(appWindowZoomLevelDefault), 1.25)
  assert.equal(appWindowZoomLevelToFactor(1), 1.2)
  assert.equal(appWindowZoomLevelToPercent(0), 100)
  assert.equal(appWindowZoomLevelToPercent(1), 120)
  assert.equal(appWindowZoomLevelToPercent(appWindowZoomPercentToLevel(125)), 125)
})

test('composes application zoom with browser page scale', () => {
  assert.equal(getBrowserPageZoomFactor(100, 1.25), 1.25)
  assert.equal(getBrowserPageZoomFactor(125, 1.2), 1.5)
  assert.equal(getBrowserPageScale(1.5, 1.2), 125)
  assert.ok(
    Math.abs(
      getBrowserPageZoomFactor(getNextBrowserZoomScale(getBrowserPageScale(1.5, 1.2), 'in'), 1.2) -
        1.8
    ) <
      Number.EPSILON * 2
  )
})

test('steps and bounds browser zoom percentages', () => {
  assert.equal(getNextBrowserZoomScale(100, 'in'), 120)
  assert.equal(getNextBrowserZoomScale(120, 'out'), 100)
  assert.equal(getNextBrowserZoomScale(125, 'in'), 150)
  assert.equal(getNextBrowserZoomScale(400, 'reset'), 100)
  assert.equal(getNextBrowserZoomScale(400, 'reset', 135), 135)
  assert.equal(getNextBrowserZoomScale(25, 'out'), 25)
  assert.equal(getNextBrowserZoomScale(500, 'in'), 500)
})
