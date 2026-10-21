import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composerDraftsStorageKey,
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
    promptDraftsByProject: new Map([
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
  const state = { composerDrafts: new Map(), promptDraftsByProject: new Map() }
  state.composerDrafts = updateComposerDraft(state.composerDrafts, 'project', 'message', 'prompt')
  state.promptDraftsByProject = addPromptDraft(state.promptDraftsByProject, 'project', {
    id: 'saved',
    prompt: 'prompt'
  })
  state.composerDrafts = updateComposerDraft(state.composerDrafts, 'project', 'message', '')
  writeStoredComposerDrafts(state)
  let restored = readStoredComposerDrafts()
  assert.equal(getComposerDraft(restored.composerDrafts, 'project').message, '')
  const draft = getPromptDrafts(restored.promptDraftsByProject, 'project')[0]
  restored.promptDraftsByProject = removePromptDraft(
    restored.promptDraftsByProject,
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
  assert.deepEqual(getPromptDrafts(restored.promptDraftsByProject, 'project'), [])
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
  assert.deepEqual(
    readStoredComposerDrafts(),
    { composerDrafts: new Map(), promptDraftsByProject: new Map() }
  )
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
      promptDraftsByProject: [
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
  assert.deepEqual(getPromptDrafts(parsed.promptDraftsByProject, 'valid'), [
    { id: 'draft', prompt: 'keep' }
  ])
  assert.deepEqual([...parsed.composerDrafts.keys()], ['valid'])
  for (const value of [null, 'null', '[]', '42']) {
    assert.equal(parseStoredComposerDrafts(value).composerDrafts.size, 0)
  }
})
