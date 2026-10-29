import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { listSubagents } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSubagentHistory } from './ClaudeSubagentHistory.ts'
import { openClaudeHistorySource } from './ClaudeHistorySource.ts'
import { readLocalClaudeSubagentMetadata, collectClaudeSubagentSpawns } from './ClaudeSubagents.ts'
import { renderClaudeChatWindow } from './ClaudeItemRenderers.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'ClaudeProviderAdapter'
)
const names = new Set([
  'getSubagents',
  'getSubagent',
  'getSubagentWindowForItem',
  'loadSubagentMetadata',
  'openSubagentHistorySource'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((m) => names.has(m.name?.getText(source)))
    .map((m) => m.getText(source))
    .join('\n')} }; globalThis.Harness=Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const fixture = async (fn) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-child-history-')),
    previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = root
  try {
    const id = randomUUID(),
      project = join(root, 'projects', '-fixture'),
      dir = join(project, id, 'subagents')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(project, `${id}.jsonl`),
      JSON.stringify({
        type: 'user',
        uuid: 'parent',
        sessionId: id,
        parentUuid: null,
        message: { role: 'user', content: 'Parent' }
      }) + '\n'
    )
    const rows = [
      {
        type: 'user',
        uuid: 'prompt',
        parentUuid: null,
        sessionId: id,
        isSidechain: true,
        parent_tool_use_id: 'spawn',
        timestamp: '2026-10-01T00:00:00Z',
        message: { role: 'user', content: 'Child task' }
      }
    ]
    for (let i = 0; i < 1000; i++)
      rows.push({
        type: 'assistant',
        uuid: `a${i}`,
        parentUuid: i ? `a${i - 1}` : 'prompt',
        sessionId: id,
        isSidechain: true,
        parent_tool_use_id: 'spawn',
        timestamp: '2026-10-01T00:00:00Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `Answer ${i} ${'x'.repeat(4096)}` }]
        }
      })
    const path = join(dir, 'agent-child.jsonl')
    await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    await writeFile(
      join(dir, 'agent-child.meta.json'),
      JSON.stringify({ description: 'Child title', parentAgentId: null, toolUseId: 'spawn' })
    )
    let bytes = 0
    const context = vm.createContext({
      console,
      Date,
      listSubagents,
      readLocalClaudeSubagentMetadata,
      collectClaudeSubagentSpawns,
      renderClaudeChatWindow,
      getClaudeSessionStore: async () => undefined,
      getRemoteClaudeContainer: async () => null,
      getContainerTargetKey: () => 'host',
      openClaudeHistorySource: async (...args) => {
        const s = await openClaudeHistorySource(...args)
        return {
          ...s,
          read: async (offset, length) => {
            bytes += length
            return s.read(offset, length)
          }
        }
      }
    })
    vm.runInContext(code, context)
    const state = {
      id,
      cwd: '/fixture',
      container: null,
      messages: [],
      subagentTaskStatuses: new Map(),
      backgroundTaskIds: new Set()
    }
    const adapter = Object.assign(new context.Harness(), {
      subagentHistory: new ClaudeSubagentHistory(),
      ensureState: async () => state
    })
    await fn({
      adapter,
      id,
      path,
      rows,
      get bytes() {
        return bytes
      },
      reset: () => {
        bytes = 0
      }
    })
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
}

test('subagent polls read only a bounded header and cache unchanged summaries', () =>
  fixture(async (h) => {
    const first = await h.adapter.getSubagents(h.id)
    assert.equal(first.length, 1)
    assert.equal(first[0].title, 'Child title')
    assert.ok(h.bytes <= 16384, `poll read ${h.bytes} bytes`)
    h.reset()
    await h.adapter.getSubagents(h.id)
    assert.equal(h.bytes, 0, 'unchanged summaries must not reread message bodies')
  }))

test('a long single child turn opens and pages by range without loading the whole file', () =>
  fixture(async (h) => {
    const detail = await h.adapter.getSubagent(h.id, 'child', {}, { startIndex: null, limit: 10 })
    assert.ok(detail.items.some((i) => i.content?.startsWith('Answer 999')))
    assert.ok(detail.turnPagination.olderCursor)
    assert.ok(h.bytes < 160000, `opening read ${h.bytes} bytes`)
    h.reset()
    const older = await h.adapter.getSubagent(
      h.id,
      'child',
      {},
      { startIndex: null, limit: 10, cursor: detail.turnPagination.olderCursor, direction: 'older' }
    )
    assert.ok(older.items.length)
    assert.ok(older.turnPagination.newerCursor)
    assert.ok(h.bytes < 160000, `paging read ${h.bytes} bytes`)
    h.reset()
    const newer = await h.adapter.getSubagent(
      h.id,
      'child',
      {},
      { startIndex: null, limit: 10, cursor: older.turnPagination.newerCursor, direction: 'newer' }
    )
    assert.deepEqual(newer.items, detail.items)
  }))

test('subagent source paths reject traversal and observed appends refresh summaries and pages', () =>
  fixture(async (h) => {
    await assert.rejects(
      openClaudeHistorySource(h.id, undefined, '../other'),
      /Invalid Claude subagent/
    )
    await h.adapter.getSubagent(h.id, 'child')
    const last = {
      ...h.rows.at(-1),
      uuid: 'appended',
      parentUuid: 'a999',
      message: { role: 'assistant', content: [{ type: 'text', text: 'New final answer' }] }
    }
    await appendFile(h.path, JSON.stringify(last) + '\n')
    h.reset()
    const page = await h.adapter.getSubagent(h.id, 'child')
    assert.ok(page.items.some((i) => i.content === 'New final answer'))
    assert.ok(h.bytes < 160000)
  }))

test('a child section remains expandable after an append shifts the latest file page', () =>
  fixture(async (h) => {
    const page = await h.adapter.getSubagent(h.id, 'child')
    const item = page.items.find((item) => item.type === 'working') ?? page.items[0]
    assert.ok(item)
    const last = {
      ...h.rows.at(-1),
      uuid: 'appended',
      parentUuid: 'a999',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'New answer ' + 'y'.repeat(8192) }]
      }
    }
    await appendFile(h.path, JSON.stringify(last) + '\n')
    await h.adapter.getSubagent(h.id, 'child')
    h.reset()
    const expanded = await h.adapter.getSubagentWindowForItem(h.id, 'child', item.id)
    assert.ok(expanded.items.some((entry) => entry.id === item.id))
    assert.ok(h.bytes < 300000, `expansion read ${h.bytes} bytes`)
  }))
