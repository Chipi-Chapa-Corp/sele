import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQuotedPrompt } from './composerQuotes.ts'
import { getComposerDraft, updateComposerDraft } from './composerDraft.ts'
import { moveComposerDraftScope, parseStoredComposerDrafts } from './composerDraftStorage.ts'

const quote = { id: 'first', content: 'Original\r\n\r\nLast line', comment: '  Explain this  ' }

test('quote badges serialize as ordinary blockquotes followed by their comments', () => {
  assert.equal(
    buildQuotedPrompt([quote], 'Main request'),
    '> Original\n> \n> Last line\n\nExplain this\n\nMain request'
  )
  assert.equal(
    buildQuotedPrompt(
      [quote, { id: 'second', content: 'Another quote', comment: 'Change it' }],
      ''
    ),
    '> Original\n> \n> Last line\n\nExplain this\n\n> Another quote\n\nChange it'
  )
  assert.equal(buildQuotedPrompt([], '  Existing prompt  '), 'Existing prompt')
})

test('quotes alone persist in their scope, survive chat creation, and merge with existing drafts', () => {
  let drafts = updateComposerDraft(new Map(), 'new', 'quotes', [quote])
  drafts = updateComposerDraft(drafts, 'chat', 'quotes', [{ ...quote, id: 'target' }])
  const stored = parseStoredComposerDrafts(JSON.stringify({ composerDrafts: [...drafts] }))
  assert.deepEqual(getComposerDraft(stored.composerDrafts, 'new').quotes, [quote])
  const moved = moveComposerDraftScope(stored, 'new', 'chat')
  assert.deepEqual(
    getComposerDraft(moved.composerDrafts, 'chat').quotes.map((q) => q.id),
    ['target', 'first']
  )
  assert.equal(moved.composerDrafts.has('new'), false)
  const removed = updateComposerDraft(moved.composerDrafts, 'chat', 'quotes', [])
  assert.equal(removed.has('chat'), false)
})

test('invalid stored quotes cannot corrupt valid draft context', () => {
  const stored = parseStoredComposerDrafts(
    JSON.stringify({
      composerDrafts: [
        [
          'chat',
          {
            message: '',
            quotes: [null, { ...quote, content: '' }, { ...quote, comment: 2 }, quote]
          }
        ]
      ]
    })
  )
  assert.deepEqual(getComposerDraft(stored.composerDrafts, 'chat').quotes, [quote])
})
