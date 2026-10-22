// Synthetic CPU measurements only; no providers, user data, or GUI.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { markEdits, parseDiff, tokenize } from 'react-diff-view'
import { refractor } from 'refractor'
import { highlightCode } from '../../src/renderer/src/codeHighlighting.ts'
import { getRenderedDiffFiles, toUnifiedDiff } from '../../src/renderer/src/unifiedDiffRendering.ts'

const median = (operation) => {
  operation()
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now()
    operation()
    return performance.now() - start
  })
  return Number(samples.sort((a, b) => a - b)[4].toFixed(3))
}

const adapter = {
  highlight: (code, language) => refractor.highlight(code, language).children
}
const renderUncachedDiff = (diff) =>
  parseDiff(toUnifiedDiff(diff))
    .filter((file) => file.hunks.length > 0)
    .map((file) => ({
      file,
      tokens: tokenize(file.hunks, {
        highlight: true,
        refractor: adapter,
        language: 'typescript',
        enhancers: [markEdits(file.hunks)]
      })
    }))

for (const lines of [50, 200]) {
  const code = Array.from(
    { length: lines },
    (_, index) => `const value${index} = { cached: true, index: ${index} };`
  ).join('\n')
  assert.deepEqual(
    highlightCode(code, 'typescript'),
    refractor.highlight(code, 'typescript').children
  )
  const retained = highlightCode(code, 'typescript')
  assert.equal(highlightCode(code, 'typescript'), retained, 'fixture must fit the cache budget')
  console.log(
    JSON.stringify({
      operation: 'tool-output-syntax',
      lines,
      uncachedMs: median(() => refractor.highlight(code, 'typescript')),
      cachedMs: median(() => highlightCode(code, 'typescript'))
    })
  )
}

for (const lines of [20, 100]) {
  const diff = {
    path: 'fixture.ts',
    kind: 'edit',
    diff:
      `@@ -1,${lines} +1,${lines} @@\n` +
      Array.from(
        { length: lines },
        (_, index) => `-const value${index} = ${index};\n+const value${index} = ${index + 1};\n`
      ).join('')
  }
  assert.deepEqual(getRenderedDiffFiles(diff), renderUncachedDiff(diff))
  const retained = getRenderedDiffFiles(diff)
  assert.equal(getRenderedDiffFiles({ ...diff }), retained, 'fixture must fit the cache budget')
  console.log(
    JSON.stringify({
      operation: 'diff-parse-and-syntax',
      lines,
      uncachedMs: median(() => renderUncachedDiff(diff)),
      cachedMs: median(() => getRenderedDiffFiles({ ...diff }))
    })
  )
}
