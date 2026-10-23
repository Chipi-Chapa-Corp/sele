import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composerDraftsStorageKey,
  releaseComposerDraftScope,
  moveComposerDraftScope,
  parseStoredComposerDrafts,
  readStoredComposerDrafts,
  writeStoredComposerDrafts
} from './composerDraftStorage.ts'
import {
  addPromptDraft,
  appendPromptDraft,
  getComposerDraft,
  getComposerDraftScopeKey,
  getPromptDrafts,
  removePromptDraft,
  restoreFailedComposerMessage,
  updateComposerDraft
} from './composerDraft.ts'
import { createPreferenceClient } from '../../preload/preferenceClient.ts'

const image = {
  kind: 'image',
  name: 'image.png',
  path: '/image.png',
  dataUrl: 'data:image/png;base64,AA=='
}
const skill = {
  name: 'skill',
  path: '/skill',
  description: '',
  shortDescription: null,
  displayName: null,
  scope: 'repo',
  enabled: true
}
const app = {
  id: 'app',
  name: 'app',
  description: '',
  enabled: true,
  callable: true,
  skillNames: []
}
const makeClient = async (disk) => {
  const client = createPreferenceClient({
    initialize: async () => ({ ok: true, value: { ...disk } }),
    write: async (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete disk[key]
        else disk[key] = value
      }
      return { ok: true, value: null }
    },
    commit: () => {
      throw new Error('unexpected synchronous write')
    }
  })
  await client.initialize()
  globalThis.window = { preferencesApi: client }
  return client
}

test('project and chat composers survive a fresh preference client with all selected resources', async () => {
  const disk = {}
  const client = await makeClient(disk)
  const projectA = getComposerDraftScopeKey(null, 'cwd:/a')
  const projectB = getComposerDraftScopeKey(null, 'cwd:/b')
  let drafts = updateComposerDraft(new Map(), projectA, 'message', '  unfinished prompt\n')
  drafts = updateComposerDraft(drafts, projectA, 'attachments', [
    image,
    { kind: 'file', name: 'file.txt', path: '/file.txt' }
  ])
  drafts = updateComposerDraft(drafts, projectA, 'skills', [skill])
  drafts = updateComposerDraft(drafts, projectA, 'apps', [app])
  drafts = updateComposerDraft(drafts, projectB, 'message', 'other project')
  drafts = updateComposerDraft(drafts, 'codex:chat', 'message', 'existing chat')
  const state = {
    composerDrafts: drafts,
    promptDraftsByScope: new Map([
      [
        'cwd:/a',
        [
          { id: 'first', prompt: 'first' },
          { id: 'second', prompt: 'second' }
        ]
      ],
      ['cwd:/b', [{ id: 'other', prompt: 'other' }]]
    ])
  }
  writeStoredComposerDrafts(state)
  await client.flush()
  await makeClient(disk)
  assert.deepEqual(readStoredComposerDrafts(), state)
})

test('stashing, restoring, failed sends and deleting the final draft persist without resurrection', async () => {
  const disk = {}
  const client = await makeClient(disk)
  const state = { composerDrafts: new Map(), promptDraftsByScope: new Map() }
  state.composerDrafts = updateComposerDraft(state.composerDrafts, 'project', 'message', 'prompt')
  state.promptDraftsByScope = addPromptDraft(state.promptDraftsByScope, 'project', {
    id: 'saved',
    prompt: 'prompt'
  })
  state.composerDrafts = updateComposerDraft(state.composerDrafts, 'project', 'message', '')
  writeStoredComposerDrafts(state)
  let restored = readStoredComposerDrafts()
  assert.equal(getComposerDraft(restored.composerDrafts, 'project').message, '')
  const draft = getPromptDrafts(restored.promptDraftsByScope, 'project')[0]
  restored.promptDraftsByScope = removePromptDraft(
    restored.promptDraftsByScope,
    'project',
    draft.id
  )
  restored.composerDrafts = updateComposerDraft(
    restored.composerDrafts,
    'project',
    'message',
    appendPromptDraft('new text', draft.prompt)
  )
  writeStoredComposerDrafts(restored)
  restored = readStoredComposerDrafts()
  assert.deepEqual(getPromptDrafts(restored.promptDraftsByScope, 'project'), [])
  assert.equal(getComposerDraft(restored.composerDrafts, 'project').message, 'new text\n\nprompt')
  restored.composerDrafts = updateComposerDraft(restored.composerDrafts, 'project', 'message', '')
  restored.composerDrafts = restoreFailedComposerMessage(
    restored.composerDrafts,
    'project',
    'failed send'
  )
  writeStoredComposerDrafts(restored)
  assert.equal(
    getComposerDraft(readStoredComposerDrafts().composerDrafts, 'project').message,
    'failed send'
  )
  restored.composerDrafts = updateComposerDraft(restored.composerDrafts, 'project', 'message', '')
  writeStoredComposerDrafts(restored)
  await client.flush()
  await makeClient(disk)
  assert.deepEqual(readStoredComposerDrafts(), {
    composerDrafts: new Map(),
    promptDraftsByScope: new Map()
  })
  assert.equal(disk[composerDraftsStorageKey], undefined)
})

test('malformed stored entries cannot break valid project prompts', () => {
  const parsed = parseStoredComposerDrafts(
    JSON.stringify({
      composerDrafts: [
        null,
        ['bad', null],
        ['bad-message', { message: 42 }],
        [
          'valid',
          {
            message: 'keep',
            attachments: [image, null, { kind: 'file' }],
            skills: [skill, {}],
            apps: [app, false]
          }
        ]
      ],
      promptDraftsByScope: [
        null,
        ['bad', {}],
        ['valid', [{ id: 'draft', prompt: 'keep' }, null, { id: 12, prompt: 'bad' }]]
      ]
    })
  )
  assert.deepEqual(getComposerDraft(parsed.composerDrafts, 'valid'), {
    message: 'keep',
    attachments: [image],
    skills: [skill],
    apps: [app]
  })
  assert.deepEqual(getPromptDrafts(parsed.promptDraftsByScope, 'valid'), [
    { id: 'draft', prompt: 'keep' }
  ])
  assert.deepEqual([...parsed.composerDrafts.keys()], ['valid'])
  for (const value of [null, 'null', '[]', '42']) {
    assert.equal(parseStoredComposerDrafts(value).composerDrafts.size, 0)
  }
})

test('legacy project prompts migrate into the new-chat composer without leaking to chats', () => {
  const parsed = parseStoredComposerDrafts(
    JSON.stringify({
      promptDraftsByProject: [['host\0/a', [{ id: 'legacy', prompt: 'keep me' }]]]
    })
  )
  assert.deepEqual(getPromptDrafts(parsed.promptDraftsByScope, 'new-chat:host\0/a'), [
    { id: 'legacy', prompt: 'keep me' }
  ])
  assert.deepEqual(getPromptDrafts(parsed.promptDraftsByScope, 'codex:chat'), [])
})

test('chat creation moves private drafts, and Done releases saved prompts to new chats only', () => {
  const from = getComposerDraftScopeKey(null, 'host\0/a')
  const draft = { message: 'typed during send', attachments: [image], skills: [skill], apps: [app] }
  const saved = [{ id: 'saved', prompt: 'next task' }]
  const other = [{ id: 'other', prompt: 'other task' }]
  const state = {
    composerDrafts: new Map([
      [from, draft],
      ['claude:other', { ...draft, message: 'other input' }]
    ]),
    promptDraftsByScope: new Map([
      [from, saved],
      ['claude:other', other]
    ])
  }
  const moved = moveComposerDraftScope(state, from, 'codex:created')
  assert.equal(moved.composerDrafts.has(from), false)
  assert.equal(moved.promptDraftsByScope.has(from), false)
  assert.deepEqual(moved.composerDrafts.get('codex:created'), draft)
  assert.deepEqual(moved.promptDraftsByScope.get('codex:created'), saved)
  assert.equal(moveComposerDraftScope(moved, from, 'codex:created'), moved)
  const released = releaseComposerDraftScope(moved, 'codex:created', from)
  assert.equal(released.composerDrafts.has('codex:created'), false)
  assert.equal(released.promptDraftsByScope.has('codex:created'), false)
  assert.deepEqual(released.composerDrafts.get(from), draft)
  assert.deepEqual(
    released.promptDraftsByScope.get(from),
    saved.map((item) => ({ ...item, newChatsOnly: true }))
  )
  assert.deepEqual(
    released.composerDrafts.get('claude:other'),
    state.composerDrafts.get('claude:other')
  )
  assert.deepEqual(released.promptDraftsByScope.get('claude:other'), other)
  assert.equal(releaseComposerDraftScope(released, 'codex:created', from), released)
  assert.equal(state.composerDrafts.has(from), true)

  // Starting another chat carries its own saved prompts, while released prompts stay available.
  const withPrivate = {
    ...released,
    promptDraftsByScope: addPromptDraft(released.promptDraftsByScope, from, {
      id: 'private',
      prompt: 'belongs to next chat'
    })
  }
  const started = moveComposerDraftScope(withPrivate, from, 'codex:next')
  assert.deepEqual(started.promptDraftsByScope.get('codex:next'), [
    { id: 'private', prompt: 'belongs to next chat' }
  ])
  assert.deepEqual(started.promptDraftsByScope.get(from), released.promptDraftsByScope.get(from))
  assert.deepEqual(started.composerDrafts.get('codex:next'), draft)
  assert.equal(moveComposerDraftScope(started, from, 'codex:another'), started)
  assert.deepEqual(
    parseStoredComposerDrafts(
      JSON.stringify({
        composerDrafts: [...started.composerDrafts],
        promptDraftsByScope: [...started.promptDraftsByScope]
      })
    ),
    started
  )
})

test('Done appends to existing new-chat drafts without replacing input or other projects', () => {
  const from = 'codex:done'
  const to = 'new-chat:host\0/a'
  const empty = { message: '', attachments: [], skills: [], apps: [] }
  const state = {
    composerDrafts: new Map([
      [from, { ...empty, message: 'unsent' }],
      [to, { ...empty, message: 'new input' }]
    ]),
    promptDraftsByScope: new Map([
      [from, [{ id: 'done', prompt: 'done task' }]],
      [to, [{ id: 'new', prompt: 'new task' }]],
      ['new-chat:host\0/b', [{ id: 'other', prompt: 'other project' }]]
    ])
  }
  const released = releaseComposerDraftScope(state, from, to)
  assert.equal(released.composerDrafts.get(to).message, 'new input\n\nunsent')
  assert.deepEqual(released.promptDraftsByScope.get(to), [
    { id: 'new', prompt: 'new task' },
    { id: 'done', prompt: 'done task', newChatsOnly: true }
  ])
  assert.deepEqual(
    released.promptDraftsByScope.get('new-chat:host\0/b'),
    state.promptDraftsByScope.get('new-chat:host\0/b')
  )
})

test('typing saves only text and image references, including after restart and scope moves', async () => {
  const disk = {}
  const client = await makeClient(disk)
  const writes = []
  const setItem = client.setItem
  client.setItem = (key, value) => {
    writes.push({ key, bytes: value.length })
    return setItem(key, value)
  }
  const largeImage = { ...image, dataUrl: image.dataUrl + 'A'.repeat(4 * 1024 * 1024) }
  let state = {
    composerDrafts: new Map([
      [
        'new',
        {
          message: 'long prompt\n'.repeat(1000),
          attachments: [largeImage],
          skills: [],
          apps: []
        }
      ]
    ]),
    promptDraftsByScope: new Map()
  }
  writeStoredComposerDrafts(state)
  assert.equal(writes.filter((write) => write.bytes > 1024 * 1024).length, 1)
  await client.flush()
  const imageKey = JSON.parse(disk[composerDraftsStorageKey]).imageKeys[0]
  assert.equal(disk[imageKey], largeImage.dataUrl)
  writes.length = 0
  for (let i = 0; i < 20; i++) {
    state = {
      ...state,
      composerDrafts: updateComposerDraft(
        state.composerDrafts,
        'new',
        'message',
        (text) => text + 'x'
      )
    }
    writeStoredComposerDrafts(state)
  }
  assert.equal(writes.length, 20)
  assert.ok(writes.every((write) => write.key === composerDraftsStorageKey && write.bytes < 20000))
  await client.flush()
  const restarted = await makeClient(disk)
  state = readStoredComposerDrafts()
  assert.deepEqual(state.composerDrafts.get('new').attachments, [largeImage])
  state = moveComposerDraftScope(state, 'new', 'codex:created')
  writeStoredComposerDrafts(state)
  await restarted.flush()
  assert.deepEqual(JSON.parse(disk[composerDraftsStorageKey]).imageKeys, [imageKey])
  assert.deepEqual(readStoredComposerDrafts(), state)
  state = {
    ...state,
    composerDrafts: updateComposerDraft(state.composerDrafts, 'codex:created', 'attachments', [])
  }
  writeStoredComposerDrafts(state)
  await restarted.flush()
  assert.equal(disk[imageKey], undefined, 'removed image payload is reclaimed')
  writeStoredComposerDrafts({ composerDrafts: new Map(), promptDraftsByScope: new Map() })
  await restarted.flush()
  assert.deepEqual(disk, {})
})

test('inline legacy images migrate without losing draft resources', async () => {
  const state = {
    composerDrafts: new Map([
      ['legacy', { message: 'keep', attachments: [image], skills: [skill], apps: [app] }]
    ]),
    promptDraftsByScope: new Map([['legacy', [{ id: 'saved', prompt: 'later' }]]])
  }
  const disk = {
    [composerDraftsStorageKey]: JSON.stringify({
      composerDrafts: [...state.composerDrafts],
      promptDraftsByScope: [...state.promptDraftsByScope]
    })
  }
  const client = await makeClient(disk)
  const restored = readStoredComposerDrafts()
  assert.deepEqual(restored, state)
  writeStoredComposerDrafts(restored)
  await client.flush()
  assert.equal(disk[composerDraftsStorageKey].includes(image.dataUrl), false)
  await makeClient(disk)
  assert.deepEqual(readStoredComposerDrafts(), state)
})

test('missing or invalid image references preserve text and never read unrelated preferences', () => {
  const reads = []
  const parsed = parseStoredComposerDrafts(
    JSON.stringify({
      composerDrafts: [
        [
          'chat',
          {
            message: 'keep',
            skills: [],
            apps: [],
            attachments: [
              {
                kind: 'image',
                name: 'missing',
                path: '/missing',
                imageKey: 'sele:composer-image:v1:missing'
              },
              {
                kind: 'image',
                name: 'invalid',
                path: '/invalid',
                imageKey: 'sele:other-preference'
              },
              { kind: 'file', name: 'file', path: '/file' }
            ]
          }
        ]
      ]
    }),
    (key) => {
      reads.push(key)
      return null
    }
  )
  assert.deepEqual(reads, ['sele:composer-image:v1:missing'])
  assert.equal(parsed.composerDrafts.get('chat').message, 'keep')
  assert.deepEqual(parsed.composerDrafts.get('chat').attachments, [
    { kind: 'file', name: 'file', path: '/file' }
  ])
})
