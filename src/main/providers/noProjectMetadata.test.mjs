import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { isNoProjectChat } from '../../shared/noProject.ts'

const source = ts.createSourceFile(
  'providerService.ts',
  readFileSync(new URL('./providerService.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declarations = new Map(
  source.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .map((node) => [node.name.getText(source), node.initializer])
)
const load = (node, context) =>
  vm.runInContext(
    ts.transpile(`(${node.getText(source)})`, { target: ts.ScriptTarget.ES2022 }),
    context
  )

const fixture = () => {
  const metadata = new Map()
  const cwdProbes = []
  const native = (id) => ({ id, cwd: '/home/user', items: [], container: null, preview: '' })
  const context = vm.createContext({
    console,
    persistentChatHistory: { invalidate() {}, observe() {}, beginOpening: () => null },
    saveProviderChatHistory: () => {},
    isNoProjectChat,
    app: { getPath: () => '/fixture' },
    prepareChatWorkspace: async (_root, options) => options,
    getChatMetadata: async (id) => metadata.get(id) ?? {},
    getChatMetadataByIds: async () => metadata,
    setChatNoProject: async (id) => metadata.set(id, { ...metadata.get(id), noProject: true }),
    setChatPurpose: async () => {},
    setChatContainer: async () => {},
    getLastTurnOutcome: () => undefined,
    getChatTurnOutcomes: async () => new Map(),
    getCwdMetadata: async (cwd) => {
      cwdProbes.push(cwd)
      return { kind: 'directory', projectCwd: cwd, branchName: null, worktreeBaseBranchName: null }
    },
    getMessageReviews: async () => [],
    getChatTokenUsage: async () => ({ total: null, byTurn: new Map() }),
    getContainerTargetKey: () => 'host',
    applyTurnTokenUsage: (items) => items,
    getChatUpdateActivity: () => null,
    truncateChatUpdateText: (text) => text,
    chatUpdatePreviewLimit: 500,
    normalizeCwd: (cwd) => cwd?.trim() || null,
    adapters: Object.fromEntries(
      ['codex', 'claude', 'copilot', 'opencode'].map((providerId) => [
        providerId,
        {
          startChat: async (_message, options, onCreated) => {
            const id = `${providerId}:${options?.noProject ? 'started' : 'regular'}`
            await onCreated?.(id)
            // Simulate a provider which reports HOME regardless of the requested directory.
            assert.equal(Boolean(metadata.get(id)?.noProject), Boolean(options?.noProject))
            return native(id)
          },
          forkChat: async (_id, _messageId, onCreated) => {
            const id = `${providerId}:fork`
            await onCreated(id)
            return native(id)
          },
          continueChatInFork: async (_id, _message, _options, onCreated) => {
            const id = `${providerId}:continued-fork`
            await onCreated(id)
            return native(id)
          },
          getChats: async () => ({
            chats: [native(`${providerId}:started`), native('home-project')],
            nextCursor: null
          })
        }
      ])
    )
  })
  for (const name of [
    'applyMetadataToChat',
    'applyMetadataToChats',
    'applyMetadataToDetail',
    'getChatUpdateSummary'
  ])
    context[name] = load(declarations.get(name), context)
  const api = Object.fromEntries(
    declarations
      .get('providerApi')
      .properties.filter((node) =>
        ['startChat', 'forkChat', 'continueChatInFork', 'getChats'].includes(
          node.name?.getText(source)
        )
      )
      .map((node) => [node.name.getText(source), load(node.initializer, context)])
  )
  return { api, context, metadata, cwdProbes, native }
}

for (const providerId of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${providerId}: HOME fallback retains No Project through creation, history, updates and forks`, async () => {
    const { api, context, metadata, cwdProbes } = fixture()
    const detail = await api.startChat(providerId, 'Hello', { noProject: true })
    assert.equal(detail.noProject, true)
    assert.equal(detail.cwd, '/home/user')
    assert.equal(detail.projectCwd, null)
    assert.equal(context.getChatUpdateSummary(detail, 1).noProject, true)
    assert.ok(
      cwdProbes.every((cwd) => cwd === null),
      'General chat must not probe HOME project metadata'
    )

    const page = await api.getChats(providerId)
    assert.equal(page.chats.find((chat) => chat.id === detail.id).noProject, true)
    assert.equal(page.chats.find((chat) => chat.id === 'home-project').noProject, false)
    const home = await api.getChats(providerId, { projectCwd: '/home/user' })
    assert.equal(home.chats.length, 1)
    assert.equal(home.chats[0].id, 'home-project')

    const fork = await api.forkChat(providerId, detail.id)
    const continued = await api.continueChatInFork(providerId, detail.id, 'Follow up', 'commit', {})
    for (const chat of [fork, continued]) {
      assert.equal(chat.noProject, true)
      assert.equal(chat.projectCwd, null)
      assert.equal(metadata.get(chat.id).noProject, true)
    }
    const regular = await api.startChat(providerId, 'Project work', { cwd: '/home/user' })
    assert.equal(regular.noProject, false)
    assert.equal(regular.projectCwd, '/home/user')
  })
}
