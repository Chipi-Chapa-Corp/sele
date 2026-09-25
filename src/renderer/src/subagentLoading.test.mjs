import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as merges from './chatDetailWindow.ts'
import {
  beginSubagentPageNavigation,
  getSubagentPageNavigationEpoch,
  refreshSubagentDetail
} from './subagentUi.ts'

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
const setup = (api, items, detailFields = {}) => {
  const module = { exports: {} }
  vm.runInNewContext(code, {
    console: { error() {} },
    exports: module.exports,
    window: { requestAnimationFrame: (callback) => callback() },
    require: (name) => {
      if (name === '../providerApi') return { providerApi: api }
      if (name === '../chatDetailWindow') return merges
      if (name === '../subagentUi') return { beginSubagentPageNavigation }
      if (name === './chatControllerUtils')
        return {
          getErrorMessage: (error, fallback) => (error instanceof Error ? error.message : fallback)
        }
      if (name === '../../../shared/provider') return { providerSubagentTurnPageSize: 10 }
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
    detail: { id: 'child', items, ...detailFields }
  }
  const request = { current: 1 }
  const controller = module.exports.useSubagentController({
    activeSubagentChatView: view,
    selectedProviderId: 'codex',
    selectedChatId: 'parent',
    selectedChatKey: 'codex:parent',
    selectedChatKeyRef: { current: 'codex:parent' },
    subagentChatLoadRequestRef: request,
    subagentContentRef: { current: { scrollTop: 0, scrollHeight: 1000 } },
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

test('older child turns remain visible while a poll advances the live tail', () => {
  const current = {
    id: 'child',
    status: 'running',
    itemsStartTurnIndex: 10,
    turnCount: 40,
    items: [{ type: 'message', id: 'old', role: 'user', content: 'history' }]
  }
  const incoming = {
    id: 'child',
    status: 'completed',
    itemsStartTurnIndex: 31,
    turnCount: 41,
    items: [{ type: 'message', id: 'new', role: 'user', content: 'latest' }]
  }
  const refreshed = refreshSubagentDetail(current, incoming, 50, 100)
  assert.equal(refreshed.items[0].id, 'old')
  assert.equal(refreshed.itemsStartTurnIndex, 10)
  assert.equal(refreshed.turnCount, 41)
  assert.equal(refreshed.status, 'completed')
})

test('older child page navigation requests an exact window and preserves its coordinates', async () => {
  let args
  const state = setup(
    {
      getSubagent: async (...input) => {
        args = input
        return {
          id: 'child',
          status: 'completed',
          itemsStartTurnIndex: 10,
          turnCount: 30,
          items: [{ type: 'message', id: 'u10', role: 'user', content: 'old' }]
        }
      }
    },
    [{ type: 'message', id: 'u20', role: 'user', content: 'latest' }],
    { itemsStartTurnIndex: 20, turnCount: 30 }
  )
  await state.controller.handleNavigateSubagentTurns('older')
  assert.deepEqual(args.slice(0, 3), ['codex', 'parent', 'child'])
  assert.equal(args[3].startIndex, 10)
  assert.equal(args[3].limit, 10)
  assert.equal(state.view().detail.itemsStartTurnIndex, 10)
  assert.equal(state.view().detail.items[0].id, 'u10')
})

test('child turn navigation ignores overlapping requests and reports page errors', async () => {
  let rejectPage
  let calls = 0
  const state = setup(
    {
      getSubagent: async () => {
        calls += 1
        return new Promise((_, reject) => {
          rejectPage = reject
        })
      }
    },
    [{ type: 'message', id: 'u20', role: 'user', content: 'latest' }],
    { itemsStartTurnIndex: 20, turnCount: 30 }
  )
  const pending = state.controller.handleNavigateSubagentTurns('older')
  const epochDuringNavigation = getSubagentPageNavigationEpoch(state.request)
  await state.controller.handleNavigateSubagentTurns('latest')
  assert.equal(calls, 1)
  assert.equal(state.view().pageLoading, true)
  rejectPage(new Error('read failed'))
  await pending
  assert.notEqual(
    getSubagentPageNavigationEpoch(state.request),
    epochDuringNavigation,
    'a poll started during navigation must not publish after that navigation settles'
  )
  assert.equal(state.view().pageLoading, false)
  assert.equal(state.view().detail.items[0].id, 'u20')
  assert.match(state.view().error, /read failed/)
})
