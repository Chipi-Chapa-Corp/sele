import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeChatMetadata } from './chatMetadata.ts'

const target = {
  pinned: false,
  pinnedOrder: null,
  done: false,
  seenUpdatedAt: null,
  purpose: null,
  container: {
    kind: 'container',
    tool: 'ssh',
    name: 'server',
    runtime: { kind: 'host' }
  }
}

const metadata = {
  id: 'chat',
  pinned: true,
  pinnedOrder: 2,
  done: true,
  seenUpdatedAt: 123,
  purpose: null,
  container: null
}

test('preserves a known environment when metadata has no container', () => {
  assert.deepEqual(mergeChatMetadata(target, metadata), {
    ...target,
    pinned: true,
    pinnedOrder: 2,
    done: true,
    seenUpdatedAt: 123
  })
})

test('applies an explicit Host environment', () => {
  assert.deepEqual(
    mergeChatMetadata(target, {
      ...metadata,
      container: { kind: 'host' }
    }).container,
    { kind: 'host' }
  )
})
