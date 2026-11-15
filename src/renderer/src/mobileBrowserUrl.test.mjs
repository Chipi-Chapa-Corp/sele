import assert from 'node:assert/strict'
import test from 'node:test'
import { mobileBrowserUrl } from './mobileBrowserUrl.ts'
test('desktop loopback tabs use the paired computer without changing URL data', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', 'app.localhost', '[::1]'])
    assert.equal(
      mobileBrowserUrl(
        `http://${host}:5173/path?q=localhost#127.0.0.1`,
        'http://192.168.1.24:4589'
      ),
      'http://192.168.1.24:5173/path?q=localhost#127.0.0.1'
    )
  assert.equal(
    mobileBrowserUrl('https://example.com/p', 'http://192.168.1.24:4589'),
    'https://example.com/p'
  )
  assert.equal(
    mobileBrowserUrl('http://localhost:3000/', 'http://10.0.2.2:4589'),
    'http://10.0.2.2:3000/'
  )
  assert.throws(() => mobileBrowserUrl('javascript:alert(1)', 'http://192.168.1.24:4589'))
})

test('external links rewrite HTTP loopback while keeping mail and phone actions', async () => {
  const { mobileLinkUrl } = await import('./mobileBrowserUrl.ts')
  const origin = 'http://192.168.1.24:4589/sele/ws'
  assert.equal(
    mobileLinkUrl('https://localhost:8443/a%20b?x=%23#section', origin),
    'https://192.168.1.24:8443/a%20b?x=%23#section'
  )
  for (const url of ['mailto:me@example.com', 'tel:+1234567', 'https://example.com/localhost'])
    assert.equal(mobileLinkUrl(url, origin), url)
  assert.equal(
    mobileLinkUrl('http://127.0.0.1:3000', 'http://[fd00::1]:4589'),
    'http://[fd00::1]:3000/'
  )
})
