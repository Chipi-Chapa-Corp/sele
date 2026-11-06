import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMarkdownPlan,
  reuseMarkdownPlan,
  markdownPartCharacters,
  markdownPartElements
} from './markdownPlan.ts'

test('streamed worker clones preserve unchanged prefixes and nested block identities', () => {
  const before = [
    {
      tag: 'details',
      opening: '<details open>',
      children: Array.from({ length: 1000 }, (_, i) => ({ html: `<p>Block ${i}</p>` }))
    }
  ]
  const clone = structuredClone(before)
  assert.equal(
    reuseMarkdownPlan(before, clone),
    before,
    'equivalent replies do not schedule a new tree'
  )
  clone[0].children[999].html = '<p>Growing tail</p>'
  const next = reuseMarkdownPlan(before, clone)
  assert.notEqual(next, before)
  assert.notEqual(next[0], before[0])
  for (let i = 0; i < 999; i++) assert.equal(next[0].children[i], before[0].children[i])
  assert.equal(next[0].children[999].html, '<p>Growing tail</p>')
  assert.equal(before[0].children[999].html, '<p>Block 999</p>')
  const appended = reuseMarkdownPlan(next, [...structuredClone(next), { html: '<p>New block</p>' }])
  assert.equal(appended[0], next[0])
  const changedShell = structuredClone(appended)
  changedShell[0].opening = '<details>'
  assert.notEqual(
    reuseMarkdownPlan(appended, changedShell)[0],
    appended[0],
    'changed attributes must be applied'
  )
})

const flatten = (nodes) =>
  nodes
    .map((node) =>
      'html' in node ? node.html : `${node.opening}${flatten(node.children)}</${node.tag}>`
    )
    .join('')
const leaves = (nodes) =>
  nodes.flatMap((node) => ('html' in node ? [node.html] : leaves(node.children)))

test('large rich messages retain exact markup with bounded leaves inside tables and details', () => {
  const row =
    '<tr><td><a href="https://example.com?a=>">&lt;hello&gt;</a></td><td><strong>value</strong></td></tr>'
  const html = `<details open><summary>Review</summary><table><thead><tr><th>One</th><th>Two</th></tr></thead><tbody>${row.repeat(2000)}</tbody></table><p>Tail</p></details>`
  const plan = createMarkdownPlan(html)
  assert.equal(flatten(plan), html)
  for (const html of leaves(plan)) {
    assert.ok(html.length <= markdownPartCharacters)
    assert.ok((html.match(/<[a-z]/g)?.length ?? 0) <= markdownPartElements)
  }
})

test('long code text keeps escaped entities and surrogate pairs intact', () => {
  const html = `<pre><code>${'🐈 &amp; &lt;tag&gt; '.repeat(10000)}</code></pre>`
  const plan = createMarkdownPlan(html)
  assert.equal(flatten(plan), html)
  for (const chunk of leaves(plan)) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk))
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk))
    assert.ok(!/&(?:[a-z]*)$/.test(chunk))
  }
})

test('unfinished streamed details remain bounded instead of falling back to one huge leaf', () => {
  const html = '<details open><summary>More</summary>' + '<p>Growing content</p>'.repeat(2000)
  const plan = createMarkdownPlan(html)
  assert.equal(flatten(plan), html + '</details>')
  assert.ok(leaves(plan).length > 10)
  for (const chunk of leaves(plan)) assert.ok(chunk.length <= markdownPartCharacters)
})
