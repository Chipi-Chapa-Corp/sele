import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeHistoryPages } from './ClaudeHistoryPages.ts'
import { openClaudeHistorySource } from './ClaudeHistorySource.ts'
import { loadClaudeHistory } from './ClaudeHistory.ts'
import * as renderers from './ClaudeItemRenderers.ts'
import { isClaudeAuthenticationFailure } from './ClaudeAuthentication.ts'
import { getClaudeSessionTitle } from './ClaudeSessionTitle.ts'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget.ts'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'

// Real disk -> SDK branch restoration -> real adapter -> rendered cursor pages.
// Unlike conversion-only tests, neither ensureState nor transcript transport is replaced.
const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const adapter = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'ClaudeProviderAdapter'
)
const selected = new Set([
  'detailRevision',
  'createState',
  'ensureState',
  'readHistoryPage',
  'refreshIdleHistory',
  'readCompleteHistory',
  'ensureCompleteState',
  'getChat',
  'getChatWindow',
  'getChatCursorWindow',
  'getChatWindowForItem',
  'getSubagents',
  'createChatDetail',
  'startStateQuery'
])
const code = ts.transpileModule(
  `class Harness {${adapter.members
    .filter((m) => selected.has(m.name?.getText(source)))
    .map((m) => m.getText(source))
    .join('\n')}}; globalThis.Harness=Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const harness = () => {
  let bytes = 0,
    fullReads = 0
  const context = vm.createContext({
    ...renderers,
    getSessionInfo,
    getProviderChatTurns,
    sliceProviderChatTurns,
    getContainerTargetKey,
    normalizeContainerTarget,
    isClaudeAuthenticationFailure,
    markTranscriptRecordsChanged,
    // Fixtures read local transcripts; container transport is covered by ClaudeHistorySource.
    getRemoteClaudeContainer: async () => null,
    getClaudeSessionStore: async () => undefined,
    Date,
    openClaudeHistorySource: async (...args) => {
      const file = await openClaudeHistorySource(...args)
      return {
        ...file,
        read: async (offset, length) => {
          bytes += length
          return file.read(offset, length)
        }
      }
    },
    loadClaudeHistory: async (...args) => {
      fullReads++
      return loadClaudeHistory(...args)
    },
    listSubagents: async () => [],
    getSubagentMessages: async () => assert.fail('No subagents in fixture'),
    collectClaudeSubagentSpawns: () => new Map(),
    AsyncMessageQueue: class {
      close() {}
    },
    randomUUID
  })
  vm.runInContext(code, context)
  const instance = new context.Harness()
  Object.assign(instance, {
    states: new Map(),
    stateLoads: new Map(),
    sessionContainers: new Map(),
    sessionMetadata: new Map(),
    sessionOptions: new Map(),
    historyPages: new ClaudeHistoryPages(),
    stateGeneration: 0,
    disposed: false,
    authenticationFailures: new Set(),
    authenticatedSources: new Set(),
    transcriptProjections: new Map(),
    touchState: () => {},
    leaseStateForAdmission: () => {},
    trimIdleStates: () => {},
    rememberStateTranscriptSize: () => {},
    getDrainingMessage: () => null,
    getPendingMessages: () => [],
    getPendingApproval: () => null,
    getPendingUserInput: () => null,
    scheduleSessionMetadataRefresh: () => {},
    getTitle: (s) => getClaudeSessionTitle(s.metadata),
    loadSubagentMetadata: async () => new Map(),
    pinState: () => {},
    unpinState: () => {},
    closeStateQuery: async () => {},
    getQueryRuntime: async () => ({ container: null }),
    getBaseQueryOptions: () => ({}),
    consumeStateQuery: async () => {},
    createElicitationHandler: () => () => {},
    createPermissionHandler: () => () => {}
  })
  return {
    instance,
    get bytes() {
      return bytes
    },
    get fullReads() {
      return fullReads
    },
    context
  }
}
const record = (id, type, uuid, parentUuid, content) => ({
  sessionId: id,
  type,
  uuid,
  parentUuid,
  cwd: '/fixture',
  timestamp: '2026-10-01T12:00:00.000Z',
  message: { role: type, content }
})
const records = (id, start, count, pad = '') =>
  Array.from({ length: count }, (_, j) => {
    const i = start + j
    return [
      record(id, 'user', `u${i}`, i ? `a${i - 1}` : null, `Prompt ${i}`),
      record(id, 'assistant', `a${i}`, `u${i}`, `Answer ${i} ${pad}`)
    ]
  }).flat()
const fixture = async (fn) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-claude-opening-'))
  const previous = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = root
    const project = join(root, 'projects', '-fixture')
    await mkdir(project, { recursive: true })
    const id = randomUUID(),
      path = join(project, `${id}.jsonl`)
    const all = records(id, 0, 1000, 'x'.repeat(4096))
    await writeFile(path, all.map((e) => JSON.stringify(e)).join('\n') + '\n')
    await fn({ id, path, all })
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
}

test('uncached opening, subagent listing and scrolling use bounded disk reads through the actual adapter', async () =>
  fixture(async ({ id }) => {
    const h = harness(),
      a = h.instance
    const latest = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    assert.equal(latest.items[0].id, 'u990')
    assert.equal(getProviderChatTurns(latest.items).length, 10)
    assert.equal(latest.turnPagination.kind, 'cursor')
    assert.ok(h.bytes < 200000, `uncached opening read ${h.bytes} bytes`)
    await a.getSubagents(id)
    const older = await a.getChatCursorWindow(id, {
      cursor: latest.turnPagination.olderCursor,
      direction: 'older',
      limit: 10
    })
    assert.equal(older.items[0].id, 'u980')
    const newer = await a.getChatCursorWindow(id, {
      cursor: older.turnPagination.newerCursor,
      direction: 'newer',
      limit: 10
    })
    assert.deepEqual(newer.items, latest.items)
    const jump = await a.getChatWindowForItem(id, 'u950', 10)
    assert.ok(jump.items.some((i) => i.id === 'u950'))
    assert.ok(jump.turnPagination.newerCursor)
    assert.equal(h.fullReads, 0, 'opening/paging/lookup must never call the full loader')
    assert.equal(
      a.states.get(id).messages[0].uuid,
      'u990',
      'paging must not replace the runtime tail'
    )
  }))

test('first open uses page and catalog metadata without waiting for an SDK metadata lookup', async () =>
  fixture(async ({ id, path }) => {
    const h = harness(),
      a = h.instance
    let metadataReads = 0
    const refreshes = []
    h.context.getSessionInfo = async () => {
      metadataReads++
      throw new Error('SDK metadata is unavailable')
    }
    a.scheduleSessionMetadataRefresh = (state) => refreshes.push(state.id)
    a.sessionMetadata.set(id, {
      sessionId: id,
      summary: 'Old title',
      customTitle: 'Old title',
      cwd: '/stale',
      gitBranch: 'catalog-branch',
      lastModified: 1
    })
    await appendFile(
      path,
      JSON.stringify({ type: 'custom-title', customTitle: 'Current title', sessionId: id }) + '\n'
    )
    const detail = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    assert.equal(detail.items[0].id, 'u990')
    assert.equal(detail.title, 'Current title', 'fresh page fields override catalog fields')
    assert.equal(detail.cwd, '/fixture')
    assert.equal(detail.branchName, 'catalog-branch', 'missing page fields retain catalog data')
    assert.ok(a.states.get(id).updatedAt > 1)
    assert.equal(metadataReads, 0, 'SDK enrichment must not block the first page')
    assert.deepEqual(refreshes, [id], 'local enrichment is scheduled after state admission')
  }))

test('live turns retain the cursor boundary; export does not change the viewed state', async () =>
  fixture(async ({ id, all }) => {
    const h = harness(),
      a = h.instance
    const latest = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    const state = a.states.get(id)
    const live = await loadClaudeHistory(id, {
      load: async () => [...all, ...records(id, 1000, 15)],
      append: async () => {}
    })
    state.messages = live.filter((m) => Number(m.uuid.slice(1)) >= 990)
    state.active = true
    const update = a.createChatDetail(state, true)
    assert.equal(getProviderChatTurns(update.items).length, 25)
    assert.equal(update.turnPagination.olderCursor, latest.turnPagination.olderCursor)
    const older = await a.getChatCursorWindow(id, {
      cursor: update.turnPagination.olderCursor,
      direction: 'older',
      limit: 10
    })
    const newer = await a.getChatCursorWindow(id, {
      cursor: older.turnPagination.newerCursor,
      direction: 'newer',
      limit: 10
    })
    assert.deepEqual(newer.items, a.createChatDetail({ ...state, active: false }).items)
    const cursor = state.historyPagination
    const exported = await a.getChatWindow(id, { startIndex: 0, limit: Number.MAX_SAFE_INTEGER })
    assert.equal(getProviderChatTurns(exported.items).length, 1015)
    assert.equal(state.historyPagination, cursor)
    assert.equal(state.messages.length, 50)
  }))

test('reopening idle history observes external appends without a full read', async () =>
  fixture(async ({ id, path }) => {
    const h = harness(),
      a = h.instance
    await a.getChatWindow(id, { startIndex: null, limit: 10 })
    await appendFile(
      path,
      records(id, 1000, 1)
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n'
    )
    const refreshed = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    assert.equal(refreshed.items[0].id, 'u991')
    assert.ok(
      refreshed.items.some((i) => i.role === 'assistant' && i.content.startsWith('Answer 1000'))
    )
    assert.equal(h.fullReads, 0)
    const refs = await a.getChatCursorWindow(id, { cursor: null, direction: 'older', limit: 40 })
    assert.equal(getProviderChatTurns(refs.items).length, 40)
    assert.equal(a.states.get(id).messages.length, 20)
  }))

test('idle refresh waits for the completed live response to be persisted, preserving its rendered ID', async () =>
  fixture(async ({ id, path }) => {
    const h = harness(),
      a = h.instance
    await a.getChatWindow(id, { startIndex: null, limit: 10 })
    const state = a.states.get(id)
    const user = {
      type: 'user',
      uuid: 'u1000',
      session_id: id,
      parent_tool_use_id: null,
      message: { role: 'user', content: 'New prompt' }
    }
    const answer = {
      type: 'assistant',
      uuid: 'live-complete',
      session_id: id,
      parent_tool_use_id: null,
      message: {
        id: 'msg_persist',
        role: 'assistant',
        content: [{ type: 'text', text: 'Fresh answer' }]
      }
    }
    state.messages = [...state.messages, user, answer]
    state.historyDirty = true
    const pendingMessages = state.messages
    const before = a.createChatDetail(state).items.find((i) => i.content === 'Fresh answer')
    const lagging = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    assert.equal(state.messages, pendingMessages)
    assert.ok(lagging.items.some((i) => i.id === before.id))
    const disk = [
      record(id, 'user', 'u1000', 'a999', 'New prompt'),
      {
        ...record(id, 'assistant', 'disk-complete', 'u1000', ''),
        message: answer.message
      }
    ]
    await appendFile(path, disk.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    const exported = await a.getChatWindow(id, { startIndex: 0, limit: Number.MAX_SAFE_INTEGER })
    assert.equal(
      exported.items.filter((i) => i.content === 'Fresh answer').length,
      1,
      'the persisted split block and live aggregate must not both appear in an export'
    )
    const committed = await a.getChatWindow(id, { startIndex: null, limit: 10 })
    assert.equal(state.historyDirty, false)
    assert.equal(state.messages[0].uuid, 'u991')
    assert.ok(committed.items.some((i) => i.id === before.id))
    assert.equal(h.fullReads, 1, 'only the explicit export may load complete history')
  }))

test('resuming a paginated chat uses the stored session ID without hydrating the prefix', async () =>
  fixture(async ({ id }) => {
    const h = harness(),
      a = h.instance
    await a.getChatWindow(id, { startIndex: null, limit: 10 })
    let options
    h.context.getBrowserAutomationService = () => null
    h.context.getClaudeModel = () => undefined
    h.context.query = (request) => {
      options = request.options
      return { close() {} }
    }
    await a.startStateQuery(a.states.get(id))
    assert.equal(options.resume, id)
    assert.equal(options.sessionId, undefined)
    assert.equal(h.fullReads, 0)
    assert.equal(a.states.get(id).messages.length, 20)
  }))
