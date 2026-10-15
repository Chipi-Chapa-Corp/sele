import assert from 'node:assert/strict'
import test from 'node:test'
import { marked } from 'marked'
import { refractor } from 'refractor'
import { createBoundedTextCache } from './boundedTextCache.ts'
import { createAfterPaintWriter } from './afterPaintWriter.ts'
import { getRecentChatReferences } from './chatRecents.ts'
import { renderMarkdownCodeBlock } from './codeHighlighting.ts'

test('text caches evict least recently used entries and bound input plus output', () => {
  const cache = createBoundedTextCache(2, 12, (value) => value.length)
  const remember = (key) => cache.get(key, () => key)
  remember('aa')
  remember('bb')
  cache.get('aa', () => assert.fail('recent entry should be reused'))
  remember('cc')
  cache.get('bb', () => 'new')
  cache.get('oversized', () => 'too large to retain')
  cache.get('oversized', () => 'computed again')
  const bytes = createBoundedTextCache(100, 6, (value) => value.length)
  bytes.get('a', () => '1234')
  bytes.get('b', () => '12')
  assert.equal(
    bytes.get('a', () => 'evicted'),
    'evicted'
  )
  assert.throws(() =>
    cache.get('x', () => {
      throw new Error('parse failure')
    })
  )
  assert.equal(
    cache.get('x', () => 'retry'),
    'retry'
  )
})

test('recent references reuse parsing across IPC snapshots without stale identity or attachments', () => {
  const lexer = marked.lexer
  let parses = 0
  marked.lexer = function (...args) {
    parses++
    return lexer.apply(this, args)
  }
  try {
    const content =
      '[Source](/project/unique-cache-source.ts:12) and [Site](https://example.com/cache-test)'
    const message = { type: 'message', id: 'first', role: 'assistant', content }
    const first = getRecentChatReferences([message])
    const next = getRecentChatReferences([
      {
        ...message,
        id: 'second',
        role: 'user',
        attachments: [{ kind: 'file', path: '/project/attachment.txt', name: 'Attachment' }]
      }
    ])
    assert.equal(parses, 1)
    assert.equal(first[0].line, 12)
    assert.ok(
      next.every((reference) => reference.messageId === 'second' && reference.role === 'user')
    )
    assert.ok(next.some((reference) => reference.path === '/project/attachment.txt'))
    assert.equal(getRecentChatReferences([{ ...message, contentLoaded: false }]).length, 0)
    const edited = getRecentChatReferences([{ ...message, content: '[Edited](/edited.ts)' }])
    assert.equal(edited[0].path, '/edited.ts')
    assert.equal(parses, 2)
  } finally {
    marked.lexer = lexer
  }
})

test('code cache reuses highlighting while separating language, edits and Mermaid', () => {
  const highlight = refractor.highlight
  let highlights = 0
  refractor.highlight = function (...args) {
    highlights++
    return highlight.apply(this, args)
  }
  try {
    const code = 'const cacheTestValue = "<safe>";'
    const first = renderMarkdownCodeBlock(code, 'javascript')
    assert.equal(renderMarkdownCodeBlock(code, 'javascript'), first)
    assert.equal(highlights, 1)
    assert.match(first, /token/)
    assert.doesNotMatch(first, /<safe>/)
    renderMarkdownCodeBlock(code, 'typescript')
    renderMarkdownCodeBlock(code + '\n// edit', 'javascript')
    assert.equal(highlights, 3)
    assert.match(renderMarkdownCodeBlock('graph TD; A-->B', 'mermaid'), /data-mermaid-diagram/)
  } finally {
    refractor.highlight = highlight
  }
})

const withScheduler = (run) => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const frames = new Map()
  const timers = new Map()
  let id = 0
  const window = Object.assign(new EventTarget(), {
    requestAnimationFrame: (fn) => {
      frames.set(++id, fn)
      return id
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn, delay) => {
      timers.set(++id, { fn, delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id)
  })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  globalThis.window = window
  globalThis.document = document
  try {
    run({
      window,
      document,
      frames,
      timers,
      frame: () => {
        const work = [...frames.values()]
        frames.clear()
        work.forEach((fn) => fn())
      },
      tick: () => {
        const work = [...timers.values()]
        timers.clear()
        work.forEach(({ fn }) => fn())
      }
    })
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
}

test('preference serialization is coalesced after a paint opportunity', () =>
  withScheduler(({ frame, tick, frames, timers }) => {
    const writes = []
    const writer = createAfterPaintWriter((value) => writes.push(value))
    writer.schedule({ chat: 'old' })
    writer.schedule({ chat: 'latest' })
    assert.deepEqual(writes, [])
    frame()
    assert.deepEqual(writes, [], 'rAF is before paint, so storage must wait for the next task')
    tick()
    assert.deepEqual(writes, [{ chat: 'latest' }])
    assert.equal(frames.size + timers.size, 0)
    writer.flush()
    assert.equal(writes.length, 1)
  }))

test('pending preferences flush on close, hiding and suspended animation frames', () => {
  for (const trigger of ['beforeunload', 'pagehide', 'visibilitychange', 'timeout']) {
    withScheduler(({ window, document, tick, frames, timers }) => {
      const writes = []
      const writer = createAfterPaintWriter((value) => writes.push(value))
      writer.schedule(trigger)
      if (trigger === 'timeout') tick()
      else if (trigger === 'visibilitychange') {
        document.visibilityState = 'hidden'
        document.dispatchEvent(new Event(trigger))
      } else window.dispatchEvent(new Event(trigger))
      assert.deepEqual(writes, [trigger])
      assert.equal(frames.size + timers.size, 0)
      window.dispatchEvent(new Event('beforeunload'))
      assert.equal(writes.length, 1)
      writer.schedule('next')
      writer.flush()
      assert.deepEqual(writes, [trigger, 'next'])
    })
  }
})
