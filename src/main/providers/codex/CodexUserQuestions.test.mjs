import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { CodexUserQuestions } from './CodexUserQuestions.ts'
import { updateIndexedTranscriptRecord } from '../transcriptProjection/recordChanges.ts'

const answer = (text) => ({ kind: 'answer', answer: text, wasFreeform: true })
const question = (id, extra = {}) => ({
  id,
  question: `Choose ${id}`,
  isOther: true,
  options: [{ label: 'One', description: 'First option' }],
  ...extra
})
const serverRequest = (id = 1, questions = [question('account')], extra = {}) => ({
  id,
  method: 'item/tool/requestUserInput',
  params: { threadId: 'chat', turnId: 'turn', itemId: 'tool', questions, ...extra }
})
const asyncTurn = (extra = []) => ({
  id: 'turn',
  status: 'inProgress',
  items: [
    { type: 'userMessage', id: 'prompt' },
    {
      type: 'agentMessage',
      id: 'questions',
      questions: [
        { title: 'Which integration?', options: ['Integration #1', 'Integration #3'] },
        { title: 'Which date?', options: null }
      ]
    },
    ...extra
  ]
})

test('async structured choices are answerable without blocking the active turn', async () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', asyncTurn())
  const first = questions.getPending('chat')
  assert.equal(first.question, 'Which integration?')
  assert.deepEqual(
    first.choices.map((choice) => choice.label),
    ['Integration #1', 'Integration #3']
  )
  assert.equal(first.isBlocking, false)
  assert.equal(questions.hasBlocking('chat'), false)
  const sent = []
  await questions.resolve('chat', first.id, answer('Integration #3'), {
    server: () => assert.fail('async questions must use steering'),
    asynchronous: async (request, text) => {
      sent.push([request.question, text])
      questions.syncAsync('chat', asyncTurn([{ type: 'userMessage', id: 'reply' }]))
    }
  })
  questions.syncAsync('chat', asyncTurn())
  assert.deepEqual(sent, [['Which integration?', 'Integration #3']])
  assert.equal(questions.getPending('chat').question, 'Which date?')
  await questions.resolve(
    'chat',
    questions.getPending('chat').id,
    { kind: 'cancel' },
    {
      server: () => assert.fail(),
      asynchronous: () => assert.fail('dismissal must not interrupt or send a message')
    }
  )
  questions.syncAsync('chat', asyncTurn())
  assert.equal(questions.getPending('chat'), null)
})

test('history recovery ignores questions followed by an ordinary user reply and earlier turns', () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', asyncTurn([{ type: 'userMessage', id: 'reply' }]))
  assert.equal(questions.getPending('chat'), null)
  questions.syncAsync('chat', { ...asyncTurn(), id: 'new-turn' })
  assert.ok(questions.getPending('chat'))
  questions.syncAsync('chat', { id: 'next-turn', items: [] })
  assert.equal(questions.getPending('chat'), null)
})

test('an ordinary live reply dismisses old questions', () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', asyncTurn())
  questions.syncAsync('chat', asyncTurn([{ type: 'userMessage', id: 'reply' }]))
  assert.equal(questions.getPending('chat'), null)
})

test('answering after completion keeps remaining questions when a new turn starts', async () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', { ...asyncTurn(), status: 'completed' })
  await questions.resolve('chat', questions.getPending('chat').id, answer('Integration #3'), {
    server: () => assert.fail(),
    asynchronous: async () => {
      questions.syncAsync('chat', { id: 'new-turn', items: [{ type: 'userMessage', id: 'reply' }] })
    }
  })
  assert.equal(questions.getPending('chat').question, 'Which date?')
})

test('a late answer message after acknowledgment preserves the remaining questions', async () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', asyncTurn())
  await questions.resolve('chat', questions.getPending('chat').id, answer('Integration #3'), {
    server: () => assert.fail(),
    asynchronous: async () => {}
  })
  questions.syncAsync(
    'chat',
    asyncTurn([
      {
        type: 'userMessage',
        id: 'reply',
        content: [{ type: 'text', text: 'Which integration?\n\nAnswer: Integration #3' }]
      }
    ])
  )
  assert.equal(questions.getPending('chat').question, 'Which date?')
})

test('streaming updates only inspect the changed suffix of a long turn', () => {
  const questions = new CodexUserQuestions()
  let reads = 0
  const items = Array.from({ length: 10000 }, (_, index) => ({
    id: `item-${index}`,
    get type() {
      reads += 1
      return 'commandExecution'
    }
  }))
  questions.syncAsync('chat', { id: 'turn', items })
  reads = 0
  questions.syncAsync('chat', { id: 'turn', items })
  assert.equal(reads, 0)
  const next = updateIndexedTranscriptRecord(items, 'item-9999', (item) => ({
    ...item,
    text: 'delta'
  }))
  reads = 0
  questions.syncAsync('chat', { id: 'turn', items: next })
  assert.equal(reads, 0, 'unchanged history must not be revisited')
})

test('all blocking answers are returned together with original question ids to the originating client', async () => {
  const questions = new CodexUserQuestions()
  const container = { kind: 'container', name: 'dev' }
  questions.addServerRequest(
    serverRequest(7, [question('account'), question('secret', { isSecret: true })]),
    container
  )
  const responses = []
  const handlers = {
    server: (request, result) => responses.push([request.requestId, request.container, result]),
    asynchronous: () => assert.fail()
  }
  assert.equal(questions.hasBlocking('chat'), true)
  const firstId = questions.getPending('chat').id
  await questions.resolve('chat', firstId, answer('One'), handlers)
  assert.equal(responses.length, 0)
  assert.equal(questions.getPending('chat').isSecret, true)
  await assert.rejects(
    questions.resolve('chat', firstId, answer('stale'), handlers),
    /no longer pending/
  )
  await questions.resolve('chat', questions.getPending('chat').id, answer('custom'), handlers)
  assert.deepEqual(responses, [
    [7, container, { answers: { account: { answers: ['One'] }, secret: { answers: ['custom'] } } }]
  ])
  assert.equal(questions.getPending('chat'), null)
  assert.equal(questions.hasBlocking('chat'), false)
})

test('failed answer delivery preserves the question for retry and rejects duplicate submissions', async () => {
  const questions = new CodexUserQuestions()
  questions.syncAsync('chat', asyncTurn())
  const id = questions.getPending('chat').id
  let failDelivery
  const delivery = new Promise((_resolve, reject) => {
    failDelivery = reject
  })
  const handlers = { server: () => assert.fail(), asynchronous: () => delivery }
  const first = questions.resolve('chat', id, answer('One'), handlers)
  await assert.rejects(
    questions.resolve('chat', id, answer('Two'), handlers),
    /already being submitted/
  )
  failDelivery(new Error('Connection lost'))
  await assert.rejects(first, /Connection lost/)
  assert.equal(questions.getPending('chat').id, id)
  questions.addServerRequest(serverRequest(), null)
  const serverId = questions.getPending('chat').id
  await assert.rejects(
    questions.resolve('chat', serverId, answer('One'), {
      ...handlers,
      server: () => {
        throw new Error('Not writable')
      }
    }),
    /Not writable/
  )
  assert.equal(questions.getPending('chat').id, serverId)
})

test('external resolution, cancellation, turn completion and process exit clear matching server questions', async () => {
  const questions = new CodexUserQuestions()
  questions.addServerRequest(serverRequest(1), null)
  questions.addServerRequest(serverRequest(2, [question('other')], { turnId: 'next' }), null)
  assert.equal(
    questions.removeResolved(1, (container) => container !== null),
    null
  )
  assert.equal(
    questions.removeResolved(1, (container) => container === null),
    'chat'
  )
  questions.clearServerTurn('chat', 'turn')
  assert.ok(questions.getPending('chat'))
  questions.clearServerTurn('chat', 'next')
  assert.equal(questions.getPending('chat'), null)
  questions.addServerRequest(serverRequest(), null)
  await questions.resolve(
    'chat',
    questions.getPending('chat').id,
    { kind: 'cancel' },
    {
      server: (_request, result) => assert.deepEqual(result, { answers: {} }),
      asynchronous: () => assert.fail()
    }
  )
  questions.addServerRequest(serverRequest(), null)
  assert.deepEqual(
    questions.removeContainer((container) => container === null),
    ['chat']
  )
  assert.equal(questions.getPending('chat'), null)
})

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const methods = declaration.members.filter((node) =>
  [
    'resolveUserInput',
    'getProviderPendingUserInput',
    'handleServerRequest',
    'startCodexTurn'
  ].includes(node.name?.getText(source))
)
const adapterCode = ts.transpile(
  `class Adapter { ${methods.map((method) => method.getText(source)).join('\n')} }; new Adapter()`,
  { target: ts.ScriptTarget.ES2022 }
)

const turnOptions = {
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
  sandboxMode: 'danger-full-access',
  model: 'gpt-6.1-sol',
  reasoningEffort: 'high',
  serviceTier: 'fast',
  cwd: '/project',
  additionalDirectories: ['/shared'],
  showRecommendedPlugins: true
}

test('the question UI submits current settings for async answers, including after reopening a chat', async () => {
  const rendererSource = ts.createSourceFile(
    'controller.tsx',
    readFileSync(
      new URL('../../../renderer/src/workspace/useChatMessagingController.tsx', import.meta.url),
      'utf8'
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let handler
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(rendererSource) === 'resolveSelectedUserInput'
    )
      handler = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(rendererSource)
  assert.ok(handler)
  for (const [isBlocking, response] of [
    [false, answer('Continue Login')],
    [true, answer('Continue Login')],
    [false, { kind: 'cancel' }]
  ]) {
    const calls = []
    const submit = vm.runInNewContext(
      ts.transpile(`(${handler.getText(rendererSource)})`, { target: ts.ScriptTarget.ES2022 }),
      {
        selectedChat: { id: 'chat', providerId: 'codex' },
        pendingUserInput: { id: 'question', isBlocking },
        userInputResolving: false,
        providerUpdateInProgress: false,
        getCurrentTurnOptions: () => turnOptions,
        setUserInputResolution: () => {},
        applyViewedChatDetail: () => {},
        providerApi: { resolveUserInput: async (...args) => calls.push(args) }
      }
    )
    await submit(response)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][4], !isBlocking && response.kind === 'answer' ? turnOptions : undefined)
  }
})

for (const active of [true, false]) {
  test(`the actual adapter sends an async answer through ${active ? 'steering' : 'a new turn'}`, async () => {
    const adapter = vm.runInNewContext(adapterCode)
    const sent = []
    Object.assign(adapter, {
      userQuestions: new CodexUserQuestions(),
      threads: new Map([['chat', { turns: [asyncTurn()] }]]),
      getThreadContainer: () => null,
      runWithContainer: (_container, work) => work(),
      hasActiveOrSubmittingTurn: () => active,
      steerActiveChat: async (_chat, text, options) => sent.push(['steer', text, options]),
      continueChatImmediately: async (_chat, text, options) => sent.push(['start', text, options]),
      setThreadActiveFlag: () => {},
      emitChatUpdated: () => {},
      getCachedChatDetail: () => ({ id: 'chat' })
    })
    const pending = adapter.getProviderPendingUserInput('chat')
    await adapter.resolveUserInput('chat', pending.id, answer('Integration #3'), turnOptions)
    assert.deepEqual(sent, [
      [active ? 'steer' : 'start', 'Which integration?\n\nAnswer: Integration #3', turnOptions]
    ])
    assert.equal(adapter.getProviderPendingUserInput('chat').question, 'Which date?')
  })
}

test('an answer after completion starts Codex with the selected permissions and model', async () => {
  const helperNames = [
    'getApprovalPolicy',
    'getApprovalsReviewer',
    'getSandboxMode',
    'getRuntimeWorkspaceRoots',
    'getTurnModelOptions',
    'getTurnAccessOptions'
  ]
  const helpers = source.statements.filter(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((entry) =>
        helperNames.includes(entry.name.getText(source))
      )
  )
  const adapter = vm.runInNewContext(
    ts.transpile(`${helpers.map((node) => node.getText(source)).join('\n')}\n${adapterCode}`, {
      target: ts.ScriptTarget.ES2022
    }),
    { createUserInput: (text) => [{ type: 'text', text }] }
  )
  const requests = []
  Object.assign(adapter, {
    userQuestions: new CodexUserQuestions(),
    threads: new Map([
      ['chat', { cwd: '/project', turns: [{ ...asyncTurn(), status: 'completed' }] }]
    ]),
    getThreadContainer: () => null,
    runWithContainer: (_container, work) => work(),
    hasActiveOrSubmittingTurn: () => false,
    continueChatImmediately: (chat, text, options) =>
      adapter.startCodexTurn(chat, text, options, 'submitted-answer'),
    startSubmittedCodexTurn: (_chat, _pending, start) => start(),
    resumeThread: async (_chat, options) => assert.equal(options, turnOptions),
    client: { request: async (method, params) => requests.push({ method, params }) },
    setThreadActiveFlag: () => {},
    emitChatUpdated: () => {},
    getCachedChatDetail: () => ({ id: 'chat' })
  })
  await adapter.resolveUserInput(
    'chat',
    adapter.getProviderPendingUserInput('chat').id,
    answer('Integration #3'),
    turnOptions
  )
  assert.equal(requests.length, 1)
  const { method, params } = requests[0]
  assert.equal(method, 'turn/start')
  assert.equal(params.approvalPolicy, 'never')
  assert.equal(params.sandboxPolicy.type, 'dangerFullAccess')
  assert.equal(params.model, 'gpt-6.1-sol')
  assert.equal(params.effort, 'high')
  assert.equal(params.serviceTier, 'fast')
  assert.deepEqual(Array.from(params.runtimeWorkspaceRoots), ['/project', '/shared'])
})

test('the actual adapter handles and answers the Codex server request without stopping its turn', async () => {
  const adapter = vm.runInNewContext(adapterCode)
  const container = { kind: 'container', name: 'dev' }
  const replies = []
  const flags = []
  Object.assign(adapter, {
    userQuestions: new CodexUserQuestions(),
    threads: new Map(),
    getCurrentContainer: () => container,
    rememberThreadContainer: (threadId, actual) => {
      assert.equal(threadId, 'chat')
      assert.equal(actual, container)
    },
    getClient: (actual) => {
      assert.equal(actual, container)
      return { resolveServerRequest: (id, result) => replies.push([id, result]) }
    },
    setThreadActiveFlag: (...args) => flags.push(args),
    emitChatUpdated: () => {},
    getCachedChatDetail: () => ({ id: 'chat' })
  })
  assert.equal(adapter.handleServerRequest(serverRequest(3)), true)
  const pending = adapter.getProviderPendingUserInput('chat')
  await adapter.resolveUserInput('chat', pending.id, answer('One'))
  assert.deepEqual(replies, [[3, { answers: { account: { answers: ['One'] } } }]])
  assert.deepEqual(flags, [
    ['chat', 'waitingOnUserInput', true],
    ['chat', 'waitingOnUserInput', false]
  ])
})
