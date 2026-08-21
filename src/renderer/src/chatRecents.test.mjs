import assert from 'node:assert/strict'
import test from 'node:test'
import { getRecentChatReferences } from './chatRecents.ts'
import {
  getDisplayedRecentChatReferences,
  parsePinnedRecentChatReferences
} from './recentReferencePins.ts'
import {
  addRecentlyOpenedFile,
  getDisplayedRecentlyOpenedFiles,
  parseRecentlyOpenedFiles
} from './recentlyOpenedFiles.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const message = (id, role, content, attachments) => ({
  type: 'message',
  id,
  role,
  content,
  attachments
})

test('extracts local files and supported external links from Markdown', () => {
  const references = getRecentChatReferences([
    message(
      'assistant-1',
      'assistant',
      'See [`App.tsx`:42](/workspace/src/App.tsx:42), [the docs](https://example.com/docs), and https://example.com/plain.'
    )
  ])

  assert.deepEqual(references, [
    {
      kind: 'file',
      label: 'App.tsx',
      messageId: 'assistant-1',
      role: 'assistant',
      path: '/workspace/src/App.tsx',
      displayPath: '/workspace/src/App.tsx',
      line: 42
    },
    {
      kind: 'link',
      label: 'the docs',
      messageId: 'assistant-1',
      role: 'assistant',
      href: 'https://example.com/docs'
    },
    {
      kind: 'link',
      label: 'https://example.com/plain',
      messageId: 'assistant-1',
      role: 'assistant',
      href: 'https://example.com/plain'
    }
  ])
})

test('only counts the latest ten persisted user and assistant messages', () => {
  const items = [
    message('old', 'user', 'https://old.example.com'),
    {
      type: 'working',
      id: 'working',
      status: 'worked',
      items: [{ type: 'message', id: 'commentary', content: 'https://working.example.com' }]
    },
    {
      type: 'pendingMessage',
      id: 'pending',
      kind: 'queued',
      content: 'https://pending.example.com'
    },
    ...Array.from({ length: 10 }, (_, index) =>
      message(`recent-${index}`, index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
    ),
    message('newest', 'assistant', 'https://new.example.com')
  ]

  assert.deepEqual(getRecentChatReferences(items, 10), [
    {
      kind: 'link',
      href: 'https://new.example.com/',
      label: 'https://new.example.com',
      messageId: 'newest',
      role: 'assistant'
    }
  ])
})

test('includes file, image, and review attachments', () => {
  const references = getRecentChatReferences([
    message('user-1', 'user', '', [
      { kind: 'file', name: 'notes.md', path: '/workspace/notes.md' },
      { kind: 'image', name: 'mockup.png', path: '/workspace/mockup.png' },
      {
        kind: 'review',
        id: 'review-1',
        comments: [
          { path: 'src/App.tsx', comment: 'Check this', line: 12, endLine: 14, side: 'new' }
        ]
      }
    ])
  ])

  assert.deepEqual(references, [
    {
      kind: 'file',
      path: '/workspace/notes.md',
      displayPath: '/workspace/notes.md',
      label: 'notes.md',
      messageId: 'user-1',
      role: 'user'
    },
    {
      kind: 'file',
      path: '/workspace/mockup.png',
      displayPath: '/workspace/mockup.png',
      label: 'mockup.png',
      messageId: 'user-1',
      role: 'user'
    },
    {
      kind: 'file',
      path: 'src/App.tsx',
      displayPath: 'src/App.tsx',
      label: 'App.tsx',
      line: 12,
      endLine: 14,
      messageId: 'user-1',
      role: 'user'
    }
  ])
})

test('deduplicates references while keeping the newest mention', () => {
  const references = getRecentChatReferences([
    message('older', 'assistant', '[old label](src/App.tsx:10)'),
    message('newer', 'user', '[new label](src/App.tsx:20)')
  ])

  assert.deepEqual(references, [
    {
      kind: 'file',
      label: 'new label',
      messageId: 'newer',
      role: 'user',
      path: 'src/App.tsx',
      displayPath: 'src/App.tsx',
      line: 20
    }
  ])
})

test('returns no references for an explicit zero-message window', () => {
  assert.deepEqual(
    getRecentChatReferences([message('user-1', 'user', 'https://example.com')], 0),
    []
  )
})

test('keeps pinned references visible and removes them from the recent group', () => {
  const olderPinned = getRecentChatReferences([
    message('older', 'assistant', '[Old label](src/App.tsx:10)')
  ])[0]
  const currentPinned = getRecentChatReferences([
    message('current', 'assistant', '[Current label](src/App.tsx:20)')
  ])[0]
  const pinnedOutsideWindow = getRecentChatReferences([
    message('outside', 'user', '[Notes](notes.md)')
  ])[0]
  const recentLink = getRecentChatReferences([
    message('link', 'user', '[Docs](https://example.com/docs)')
  ])[0]

  assert.deepEqual(
    getDisplayedRecentChatReferences(
      [olderPinned, pinnedOutsideWindow],
      [currentPinned, recentLink]
    ),
    {
      pinnedReferences: [currentPinned, pinnedOutsideWindow],
      recentReferences: [recentLink]
    }
  )
})

test('keeps pinned references while current references are recalculated', () => {
  const pinned = getRecentChatReferences([
    message('pinned', 'assistant', '[Pinned file](src/App.tsx:20)')
  ])[0]

  assert.deepEqual(getDisplayedRecentChatReferences([pinned], []), {
    pinnedReferences: [pinned],
    recentReferences: []
  })
})

test('keeps a pinned opened file without chat-message metadata', () => {
  const openedFile = {
    kind: 'file',
    path: '/workspace/src/App.tsx',
    displayPath: 'src/App.tsx',
    label: 'App.tsx'
  }

  assert.deepEqual(getDisplayedRecentChatReferences([openedFile], []), {
    pinnedReferences: [openedFile],
    recentReferences: []
  })
  assert.deepEqual(parsePinnedRecentChatReferences({ 'codex:chat-1': [openedFile] }), {
    'codex:chat-1': [openedFile]
  })
})

test('keeps and validates pinned message text with its navigation target', () => {
  const pinnedText = {
    kind: 'text',
    providerId: 'codex',
    chatId: 'chat-1',
    messageId: 'assistant-1',
    role: 'assistant',
    turnIndex: 12,
    content: 'First line\n\nMore detail'
  }

  assert.deepEqual(getDisplayedRecentChatReferences([pinnedText], []), {
    pinnedReferences: [pinnedText],
    recentReferences: []
  })
  assert.deepEqual(parsePinnedRecentChatReferences({ 'codex:chat-1': [pinnedText] }), {
    'codex:chat-1': [pinnedText]
  })
  assert.deepEqual(
    parsePinnedRecentChatReferences({
      'codex:chat-1': [{ ...pinnedText, turnIndex: -1 }]
    }),
    {}
  )
})

test('validates and deduplicates stored pinned references', () => {
  const file = getRecentChatReferences([message('file', 'assistant', '[App](src/App.tsx:20)')])[0]
  const unsafeLink = {
    kind: 'link',
    label: 'Unsafe',
    messageId: 'unsafe',
    role: 'assistant',
    href: 'javascript:alert(1)'
  }

  assert.deepEqual(
    parsePinnedRecentChatReferences({
      'codex:chat-1': [file, file, unsafeLink],
      invalid: 'not-an-array'
    }),
    { 'codex:chat-1': [file] }
  )
})

test('keeps recently opened files newest-first and updates an existing file location', () => {
  const first = {
    kind: 'file',
    path: '/workspace/src/App.tsx',
    displayPath: 'src/App.tsx',
    label: 'App.tsx',
    line: 10
  }
  const second = {
    kind: 'file',
    path: '/workspace/README.md',
    displayPath: 'README.md',
    label: 'README.md'
  }
  const reopened = { ...first, line: 42 }

  assert.deepEqual(addRecentlyOpenedFile(addRecentlyOpenedFile([first], second), reopened), [
    reopened,
    second
  ])
})

test('validates and deduplicates stored recently opened files', () => {
  const file = {
    kind: 'file',
    path: '/workspace/src/App.tsx',
    displayPath: 'src/App.tsx',
    label: 'App.tsx'
  }

  assert.deepEqual(
    parseRecentlyOpenedFiles({
      'local\0/workspace': [file, file, { ...file, line: 0 }],
      invalid: 'not-an-array'
    }),
    { 'local\0/workspace': [file] }
  )
})

test('excludes current Recent references from Opened before applying the display limit', () => {
  const recentFile = {
    kind: 'file',
    path: '/workspace/src/App.tsx',
    displayPath: 'src/App.tsx',
    label: 'App.tsx'
  }
  const openedOnlyFile = {
    kind: 'file',
    path: '/workspace/README.md',
    displayPath: 'README.md',
    label: 'README.md'
  }
  const recentReference = getRecentChatReferences([
    message('recent', 'assistant', '[App](/workspace/src/App.tsx)')
  ])[0]

  assert.deepEqual(
    getDisplayedRecentlyOpenedFiles([recentFile, openedOnlyFile], [recentReference], 1),
    [openedOnlyFile]
  )
})
