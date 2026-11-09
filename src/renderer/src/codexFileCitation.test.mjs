import assert from 'node:assert/strict'
import test from 'node:test'
import { Marked } from 'marked'
import { codexFileCitationExtension } from './codexFileCitation.ts'
import { getMarkdownFileTarget } from './markdownFileLink.ts'

const markdown = new Marked({ extensions: [codexFileCitationExtension] })
const citation = (path) => `:codex-file-citation{path=${JSON.stringify(path)} purpose="output"}`

test('citations become file links with literal filenames and exact paths', () => {
  for (const path of [
    '/work/output/pdf/mark-velt.pdf',
    '/work/my [report] #1 100%.pdf',
    '/work/<report>&".pdf',
    'C:\\work\\report.pdf',
    '/work/report:123'
  ]) {
    const tokens = markdown.lexer(`Download ${citation(path)} and ${citation(path)}.`)[0].tokens
    const links = tokens.filter((token) => token.type === 'link')
    assert.equal(links.length, 2)
    assert.equal(getMarkdownFileTarget(links[0].href).path, path)
    assert.equal(getMarkdownFileTarget(links[0].href).line, undefined)
    assert.equal(links[0].text, path.replace(/\\/g, '/').split('/').at(-1))
  }
  assert.match(markdown.parse(citation('/work/<report>&".pdf')), /&lt;report&gt;&amp;&quot;/)
  assert.doesNotMatch(markdown.parse(citation('/work/<report>.pdf')), /<report>/)
})

test('supports reordered attributes and keeps incomplete or invalid citations literal', () => {
  assert.match(
    markdown.parse(':codex-file-citation{purpose="output" path="/work/report.pdf"}'),
    /<a href="\/work\/report.pdf">report.pdf<\/a>/
  )
  for (const value of [
    citation('/work/report.pdf').slice(0, -1),
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path="/work/bad\\q.pdf"}',
    citation('https://example.com/report.pdf'),
    citation('javascript:alert(1)'),
    citation('/work/line\nbreak.pdf')
  ]) {
    assert.match(markdown.parse(value), /:codex-file-citation\{/)
  }
})

test('does not interpret citations inside code or link labels', () => {
  const marker = citation('/work/report.pdf')
  assert.doesNotMatch(markdown.parse('`' + marker + '`'), /<a /)
  assert.doesNotMatch(markdown.parse('```text\n' + marker + '\n```'), /<a /)
  assert.equal((markdown.parse(`[${marker}](https://example.com)`).match(/<a /g) || []).length, 1)
})
