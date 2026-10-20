import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { build } from 'esbuild'
import { encodeChatArchive, decodeChatArchive } from './ChatArchive.ts'
import { providerIpcChannels as channels } from '../../shared/provider.ts'

const require = createRequire(import.meta.url)
const workerDirectory = await mkdtemp(join(tmpdir(), 'sele-archive-workers-'))
process.on('exit', () => require('node:fs').rmSync(workerDirectory, { recursive: true, force: true }))
const bundled = await build({
  entryPoints: [new URL('./ChatArchiveIpc.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    require('../../../scripts/tests/helpers/node-workers.cjs')(workerDirectory),
    {
      name: 'isolate-archive-dialogs',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(electron|\.\/providerService|\.\.\/logging|\.\.\/database\/chat|\.\.\/hostProcess)$/
          },
          (args) => ({ path: args.path, namespace: 'test' })
        )
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents:
            path === 'electron'
              ? `export const app = {getPath: () => harness.directory}; export const BrowserWindow = {fromWebContents: () => null}; export const dialog = {showOpenDialog: async options => { harness.dialogs.push(options); return harness.nextDialog }};`
              : path.endsWith('logging')
                ? `export const handleLoggedIpc = (channel, handler) => harness.handlers.set(channel, handler);`
                : path.endsWith('/chat')
                  ? `export const getChatMetadata = async () => ({container:null}); export const setChatContainer = async (id, container) => {harness.savedContainer = container};`
                  : path.endsWith('hostProcess')
                    ? `export const isRunningInFlatpak = () => false; export const getHostCommand = async (file,args,options) => {harness.commands.push({file,args,container:options.container}); return {file,args,cwd:harness.directory,env:{...process.env,HOME:harness.directory}}};`
                    : `export const importedConversations = {archive: (...args) => harness.archive(...args), importArchive: (...args) => harness.importArchive(...args)}; export const providerApi = {getChat: (...args) => harness.getChat(...args), getModels: async (_provider, options) => { harness.modelContainer = options.container; return [{id:'fixture',isDefault:true}] }}; export const getChatUpdateSummary = detail => detail;`
        }))
      }
    }
  ]
})
const fixture = () => ({
  format: 'sele-chat',
  version: 1,
  exportedAt: 1234,
  providerId: 'codex',
  chat: {
    id: 'source',
    title: 'Portable',
    createdAt: 1234,
    cwd: null,
    items: [
      { id: 'user', type: 'message', role: 'user', content: 'Hello' },
      { id: 'answer', type: 'message', role: 'assistant', content: 'World' }
    ]
  },
  subagents: [],
  assets: []
})
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-archive-ipc-'))
  const harness = {
    directory,
    commands: [],
    handlers: new Map(),
    dialogs: [],
    nextDialog: { canceled: true, filePaths: [] },
    archive: async () => fixture(),
    getChat: async () => fixture().chat,
    importArchive: async (_archive, providerId, options) => ({
      ...fixture().chat,
      id: `${providerId}-imported`,
      cwd: options.cwd,
      container: options.container
    })
  }
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    require,
    module,
    exports: module.exports,
    harness,
    Buffer,
    structuredClone,
    console,
    process
  })
  module.exports.registerChatArchiveIpc()
  const sender = new EventEmitter()
  const invoke = (channel, ...args) => harness.handlers.get(channel)({ sender }, ...args)
  const file = join(directory, 'sample.sele')
  await writeFile(file, await encodeChatArchive(fixture()))
  const open = async () => {
    harness.nextDialog = { canceled: false, filePaths: [file] }
    return invoke(channels.openChatImport)
  }
  return { harness, directory, sender, invoke, open }
}

test('archive IPC exports only to a user-selected directory and previews a selected .sele file', async () => {
  const h = await setup()
  try {
    assert.equal(await h.invoke(channels.exportChat, 'codex', 'source'), null)
    h.harness.nextDialog = { canceled: false, filePaths: [h.directory] }
    const path = await h.invoke(channels.exportChat, 'codex', 'source')
    assert.ok(path.endsWith('.sele'))
    assert.deepEqual(
      (await decodeChatArchive(await readFile(path))).chat.items,
      fixture().chat.items
    )
    assert.deepEqual(Array.from(h.harness.dialogs[0].properties), [
      'openDirectory',
      'createDirectory'
    ])
    const preview = await h.open()
    assert.equal(preview.title, 'Portable')
    assert.equal(preview.turnCount, 1)
    assert.equal(preview.providerId, 'codex')
    assert.deepEqual(Array.from(h.harness.dialogs.at(-1).filters[0].extensions), ['sele'])
    await assert.rejects(h.invoke(channels.importChat, preview.id, 'unknown'), /Invalid provider/)
    await assert.rejects(
      h.invoke(channels.importChat, 'someone-elses-preview', 'claude'),
      /no longer available/
    )
    const result = await h.invoke(channels.importChat, preview.id, 'claude')
    assert.equal(result.id, 'claude-imported')
    assert.ok(result.cwd.startsWith(join(h.directory, 'imports')))
    await assert.rejects(h.invoke(channels.importChat, preview.id, 'claude'), /no longer available/)
  } finally {
    await rm(h.directory, { recursive: true, force: true })
  }
})

test('cancelled imports do not open, failure permits retry, and malformed archives are rejected before provider calls', async () => {
  const h = await setup()
  try {
    let release
    h.harness.importArchive = async (_archive, _provider, _options, cancelled) => {
      await new Promise((resolve) => {
        release = resolve
      })
      return cancelled() ? null : { id: 'unexpected' }
    }
    const preview = await h.open()
    const importing = h.invoke(channels.importChat, preview.id, 'opencode')
    while (!release) await new Promise((resolve) => setImmediate(resolve))
    await assert.rejects(
      h.invoke(channels.importChat, preview.id, 'copilot'),
      /no longer available/
    )
    await h.invoke(channels.cancelChatImport, preview.id)
    release()
    assert.equal(await importing, null)
    assert.deepEqual(await readdir(join(h.directory, 'imports')), [])
    const retryPreview = await h.open()
    h.harness.importArchive = async () => {
      throw new Error('Fixture provider failure')
    }
    await assert.rejects(
      h.invoke(channels.importChat, retryPreview.id, 'claude'),
      /provider failure/
    )
    h.harness.importArchive = async () => ({ ...fixture().chat, id: 'retry-success' })
    assert.equal(
      (await h.invoke(channels.importChat, retryPreview.id, 'copilot')).id,
      'retry-success'
    )
    await writeFile(join(h.directory, 'sample.sele'), 'broken archive')
    await assert.rejects(h.open(), /valid .sele/)
  } finally {
    await rm(h.directory, { recursive: true, force: true })
  }
})

test('selected container and SSH runtime own models, workspace, attachments, metadata and cancellation cleanup', async () => {
  for (const target of [
    { kind: 'container', tool: 'podman', name: 'dev' },
    {
      kind: 'container',
      tool: 'ssh',
      name: 'remote',
      runtime: { kind: 'container', tool: 'docker', name: 'runtime' }
    }
  ]) {
    const h = await setup()
    try {
      const source = fixture()
      source.chat.items[0].attachments = [
        { kind: 'file', name: 'file', path: '/original/file.txt' }
      ]
      source.assets = [
        { path: '/original/file.txt', data: Buffer.from('exact remote bytes').toString('base64') }
      ]
      await writeFile(join(h.directory, 'sample.sele'), await encodeChatArchive(source))
      const preview = await h.open()
      let importedOptions
      h.harness.importArchive = async (archive, _provider, options) => {
        importedOptions = options
        const path = archive.chat.items[0].attachments[0].path
        assert.ok(path.startsWith(options.cwd + '/attachments/'))
        assert.equal(await readFile(path, 'utf8'), 'exact remote bytes')
        return {
          ...fixture().chat,
          id: 'remote-chat',
          cwd: options.cwd,
          container: options.container
        }
      }
      const result = await h.invoke(channels.importChat, preview.id, 'claude', target)
      assert.deepEqual(JSON.parse(JSON.stringify(importedOptions.container)), target)
      assert.deepEqual(JSON.parse(JSON.stringify(h.harness.modelContainer)), target)
      assert.deepEqual(JSON.parse(JSON.stringify(h.harness.savedContainer)), target)
      assert.ok(result.cwd.startsWith(join(h.directory, '.local/share/sele/imports/')))
      assert.ok(
        h.harness.commands.every(
          (command) => JSON.stringify(command.container) === JSON.stringify(target)
        )
      )
      const cancelling = await h.open()
      h.harness.importArchive = async (_archive, _provider, _options, cancelled) => {
        await h.invoke(channels.cancelChatImport, cancelling.id)
        assert.equal(cancelled(), true)
        return null
      }
      assert.equal(await h.invoke(channels.importChat, cancelling.id, 'claude', target), null)
      assert.deepEqual(await readdir(join(h.directory, '.local/share/sele/imports')), [preview.id])
    } finally {
      await rm(h.directory, { recursive: true, force: true })
    }
  }
})
