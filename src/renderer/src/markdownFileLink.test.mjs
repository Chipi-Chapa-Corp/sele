import assert from 'node:assert/strict'
import test from 'node:test'
import { marked } from 'marked'
import { getRecentChatReferenceKey } from './chatRecents.ts'
import { getMarkdownFileTarget } from './markdownFileLink.ts'

test('opens absolute Markdown destinations with leading zero-width spaces', () => {
  const path = '/outside-project/shots/overview.png'
  const [paragraph] = marked.lexer(`[Screenshot](\u200b\u200b${path})`)
  const [link] = paragraph.tokens
  assert.deepEqual(getMarkdownFileTarget(link.href), { path, displayPath: path, line: undefined })
  assert.deepEqual(getMarkdownFileTarget('%E2%80%8BC:%5Cwork%5Cmy%20file.ts#L12'), {
    path: 'C:\\work\\my file.ts',
    displayPath: 'C:/work/my file.ts',
    line: 12
  })
  assert.equal(
    getRecentChatReferenceKey({ kind: 'file', path: `\u200b\u200b${path}` }),
    getRecentChatReferenceKey({ kind: 'file', path })
  )
})

test('preserves zero-width spaces that are part of the filename', () => {
  for (const path of ['\u200brelative.png', '/output/\u200bimage.png']) {
    assert.equal(getMarkdownFileTarget(path).path, path)
  }
})
