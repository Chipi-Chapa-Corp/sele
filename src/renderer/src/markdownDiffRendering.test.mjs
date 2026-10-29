import assert from 'node:assert/strict'
import test from 'node:test'
import { renderMarkdownDiffBlock } from './markdownDiffRendering.ts'

const rename =
  'diff --git a/Containerfile b/Dockerfile\nsimilarity index 100%\nrename from Containerfile\nrename to Dockerfile\n'
const edit =
  'diff --git a/auth.ts b/auth.ts\nindex c143f94..a5f6a89 100644\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-const before = "<old>";\n+const after = "<new>";\n'

test('assistant diffs keep metadata-only renames alongside highlighted line changes', () => {
  const html = renderMarkdownDiffBlock(rename + edit)
  assert.equal((html.match(/<section>/g) ?? []).length, 2)
  assert.match(html, /Containerfile → Dockerfile/)
  assert.match(html, /similarity index 100%/)
  assert.match(html, /diff-code-delete/)
  assert.match(html, /diff-code-insert/)
  assert.match(html, /token keyword/)
  assert.match(html.replace(/<[^>]*>/g, ''), /&lt;new&gt;/)
  assert.doesNotMatch(html, /<new>/)
})

test('hunk-only and ordinary unified patches also render', () => {
  for (const source of [edit.slice(edit.indexOf('--- ')), '@@ -1 +1 @@\n-old\n+new']) {
    assert.match(renderMarkdownDiffBlock(source), /diff-code-insert/)
  }
})

test('deleted code resembling a file header is still a hunk line', () => {
  assert.match(renderMarkdownDiffBlock('@@ -1 +1 @@\n--- old\n+new'), /diff-code-delete/)
})

test('ordinary code, incomplete headers and large patches fall back without parser errors', (t) => {
  const errors = t.mock.method(console, 'error')
  for (const source of [
    'const ready = true',
    'diff --git a/auth.ts',
    '--- a/auth.ts',
    '@@ -1 +',
    edit + 'x'.repeat(100_000)
  ]) {
    assert.equal(renderMarkdownDiffBlock(source), null)
  }
  assert.equal(errors.mock.callCount(), 0)
})

test('metadata-only changes escape file names and preserve binary and mode details', () => {
  const html = renderMarkdownDiffBlock(
    'diff --git a/<old> b/<new>\nold mode 100644\nnew mode 100755\nBinary files a/<old> and b/<new> differ\n'
  )
  assert.match(html, /&lt;new&gt;/)
  assert.match(html, /new mode 100755/)
  assert.match(html, /Binary files/)
  assert.doesNotMatch(html, /<new>/)
})
