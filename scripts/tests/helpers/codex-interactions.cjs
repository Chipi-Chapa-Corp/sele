const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

exports.createInteractionHarness = (library) => {
  const file = path.resolve(__dirname, '../../../src/main/providers/codex/CodexProviderAdapter.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
  )
  const members = new Set([
    'handleServerRequest',
    'handleCommandExecutionApprovalRequest',
    'handleFileChangeApprovalRequest',
    'getProviderPendingApproval',
    'getProviderPendingUserInput',
    'addPendingApproval',
    'removePendingApproval',
    'createApprovalResponse',
    'resolveApproval',
    'resolveUserInput'
  ])
  const value = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : null
  const adapter = vm.runInNewContext(
    ts.transpile(
      `class Harness { ${declaration.members
        .filter((node) => members.has(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')} }; new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      ...library,
      getRecordValue: value,
      getOptionalStringValue: (value) => (typeof value === 'string' ? value : null),
      getOptionalNumberValue: (value) => (typeof value === 'number' ? value : null),
      requireStringValue: (value) => {
        if (typeof value !== 'string' || !value) throw new Error('Invalid string')
        return value
      },
      Date
    }
  )
  const sent = []
  const flags = new Set()
  const client = {
    resolveServerRequest: (id, result) => sent.push({ id, result }),
    request: async (method, _params, options) => {
      if (method === 'userVerification/status')
        return { credentialId: 'mock-device', unavailableReason: null }
      if (method === 'userVerification/verify') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 300)
          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('Mock verification canceled.'))
            },
            { once: true }
          )
        })
        return { proof: { credentialId: 'mock-device', signature: 'bW9jay1zaWduYXR1cmU' } }
      }
      throw new Error('Unexpected mock RPC: ' + method)
    }
  }
  Object.assign(adapter, {
    client,
    userQuestions: new library.CodexUserQuestions(),
    pendingApprovalsByThread: new Map(),
    activeTurnIds: new Map(),
    threads: new Map(),
    getClient: () => client,
    getCurrentContainer: () => null,
    rememberThreadContainer: () => {},
    setThreadActiveFlag: (_thread, flag, active) => (active ? flags.add(flag) : flags.delete(flag)),
    emitChatUpdated: () => {},
    getCachedChatDetail: () => snapshot()
  })
  const snapshot = () => ({
    id: 'fixture',
    revision: 1,
    items: [],
    status: flags.has('waitingOnApproval')
      ? 'waitingOnApproval'
      : flags.has('waitingOnUserInput')
        ? 'waitingOnUserInput'
        : null,
    pendingApproval: adapter.getProviderPendingApproval('fixture'),
    pendingUserInput: adapter.getProviderPendingUserInput('fixture'),
    sent: JSON.parse(JSON.stringify(sent))
  })
  return { adapter, sent, snapshot }
}
