import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as merges from './chatDetailWindow.ts'
import { refreshSubagentDetail } from './subagentUi.ts'

const code = ts.transpileModule(
  readFileSync(new URL('./workspace/useSubagentController.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React
    }
  }
).outputText
const setup = (api, items) => {
  const module = { exports: {} }
  vm.runInNewContext(code, {
    exports: module.exports,
    require: (name) => {
      if (name === '../providerApi') return { providerApi: api }
      if (name === '../chatDetailWindow') return merges
      if (name === './controllerTypes')
        return {
          chatWorkingItemPageSize: 50,
          chatWorkingItemWindowSize: 100,
          chatWorkingToolPageSize: 50,
          chatWorkingToolWindowSize: 100
        }
      return {}
    }
  })
  let view = {
    rootChatKey: 'codex:parent',
    summary: { id: 'child' },
    detail: { id: 'child', items }
  }
  const request = { current: 1 }
  const controller = module.exports.useSubagentController({
    activeSubagentChatView: view,
    selectedProviderId: 'codex',
    selectedChatId: 'parent',
    selectedChatKey: 'codex:parent',
    selectedChatKeyRef: { current: 'codex:parent' },
    subagentChatLoadRequestRef: request,
    setSubagentChatView: (update) => {
      view = update(view)
    }
  })
  return { controller, request, view: () => view }
}

test('loads a child working page using the parent session and merges its history', async () => {
  let args
  const state = setup(
    {
      getChatWorkingStepPage: async (...input) => {
        args = input
        return {
          items: [{ id: 'old', type: 'reasoning', content: 'Earlier work' }],
          startIndex: 0,
          totalCount: 60,
          status: 'worked'
        }
      }
    },
    [
      {
        id: 'step',
        type: 'working',
        status: 'worked',
        items: [],
        itemsLoaded: false,
        itemCount: 60
      }
    ]
  )
  await state.controller.handleLoadSubagentWorkingStep('step', 0)
  assert.deepEqual(args, ['codex', 'child', 'step', 0, 50, 'parent'])
  assert.equal(state.view().detail.items[0].items[0].id, 'old')
})

test('loads tool pages and full tool payloads in the child view', async () => {
  const calls = []
  const state = setup(
    {
      getChatWorkingToolPage: async (...args) => {
        calls.push(args)
        return {
          tools: [{ type: 'tool', id: 'tool', status: 'completed' }],
          startIndex: 0,
          totalCount: 1
        }
      },
      getChatWorkingItem: async (...args) => {
        calls.push(args)
        return { type: 'tool', id: 'tool', status: 'completed', stdout: 'Full result' }
      }
    },
    [
      {
        type: 'working',
        id: 'step',
        status: 'worked',
        items: [{ type: 'toolGroup', id: 'group', tools: [], toolCount: 1 }]
      }
    ]
  )
  await state.controller.handleLoadSubagentWorkingToolPage('step', 'group', 0)
  await state.controller.handleLoadSubagentWorkingItem('step', 'tool')
  assert.deepEqual(calls, [
    ['codex', 'child', 'step', 'group', 0, 50, 'parent'],
    ['codex', 'child', 'step', 'tool', 'parent']
  ])
  assert.equal(state.view().detail.items[0].items[0].tools[0].stdout, 'Full result')
})

test('ignores a pending page after closing or reopening a subagent', async () => {
  let resolve
  const state = setup(
    {
      getChatWorkingStepPage: () =>
        new Promise((done) => {
          resolve = done
        })
    },
    [{ type: 'working', id: 'step', status: 'worked', items: [] }]
  )
  const original = state.view()
  const pending = state.controller.handleLoadSubagentWorkingStep('step')
  state.request.current += 1
  resolve({ items: [], startIndex: 0, totalCount: 0, status: 'worked' })
  await pending
  assert.equal(state.view(), original)
})

test('refreshing a child retains loaded completed sections', () => {
  const step = {
    type: 'working',
    id: 'step',
    status: 'worked',
    itemCount: 60,
    items: [{ id: 'loaded' }]
  }
  const current = { id: 'child', items: [step] }
  const incoming = {
    id: 'child',
    status: 'running',
    items: [{ ...step, items: [], itemsLoaded: false }]
  }
  const refreshed = refreshSubagentDetail(current, incoming, 50, 100)
  assert.equal(refreshed.items[0], step)
  assert.equal(refreshed.status, 'running')
})
