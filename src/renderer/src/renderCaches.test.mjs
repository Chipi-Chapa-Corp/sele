import assert from 'node:assert/strict'
import test from 'node:test'
import { refractor } from 'refractor'
import {
  highlightCode,
  renderMarkdownCodeBlock,
  maxHighlightedCodeLength
} from './codeHighlighting.ts'
import { getRenderedDiffFiles } from './unifiedDiffRendering.ts'

test('tool output and Markdown share syntax work across remounts and fresh snapshots', (t) => {
  const highlight = t.mock.method(refractor, 'highlight')
  const code = 'const sharedToolCache = "<safe>";'
  const first = highlightCode(code, 'javascript')
  for (let index = 0; index < 10; index++) {
    assert.deepEqual(highlightCode(code, 'javascript'), first)
  }
  assert.match(renderMarkdownCodeBlock(code, 'javascript'), /&lt;safe&gt;/)
  assert.equal(highlight.mock.callCount(), 1)
  highlightCode(code, 'typescript')
  highlightCode(`${code}\n// edited`, 'javascript')
  assert.equal(highlight.mock.callCount(), 3)
  assert.equal(highlightCode(code, 'unknown-language'), null)
  assert.equal(highlightCode('x'.repeat(maxHighlightedCodeLength + 1), 'javascript'), null)
  assert.equal(highlight.mock.callCount(), 3)
})

test('diff remounts reuse parsing and highlighting while edits and languages stay separate', (t) => {
  const highlight = t.mock.method(refractor, 'highlight')
  const diff = {
    path: '/work/cache.ts',
    kind: 'edit',
    diff: '@@ -1 +1 @@\n-const beforeCache = 1;\n+const afterCache = 2;\n'
  }
  const first = getRenderedDiffFiles(diff)
  const initialHighlights = highlight.mock.callCount()
  assert.ok(initialHighlights > 0)
  assert.equal(first[0].file.hunks[0].changes[1].content, 'const afterCache = 2;')
  assert.ok(first[0].tokens)
  for (let index = 0; index < 10; index++) {
    assert.equal(getRenderedDiffFiles({ ...diff }), first)
  }
  assert.equal(highlight.mock.callCount(), initialHighlights)
  const edited = getRenderedDiffFiles({ ...diff, diff: diff.diff.replace('= 2', '= 3') })
  assert.equal(edited[0].file.hunks[0].changes[1].content, 'const afterCache = 3;')
  assert.ok(highlight.mock.callCount() > initialHighlights)
  const plain = getRenderedDiffFiles({ ...diff, path: '/work/cache.txt' })
  assert.notEqual(plain, first)
  assert.deepEqual(plain[0].file.hunks, first[0].file.hunks)
  const created = getRenderedDiffFiles({
    path: 'create.ts',
    kind: 'create',
    diff: 'const a = 1;\n'
  })
  const deleted = getRenderedDiffFiles({
    path: 'create.ts',
    kind: 'delete',
    diff: 'const a = 1;\n'
  })
  assert.equal(created[0].file.type, 'add')
  assert.equal(deleted[0].file.type, 'delete')
})

test('highlight failures can retry and oversized syntax trees are not retained', (t) => {
  t.mock.method(console, 'error', () => {})
  const original = refractor.highlight
  let fail = true
  const highlight = t.mock.method(refractor, 'highlight', function (...args) {
    if (fail) throw new Error('temporary highlighting failure')
    return original.apply(this, args)
  })
  const code = 'const retryToolCache = true;'
  assert.equal(highlightCode(code, 'javascript'), null)
  fail = false
  assert.ok(highlightCode(code, 'javascript'))
  assert.equal(highlight.mock.callCount(), 2)
  highlight.mock.mockImplementation(() => ({
    // A short source can expand into a large tree. Budget the output too.
    children: Array.from({ length: 16_000 }, () => ({ type: 'text', value: '.' }))
  }))
  highlightCode('oversized tree', 'javascript')
  highlightCode('oversized tree', 'javascript')
  assert.equal(highlight.mock.callCount(), 4)
  assert.ok(highlightCode(code, 'javascript'), 'oversized misses keep useful entries')
  assert.equal(highlight.mock.callCount(), 4)
})

test('diff cache evicts old entries but retains recently reopened diffs', () => {
  const makeDiff = (index) => ({
    path: 'retention.txt',
    kind: 'create',
    diff: `retention entry ${index}\n`
  })
  const oldest = getRenderedDiffFiles(makeDiff(0))
  const recent = getRenderedDiffFiles(makeDiff(1))
  for (let index = 2; index < 24; index++) getRenderedDiffFiles(makeDiff(index))
  assert.equal(getRenderedDiffFiles(makeDiff(1)), recent)
  getRenderedDiffFiles(makeDiff(24))
  assert.equal(getRenderedDiffFiles(makeDiff(1)), recent)
  assert.notEqual(getRenderedDiffFiles(makeDiff(0)), oldest)
})

test('failed diff tokenization does not poison later remounts', (t) => {
  t.mock.method(console, 'error', () => {})
  const original = refractor.highlight
  let fail = true
  t.mock.method(refractor, 'highlight', function (...args) {
    if (fail) throw new Error('temporary diff highlighting failure')
    return original.apply(this, args)
  })
  const diff = { path: 'retry.ts', kind: 'create', diff: 'const retryDiffCache = true;\n' }
  assert.equal(getRenderedDiffFiles(diff)[0].tokens, null)
  fail = false
  const recovered = getRenderedDiffFiles(diff)
  assert.ok(recovered[0].tokens)
  assert.equal(getRenderedDiffFiles({ ...diff }), recovered)
})

test('diff cache budgets expanded token output as well as the source', (t) => {
  const highlight = t.mock.method(refractor, 'highlight', () => ({
    children: [{ type: 'text', value: 'x'.repeat(2_100_000) }]
  }))
  const diff = { path: 'oversized.ts', kind: 'create', diff: 'const expandedDiff = true;\n' }
  const first = getRenderedDiffFiles(diff)
  assert.ok(first[0].tokens)
  const second = getRenderedDiffFiles(diff)
  assert.ok(second[0].tokens)
  assert.notEqual(second, first)
  assert.equal(highlight.mock.callCount(), 4)
})
