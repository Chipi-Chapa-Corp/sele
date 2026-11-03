import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { LimitResetQueue } from './LimitResetQueue.ts'

// Exercise the service's account/model routing without starting Electron or provider processes.
const source = ts.createSourceFile(
  'providerService.ts',
  readFileSync(new URL('./providerService.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (node) => node.name.getText(source) === 'queueLimitResetMessage'
    )
)
const code = ts.transpile(`${declaration.getText(source)};queueLimitResetMessage`, {
  target: ts.ScriptTarget.ES2022
})

for (const providerId of ['codex', 'claude', 'copilot', 'opencode-v2']) {
  test(`${providerId} queues against the failed chat's account, container and model reset window`, async () => {
    const now = 1_800_000_000_000
    const entries = new Map()
    const queue = new LimitResetQueue(
      {
        list: async () => [...entries.values()],
        put: async (entry) => {
          entries.set(entry.id, entry)
        },
        remove: async (id) => {
          entries.delete(id)
        }
      },
      async () => {},
      () => now
    )
    const remote = { kind: 'container', tool: 'ssh', name: 'remote' }
    const detail = { container: remote, accountId: 'chat-account' }
    const calls = []
    const add = vm.runInNewContext(code, {
      providerApi: {
        getChat: async (provider, chat) => {
          assert.equal(provider, providerId)
          assert.equal(chat, 'chat')
          return detail
        }
      },
      adapters: {
        [providerId]: {
          getUsage: async (options) => {
            calls.push(options)
            return {
              rateLimits: [
                {
                  id: 'relevant',
                  label: 'Model',
                  kind: 'primary',
                  usedPercent: 100,
                  usageScope: 'wanted',
                  resetsAt: now + 1000
                },
                {
                  id: 'other',
                  label: 'Other',
                  kind: 'primary',
                  usedPercent: 100,
                  usageScope: 'other',
                  resetsAt: now + 100_000
                }
              ]
            }
          },
          getModels: async () => [{ id: 'selected-model', usageScope: 'wanted' }]
        }
      },
      limitResetQueue: queue
    })
    const options = {
      model: 'selected-model',
      container: null,
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write'
    }
    await add(providerId, 'chat', 'Continue the original task.', options)
    const entry = [...entries.values()][0]
    assert.equal(entry.content, 'Continue the original task.')
    assert.equal(entry.accountId, 'chat-account')
    assert.equal(entry.options.container, remote)
    assert.equal(entry.resetsAt, now + 1000)
    assert.equal(calls[0].chatId, 'chat')
    assert.equal(calls[0].accountId, 'chat-account')
    assert.equal(calls[0].container, remote)
    assert.equal(calls[0].forceRefresh, true)
    await add(providerId, 'chat', 'Stale', options, () => false)
    assert.equal(entries.size, 1)
    detail.writeAccess = 'readOnly'
    await assert.rejects(add(providerId, 'chat', 'Read-only', options), /read-only/)
    await queue.close()
  })
}
