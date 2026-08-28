import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getMarkdownCodeLanguage,
  isMermaidMarkdownCode,
  maxHighlightedCodeLength,
  renderMarkdownCodeBlock
} from './codeHighlighting.ts'

test('resolves Markdown fence languages and common aliases', () => {
  assert.equal(getMarkdownCodeLanguage('ts title="example.ts"'), 'ts')
  assert.equal(getMarkdownCodeLanguage('{.jsx}'), 'jsx')
  assert.equal(getMarkdownCodeLanguage('c++'), 'cpp')
  assert.equal(getMarkdownCodeLanguage('jsonc'), 'json')
  assert.equal(getMarkdownCodeLanguage('not-a-real-language'), null)
  assert.equal(isMermaidMarkdownCode('mermaid'), true)
  assert.equal(isMermaidMarkdownCode('language-mermaid'), true)
  assert.equal(isMermaidMarkdownCode('{.mermaid}'), true)
  assert.equal(isMermaidMarkdownCode('javascript'), false)
})

test('renders Mermaid fences as escaped diagram placeholders', () => {
  const rendered = renderMarkdownCodeBlock('flowchart LR\nA[<script>] --> B', 'mermaid')

  assert.match(rendered, /class="markdown-mermaid"/)
  assert.match(rendered, /data-mermaid-diagram/)
  assert.match(rendered, /A\[&lt;script&gt;\] --&gt; B/)
  assert.doesNotMatch(rendered, /<script>/)
})

test('renders syntax-highlighted and escaped Markdown code blocks', () => {
  const rendered = renderMarkdownCodeBlock('const answer = "<value>"', 'javascript')

  assert.match(rendered, /<code class="language-javascript">/)
  assert.match(rendered, /<span class="token keyword">const<\/span>/)
  assert.match(rendered, /&lt;value&gt;/)
  assert.doesNotMatch(rendered, /<value>/)
})

test('falls back to escaped plain code for unknown and oversized languages', () => {
  const unknown = renderMarkdownCodeBlock('<script>alert(1)</script>', 'unknown-language')
  const oversized = renderMarkdownCodeBlock(
    'const value = 1'.padEnd(maxHighlightedCodeLength + 1),
    'js'
  )

  assert.match(unknown, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(unknown, /class="language-/)
  assert.doesNotMatch(oversized, /class="token keyword"/)
})
