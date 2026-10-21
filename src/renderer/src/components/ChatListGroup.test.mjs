import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = ts.createSourceFile(
  'ChatListGroup.tsx',
  readFileSync(new URL('./ChatListGroup.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declaration = source.statements
  .flatMap((node) => (ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []))
  .find((node) => node.name.getText(source) === 'areChatListGroupPropsEqual')
const compare = new Function(
  ts.transpile(`return (${declaration.initializer.getText(source)})`, {
    target: ts.ScriptTarget.ES2022
  })
)()
const chat = { providerId: 'claude', id: 'one', cwd: '/repo', title: 'One' }
const props = () => ({
  group: { key: 'cwd:/repo', cwd: '/repo', kind: 'cwd', label: 'repo', chats: [chat] },
  contentId: 'repo',
  open: true,
  selectedChatKey: null,
  onMarkChatDone() {},
  workingSubagentChatKeys: new Set(),
  committingChatKeys: new Set(),
  latestCommitFinishedAtByChatKey: new Map(),
  projectNamesByCwd: new Map([['/repo', 'Repo']]),
  projectIconsByCwd: new Map([['/repo', 'icon']])
})

test('regrouping another project keeps this group memoized', () => {
  const before = props()
  const after = { ...before, group: { ...before.group, chats: [...before.group.chats] } }
  assert.equal(compare(before, after), true)
  assert.equal(
    compare(before, { ...after, group: { ...after.group, chats: [{ ...chat, done: true }] } }),
    false
  )
  assert.equal(
    compare(before, { ...after, group: { ...after.group, projectName: 'Renamed' } }),
    false
  )
})

test('updates to another project’s indicators or icons do not rebuild this list', () => {
  const before = props()
  const after = {
    ...before,
    workingSubagentChatKeys: new Set(['claude:other']),
    committingChatKeys: new Set(['claude:other']),
    latestCommitFinishedAtByChatKey: new Map([['claude:other', 100]]),
    projectNamesByCwd: new Map([...before.projectNamesByCwd, ['/other', 'Other']]),
    projectIconsByCwd: new Map([...before.projectIconsByCwd, ['/other', 'changed']])
  }
  assert.equal(compare(before, after), true)
  for (const [property, value] of [
    ['workingSubagentChatKeys', new Set(['claude:one'])],
    ['committingChatKeys', new Set(['claude:one'])],
    ['latestCommitFinishedAtByChatKey', new Map([['claude:one', 100]])],
    ['projectNamesByCwd', new Map([['/repo', 'New name']])],
    ['projectIconsByCwd', new Map([['/repo', 'new icon']])]
  ])
    assert.equal(compare(before, { ...after, [property]: value }), false, property)
})

test('selection, subagents, approvals, pagination and handlers remain live', () => {
  const before = props()
  for (const [property, value] of [
    ['selectedChatKey', 'claude:one'],
    ['selectedChatChildren', {}],
    ['selectedChatChildOpen', true],
    ['resolvingApprovalId', 'approval'],
    ['visibleChatCount', 100],
    ['open', false],
    ['onMarkChatDone', () => {}]
  ])
    assert.equal(compare(before, { ...before, [property]: value }), false, property)
  assert.equal(compare({ ...before, workingSubagentChatKeys: undefined }, before), true)
})
