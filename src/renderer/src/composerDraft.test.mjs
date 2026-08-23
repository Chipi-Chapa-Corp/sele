import assert from 'node:assert/strict'
import test from 'node:test'
import { getComposerDraft, updateComposerDraft } from './composerDraft.ts'

test('keeps message drafts isolated by composer scope', () => {
  let drafts = new Map()

  drafts = updateComposerDraft(drafts, 'chat:one', 'message', 'First chat draft')
  drafts = updateComposerDraft(drafts, 'chat:two', 'message', 'Second chat draft')

  assert.equal(getComposerDraft(drafts, 'chat:one').message, 'First chat draft')
  assert.equal(getComposerDraft(drafts, 'chat:two').message, 'Second chat draft')
  assert.equal(getComposerDraft(drafts, 'new-chat').message, '')
})

test('updates and clears only the targeted composer scope', () => {
  let drafts = new Map()

  drafts = updateComposerDraft(drafts, 'chat:one', 'message', 'First')
  drafts = updateComposerDraft(drafts, 'chat:two', 'message', 'Second')
  drafts = updateComposerDraft(drafts, 'chat:one', 'message', (message) => `${message} chat`)

  assert.equal(getComposerDraft(drafts, 'chat:one').message, 'First chat')
  assert.equal(getComposerDraft(drafts, 'chat:two').message, 'Second')

  drafts = updateComposerDraft(drafts, 'chat:one', 'message', '')

  assert.equal(drafts.has('chat:one'), false)
  assert.equal(getComposerDraft(drafts, 'chat:two').message, 'Second')
})

test('keeps attachments in the chat where they were selected', () => {
  const attachment = { kind: 'file', name: 'notes.md', path: '/workspace/notes.md' }
  let drafts = new Map()

  drafts = updateComposerDraft(drafts, 'chat:one', 'attachments', [attachment])

  assert.deepEqual(getComposerDraft(drafts, 'chat:one').attachments, [attachment])
  assert.deepEqual(getComposerDraft(drafts, 'chat:two').attachments, [])
})
