import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addPromptDraft,
  appendPromptDraft,
  getComposerDraft,
  getComposerDraftScopeKey,
  getPromptDraftPreview,
  getPromptDrafts,
  removePromptDraft,
  restoreFailedComposerMessage,
  updateComposerDraft
} from './composerDraft.ts'

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

test('scopes new-chat drafts to their workspace', () => {
  assert.equal(getComposerDraftScopeKey('codex:chat-one', 'workspace:one'), 'codex:chat-one')
  assert.equal(getComposerDraftScopeKey(null, 'workspace:one'), 'new-chat:workspace:one')
  assert.equal(getComposerDraftScopeKey(null, 'workspace:two'), 'new-chat:workspace:two')
})

test('restores a failed message only when the composer is still empty', () => {
  let drafts = new Map()

  drafts = restoreFailedComposerMessage(drafts, 'chat:one', 'Failed prompt')
  assert.equal(getComposerDraft(drafts, 'chat:one').message, 'Failed prompt')

  drafts = updateComposerDraft(drafts, 'chat:one', 'message', 'New prompt')
  const unchangedDrafts = restoreFailedComposerMessage(drafts, 'chat:one', 'Older prompt')

  assert.equal(unchangedDrafts, drafts)
  assert.equal(getComposerDraft(unchangedDrafts, 'chat:one').message, 'New prompt')
})

test('keeps prompt draft stacks isolated by project and ordered oldest to newest', () => {
  let drafts = new Map()

  drafts = addPromptDraft(drafts, 'project:one', { id: 'one', prompt: 'First' })
  drafts = addPromptDraft(drafts, 'project:two', { id: 'two', prompt: 'Other project' })
  drafts = addPromptDraft(drafts, 'project:one', { id: 'three', prompt: 'Most recent' })

  assert.deepEqual(getPromptDrafts(drafts, 'project:one'), [
    { id: 'one', prompt: 'First' },
    { id: 'three', prompt: 'Most recent' }
  ])
  assert.deepEqual(getPromptDrafts(drafts, 'project:two'), [{ id: 'two', prompt: 'Other project' }])
})

test('removes only the selected prompt draft and clears empty project stacks', () => {
  let drafts = new Map()
  drafts = addPromptDraft(drafts, 'project:one', { id: 'one', prompt: 'First' })
  drafts = addPromptDraft(drafts, 'project:one', { id: 'two', prompt: 'Second' })

  drafts = removePromptDraft(drafts, 'project:one', 'one')
  assert.deepEqual(getPromptDrafts(drafts, 'project:one'), [{ id: 'two', prompt: 'Second' }])

  drafts = removePromptDraft(drafts, 'project:one', 'two')
  assert.equal(drafts.has('project:one'), false)
})

test('appends a popped draft to the current prompt', () => {
  assert.equal(appendPromptDraft('', 'Draft'), 'Draft')
  assert.equal(appendPromptDraft('Current prompt  ', 'Draft'), 'Current prompt\n\nDraft')
})

test('formats a trimmed, single-line beginning for draft labels', () => {
  assert.equal(getPromptDraftPreview('  First line\n second line  ', 18), 'First line second…')
  assert.equal(getPromptDraftPreview('Short prompt'), 'Short prompt')
})
