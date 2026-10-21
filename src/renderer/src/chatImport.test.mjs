import { isNoProjectChat, isNoProjectCwd } from '../../shared/noProject.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real workspace declarations without mounting providers or starting a desktop app.
const declaration = (path, name) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let expression
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Found ${name}`)
  return ts.transpileModule(`globalThis.result = ${expression}`, {
    fileName: 'fixture.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText
}

test('import workspaces never become project choices alongside real projects', () => {
  const context = vm.createContext({
    useMemo: (fn) => fn(),
    chats: [
      { cwd: '/repo', createdAt: 1 },
      { cwd: '/home/user', noProject: true, createdAt: 2 },
      ...Array.from({ length: 40 }, (_, i) => ({
        cwd: `/sele/imports/${i}`,
        projectCwd: `/sele/imports/${i}`,
        imported: {},
        done: i % 2 === 0,
        createdAt: i + 10
      }))
    ],
    projects: [{ cwd: '/saved', name: 'Saved project' }],
    newSessionCwd: '/new-project',
    newSessionNoProject: false,
    newSessionNoProjectValue: '__no_project__',
    isNoProjectCwd,
    MessageSquare: 'chat-icon',
    getChatProjectCwd: (chat) => (isNoProjectChat(chat) ? null : (chat.projectCwd ?? chat.cwd)),
    getChatCwdGroupKey: (cwd) => cwd,
    getFolderName: (cwd) => cwd,
    getFolderDescription: (cwd) => cwd,
    getProjectDisplayName: (project) => project.name,
    projectIconsByGroup: {},
    renderProjectGlyph: () => null,
    FolderKanban: 'icon',
    React: { createElement: () => null }
  })
  vm.runInContext(declaration('./useWorkspaceController.tsx', 'projectOptions'), context)
  assert.equal(context.result[0].value, '__no_project__')
  assert.deepEqual(Array.from(context.result.slice(1), (option) => option.value).sort(), [
    '/new-project',
    '/repo',
    '/saved'
  ])
})

test('marking an imported chat done preserves the regular new-chat project', async () => {
  const selected = { id: 'imported', providerId: 'claude', cwd: '/sele/imports/id', imported: {} }
  const opened = []
  const context = vm.createContext({
    providerApi: { markChatDone: async () => ({ done: true }) },
    applyChatMetadata: () => {},
    updateStoredComposerDrafts: () => {},
    removeRecentChatCacheEntry: () => {},
    selectedChat: selected,
    chatDetail: selected,
    showNewChatView: (...args) => opened.push(args),
    getChatProjectCwd: (chat) => chat.cwd,
    newSessionContainer: { kind: 'host' },
    console
  })
  vm.runInContext(
    declaration('./workspace/useChatListController.tsx', 'handleMarkChatDone'),
    context
  )
  await context.result(selected)
  assert.equal(opened.length, 1)
  assert.equal(opened[0][0], undefined)
})
