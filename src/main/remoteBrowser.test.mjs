import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
const fixture = { clients: [], actions: [] }
globalThis.remoteBrowserFixture = fixture
const compiled = await build({
  entryPoints: ['src/main/remoteBrowser.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  packages: 'external',
  plugins: [
    {
      name: 'no-gui',
      setup(builder) {
        builder.onResolve({ filter: /^electron$|\/BrowserAutomation$/ }, (args) => ({
          path: args.path === 'electron' ? 'electron' : 'browser',
          namespace: 'fixture'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'electron'
              ? `export const webContents={fromId:id=>globalThis.remoteBrowserFixture.guests.get(id)}`
              : `
      export const getBrowserAutomationService=()=>({createClient:scope=>{
        const entry={scope,closed:false,close(){this.closed=true},async listTabs(){if(this.closed)throw Error('Closed');return [{id:7,title:'Fixture',url:'http://127.0.0.1/',active:true}]},async createTab(){fixture.actions.push('create')},async activateTab(id){fixture.actions.push('activate:'+id)},async closeTab(id){fixture.actions.push('close:'+id)},async executeCdp(id,method,params){fixture.actions.push({id,method,...params})}};
        fixture.clients.push(entry);return entry;
      }});const fixture=globalThis.remoteBrowserFixture;
    `
        }))
      }
    }
  ]
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports
)
const { remoteBrowserRequest } = module.exports
let clientId = -9000
const makeClient = () => {
  const events = new EventEmitter()
  let destroyed = false
  return {
    id: clientId--,
    isDestroyed: () => destroyed,
    once: (event, fn) => events.once(event, fn),
    destroy() {
      destroyed = true
      events.emit('destroyed')
    },
    listeners: () => events.listenerCount('destroyed')
  }
}
fixture.guests = new Map([
  [
    7,
    {
      isDestroyed: () => false,
      getType: () => 'webview',
      async capturePage() {
        fixture.captures=(fixture.captures||0)+1
        return {
          getSize: () => ({ width: 1600, height: 1000 }),
          resize: () => ({ toJPEG: () => Buffer.from('preview') })
        }
      },
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => false,
        goBack: () => fixture.actions.push('back'),
        goForward: () => {}
      },
      loadURL: async (url) => fixture.actions.push('navigate:' + url),
      reload: () => fixture.actions.push('reload'),
      insertText: (text) => fixture.actions.push('text:' + text),
      sendInputEvent: (event) => fixture.actions.push(event)
    }
  ]
])
const request = (client, values) =>
  remoteBrowserRequest(client, {
    workspaceKey: 'project:host\0/project',
    cwd: '/project',
    method: 'state',
    ...values
  })

test('phone browser scopes previews to selected workspace and bounds frame size', async () => {
  const client = makeClient()
  const value = await request(client, {})
  assert.equal(value.tabs[0].id, 7)
  assert.equal(value.frame.width, 1600)
  assert.match(value.frame.dataUrl, /^data:image\/jpeg;base64,/)
  const scope = fixture.clients.at(-1).scope
  assert.equal(scope.cwd, '/project')
  assert.equal(scope.workspaceKey, 'project:host\0/project')
  client.destroy()
  assert.equal(fixture.clients.at(-1).closed, true)
  await assert.rejects(async () => request(client, {}), /disconnected/)
})

test('rejects cross-workspace tabs, executable URL schemes, invalid input and arbitrary commands', async () => {
  const client = makeClient()
  for (const value of [
    { method: 'click', tabId: 8, x: 1, y: 1 },
    { method: 'navigate', url: 'javascript:alert(1)' },
    { method: 'click', x: NaN, y: 1 },
    { method: 'scroll', deltaY: 3, x: Infinity },
    { method: 'text', text: 'x'.repeat(4097) },
    { method: 'key', key: 'OpenDevTools' },
    { method: 'Runtime.evaluate', expression: 'process.exit()' }
  ])
    await assert.rejects(async () => request(client, value))
  client.destroy()
})

test('workspace changes retain one lifetime listener and stale cleanup cannot revoke a newer view', async () => {
  const client = makeClient()
  await request(client, {})
  const old = fixture.clients.at(-1)
  await request(client, { workspaceKey: 'project:host\0/other', cwd: '/other' })
  const current = fixture.clients.at(-1)
  assert.equal(old.closed, true)
  assert.equal(client.listeners(), 1)
  await request(client, { method: 'release' })
  assert.equal(current.closed, false)
  await request(client, { method: 'release', workspaceKey: 'project:host\0/other', cwd: '/other' })
  assert.equal(current.closed, true)
  client.destroy()
})

test('serializes user mutations with frame reads and never replays an action', async () => {
  const client = makeClient()
  const start = fixture.actions.length
  await Promise.all([
    request(client, { method: 'navigate', url: 'http://127.0.0.1/page' }),
    request(client, { method: 'text', text: 'phone text' }),
    request(client, { method: 'key', key: 'Enter' })
  ])
  const actions = fixture.actions.slice(start)
  assert.equal(actions[0], 'navigate:http://127.0.0.1/page')
  assert.equal(actions[1].method, 'Input.insertText')
  assert.equal(actions[1].text, 'phone text')
  assert.equal(actions[2].method, 'Input.dispatchKeyEvent')
  assert.equal(actions[2].type, 'keyDown')
  assert.equal(actions[2].windowsVirtualKeyCode, 13)
  assert.equal(actions[2].text, '\r')
  assert.equal(actions[3].type, 'keyUp')
  assert.equal(actions.length, 4)
  client.destroy()
})

test('cleanup from a replaced component cannot close the current view of the same workspace', async () => {
  const client = makeClient()
  await request(client, { viewId: 'old' })
  const previous = fixture.clients.at(-1)
  await request(client, { viewId: 'new' })
  const current = fixture.clients.at(-1)
  assert.equal(previous.closed, true)
  await request(client, { viewId: 'old', method: 'release' })
  assert.equal(current.closed, false)
  await request(client, { viewId: 'new' })
  client.destroy()
})

 test('desktop tab transfer is metadata only and never captures a frame', async()=>{const client=makeClient();const before=fixture.captures||0;const state=await request(client,{method:'tabs'});assert.equal(state.tabs[0].url,'http://127.0.0.1/');assert.equal(state.frame,undefined);assert.equal(fixture.captures||0,before);client.destroy()})
