import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { isNoProjectChat, isNoProjectCwd, noProjectGroupKey } from '../../shared/noProject.ts'
import {
  sortChatsForSidebarSection,
  sortDoneChats,
  sortProjectGroupsForSidebar
} from './chatSidebarOrder.ts'

const source = (file) =>
  ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
const controller = source('./useWorkspaceController.tsx')
const utils = source('./workspace/chatControllerUtils.tsx')
const expression = (file, name, context) => {
  let initializer
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      initializer = node.initializer.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, `Found ${name}`)
  return vm.runInContext(
    ts.transpile(`(${initializer})`, {
      target: ts.ScriptTarget.ES2022
    }),
    context
  )
}

test('a delayed default folder cannot replace an explicit No Project or project selection', () => {
  let selection = null
  const context = vm.createContext({
    useCallback: (fn) => fn,
    isNoProjectCwd,
    newSessionNoProjectValue: '__no_project__',
    setNewSessionProjectSelection: (update) => {
      selection = update(selection)
    }
  })
  const initialize = expression(controller, 'initializeNewSessionCwd', context)
  initialize('/default')
  assert.equal(selection, '/default')
  selection = '__no_project__'
  initialize('/last-project')
  assert.equal(selection, '__no_project__')
  selection = '/chosen-project'
  initialize('/last-project')
  assert.equal(selection, '/chosen-project')
})

test('general chats use Recents instead of Git or Files while keeping Terminal available', () => {
  const context = vm.createContext({ noProject: true, storedChangesPaneView: 'git' })
  for (const stored of ['git', 'files', 'recents', 'terminal', 'browser']) {
    context.storedChangesPaneView = stored
    assert.equal(
      expression(controller, 'changesPaneView', context),
      ['git', 'files'].includes(stored) ? 'recents' : stored
    )
  }
  context.noProject = false
  context.storedChangesPaneView = 'git'
  assert.equal(expression(controller, 'changesPaneView', context), 'git')
})

test('general chats stay in a dedicated Chats group even with stale project metadata', () => {
  const context = vm.createContext({
    isNoProjectChat,
    isNoProjectCwd,
    noProjectGroupKey,
    unknownCwdGroupKey: 'unknown',
    pinnedGroupKey: 'pinned',
    doneGroupKey: 'done',
    sortProjectGroupsForSidebar,
    sortDoneChats,
    sortChatsForGroup: sortChatsForSidebarSection
  })
  for (const name of [
    'getLastPathPart',
    'getChatCwdLabel',
    'getChatCwdGroupKey',
    'getChatProjectCwd',
    'getChatGroupKey'
  ])
    context[name] = expression(utils, name, context)
  const group = expression(utils, 'groupChatsForSidebar', context)
  const general = (id) => ({
    id,
    providerId: 'codex',
    createdAt: 1,
    cwd: `/data/sele-no-project/${id}`,
    projectCwd: '/last-project'
  })
  const groups = group(
    [
      general('00000000-0000-4000-8000-000000000001'),
      general('00000000-0000-4000-8000-000000000002'),
      { id: 'project', providerId: 'claude', cwd: '/last-project', createdAt: 2 },
      {
        id: 'home-chat',
        providerId: 'opencode',
        noProject: true,
        cwd: '/home/user',
        projectCwd: '/home/user',
        createdAt: 3
      },
      {
        id: 'home-project',
        providerId: 'opencode',
        cwd: '/home/user',
        projectCwd: '/home/user',
        createdAt: 4
      }
    ],
    new Map()
  )
  const chats = groups.find((entry) => entry.key === noProjectGroupKey)
  assert.equal(chats.label, 'Chats')
  assert.equal(chats.cwd, null)
  assert.equal(chats.chats.length, 3)
  assert.equal(groups.find((entry) => entry.cwd === '/last-project').chats.length, 1)
  assert.equal(groups.find((entry) => entry.cwd === '/home/user').chats[0].id, 'home-project')
  context.activeChatGroups = groups
  context.chatGroupingPreference = 'flat'
  context.activeGroupKey = 'active'
  context.generalChatGroups = [chats]
  context.projectChatGroups = groups.filter((entry) => entry !== chats)
  const displayed = expression(controller, 'displayedActiveChatGroups', context)
  assert.equal(displayed[0].key, noProjectGroupKey)
  assert.equal(displayed[1].chats.length, 2)
})

test('a saved No Project choice hides project controls for a HOME-backed chat', () => {
  const homeChat = { id: 'general', cwd: '/home/user', noProject: true }
  const context = vm.createContext({
    isNoProjectChat,
    selectedChat: homeChat,
    selectedChatDetail: { id: 'general', cwd: '/home/user' },
    newSessionNoProject: false
  })
  assert.equal(expression(controller, 'noProject', context), true)
  context.selectedChat = { id: 'project', cwd: '/home/user' }
  context.selectedChatDetail = null
  assert.equal(expression(controller, 'noProject', context), false)
})

test('detail, live summaries and metadata changes preserve the saved No Project flag', () => {
  const context = vm.createContext({
    getChatPreview: () => '',
    arePendingApprovalsEqual: (a, b) => a === b,
    areContainerTargetsEqual: (a, b) => a === b
  })
  const fromDetail = expression(utils, 'getChatFromDetail', context)
  const fromSummary = expression(utils, 'getChatFromUpdateSummary', context)
  const areEqual = expression(utils, 'areChatsEqual', context)
  const native = { id: 'general', cwd: '/home/user', noProject: true }
  const detailChat = fromDetail('opencode', native, null, 1)
  assert.equal(detailChat.noProject, true)
  assert.equal(
    fromDetail('opencode', { ...native, noProject: undefined }, detailChat, 2).noProject,
    true
  )
  const summaryChat = fromSummary('opencode', { ...detailChat, updatedAt: 3 }, detailChat, false)
  assert.equal(summaryChat.noProject, true)
  assert.equal(areEqual(summaryChat, { ...summaryChat, noProject: false }), false)
  const merge = expression(source('./chatMetadata.ts'), 'mergeChatMetadata', context)
  assert.equal(merge(detailChat, { ...detailChat, pinned: true }).noProject, true)
})
