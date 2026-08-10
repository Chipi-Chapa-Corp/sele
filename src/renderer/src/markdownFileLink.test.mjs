import assert from 'node:assert/strict'
import test from 'node:test'
import { marked } from 'marked'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from './markdownFileLink.ts'

test('parses a CommonMark file destination containing spaces', () => {
  const tokens = marked.lexer('[name](</path with space/here>)')
  const link = tokens[0]?.tokens?.[0]
  assert.equal(link?.type, 'link')

  assert.deepEqual(getMarkdownFileTarget(link.href), {
    path: '/path with space/here',
    displayPath: '/path with space/here',
    line: undefined
  })
})

test('parses a line number from a CommonMark file destination containing spaces', () => {
  const tokens = marked.lexer('[name](</path with space/here.ts:42>)')
  const link = tokens[0]?.tokens?.[0]
  assert.equal(link?.type, 'link')

  assert.deepEqual(getMarkdownFileTarget(link.href), {
    path: '/path with space/here.ts',
    displayPath: '/path with space/here.ts',
    line: 42
  })
})

test('unwraps an angle-bracket file destination during direct parsing', () => {
  assert.deepEqual(getMarkdownFileTarget('</path with space/here>'), {
    path: '/path with space/here',
    displayPath: '/path with space/here',
    line: undefined
  })
})

test('parses a cwd-relative Markdown image destination containing spaces', () => {
  const tokens = marked.lexer('![diagram](<screenshots/current state.png>)')
  const image = tokens[0]?.tokens?.[0]
  assert.equal(image?.type, 'image')

  assert.deepEqual(getMarkdownFileTarget(image.href), {
    path: 'screenshots/current state.png',
    displayPath: 'screenshots/current state.png',
    line: undefined
  })
})

test('removes code-span backticks from a file link label', () => {
  const tokens = marked.lexer(
    '[`normalizeContainerTarget(null)`](/var/home/kitkat/Projects/Desktop/sele/src/renderer/src/App.tsx:963)'
  )
  const link = tokens[0]?.tokens?.[0]
  assert.equal(link?.type, 'link')

  assert.equal(getMarkdownFileLinkLabel(link, 963), 'normalizeContainerTarget(null)')
})

test('removes a source location after a code-span file label', () => {
  const tokens = marked.lexer('[`App.tsx`:963](/workspace/src/App.tsx:963)')
  const link = tokens[0]?.tokens?.[0]
  assert.equal(link?.type, 'link')

  assert.equal(getMarkdownFileLinkLabel(link, 963), 'App.tsx')
})
