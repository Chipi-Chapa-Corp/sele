import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBrowserFaviconUrl,
  getBrowserPageHostname,
  getBrowserPageLabel,
  isBrowserPageUrl,
  normalizeBrowserAddress
} from '../../shared/browser.ts'

test('local files are valid browser pages and addresses without network metadata', () => {
  const url = 'file:///tmp/my%20page.html#section'
  assert.equal(isBrowserPageUrl(url), true)
  assert.equal(normalizeBrowserAddress(`  ${url}  `), url)
  assert.equal(normalizeBrowserAddress('file:///tmp/my page.html'), 'file:///tmp/my%20page.html')
  assert.equal(getBrowserPageLabel(url), 'my page.html')
  assert.equal(getBrowserPageLabel('file:///'), 'Local files')
  assert.equal(getBrowserPageHostname(url), null)
  assert.equal(getBrowserFaviconUrl(url), null)
  assert.equal(getBrowserPageHostname('file://server/share/page.html'), null)
  assert.equal(getBrowserFaviconUrl('file://server/share/page.html'), null)
})

test('browser URL support retains web addresses and rejects executable schemes', () => {
  assert.equal(normalizeBrowserAddress('localhost:8080/page'), 'http://localhost:8080/page')
  assert.equal(normalizeBrowserAddress('example.com'), 'https://example.com/')
  assert.equal(getBrowserPageHostname('https://example.com/page'), 'example.com')
  assert.ok(getBrowserFaviconUrl('https://example.com/page'))
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    'chrome://settings',
    'invalid'
  ]) {
    assert.equal(isBrowserPageUrl(url), false)
    if (url !== 'invalid') assert.equal(normalizeBrowserAddress(url), null)
  }
})
