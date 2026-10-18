const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const directory = path.join(root, 'tmp/mcp-apps-test')
if (!process.versions.electron) {
  ;(async () => {
    const { build } = require('esbuild')
    await fs.mkdir(directory, { recursive: true })
    const widget = await build({
      stdin: {
        contents: `import {App} from '@modelcontextprotocol/ext-apps';const app=new App({name:'Fixture',version:'1.0.0'},{});app.ontoolresult=result=>document.getElementById('value').textContent=result.content[0].text;document.getElementById('increment').onclick=async()=>{try{const result=await app.callServerTool({name:'increment',arguments:{delta:1}});document.getElementById('value').textContent=result.content[0].text}catch{document.getElementById('value').textContent='Canceled'}};app.connect();`,
        resolveDir: root
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      write: false
    })
    await fs.writeFile(
      path.join(directory, 'widget.html'),
      `<html><body><h2>Connector fixture</h2><p id="value">Loading</p><button id="increment">Increment</button><script>${widget.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
    )
    await build({
      stdin: {
        contents: `export {registerMcpApps} from './src/main/mcpApps/registerMcpApps'`,
        resolveDir: root
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      outfile: path.join(directory, 'host.cjs')
    })
    await build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {McpApp,McpAppScope} from './src/renderer/src/components/McpApp';import './src/renderer/src/assets/main.css';window.appApi={handleExternalLink:async()=>({action:'open',always:false})};createRoot(document.getElementById('root')).render(<McpAppScope value={{providerId:'copilot',chatId:'fixture'}}><McpApp callId="call"/></McpAppScope>);`,
        loader: 'tsx',
        resolveDir: root
      },
      bundle: true,
      platform: 'browser',
      jsx: 'automatic',
      outfile: path.join(directory, 'fixture.js')
    })
    await fs.writeFile(
      path.join(directory, 'index.html'),
      `<!doctype html><html data-color-scheme="dark"><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src sele-mcp-app:; script-src 'self'; style-src 'self' 'unsafe-inline'"><link rel="stylesheet" href="fixture.css"></head><body><div id="root" style="max-width:800px;margin:32px"></div><script src="fixture.js"></script></body></html>`
    )
    await fs.writeFile(
      path.join(directory, 'preload.cjs'),
      `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('mcpAppsApi',{open:(...args)=>ipcRenderer.invoke('mcp-apps:open',...args),request:(...args)=>ipcRenderer.invoke('mcp-apps:request',...args),close:(...args)=>ipcRenderer.invoke('mcp-apps:close',...args)});`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = require('node:child_process').spawn(
      require('electron'),
      [__filename, '--no-sandbox', '--ozone-platform=x11'],
      { cwd: root, env, stdio: 'inherit' }
    )
    child.on('exit', (code) => {
      process.exitCode = code ?? 1
    })
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, protocol } = require('electron')
  app.setPath('userData', path.join(directory, 'profile'))
  protocol.registerSchemesAsPrivileged([
    { scheme: 'sele-mcp-app', privileges: { standard: true, secure: true } }
  ])
  app
    .whenReady()
    .then(async () => {
      let value = 7,
        calls = 0
      const html = await fs.readFile(path.join(directory, 'widget.html'), 'utf8')
      require(path.join(directory, 'host.cjs')).registerMcpApps(async (scope) => {
        assert.equal(scope.chatId, 'fixture')
        return {
          serverName: 'Fixture connector',
          resourceUri: 'ui://fixture/app.html',
          input: { value: 7 },
          result: { content: [{ type: 'text', text: '7' }] },
          isCurrent: () => true,
          canCall: () => true,
          readResource: async (uri) => ({
            contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: html }]
          }),
          listTools: async () => ({
            tools: [
              {
                name: 'increment',
                inputSchema: { type: 'object', properties: { delta: { type: 'integer' } } },
                _meta: { ui: { visibility: ['app'] } }
              }
            ]
          }),
          callTool: async (name, args) => {
            assert.equal(name, 'increment')
            calls++
            value += args.delta
            return { content: [{ type: 'text', text: String(value) }] }
          }
        }
      })
      const window = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false
        }
      })
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message)
      })
      const run = (code) => window.webContents.executeJavaScript(code)
      const wait = async (predicate) => {
        const deadline = Date.now() + 10000
        while (Date.now() < deadline) {
          if (await predicate()) return
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error('Timed out waiting for fixture state.')
      }
      const click = (text) =>
        run(
          `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`
        )
      try {
        await window.loadFile(path.join(directory, 'index.html'))
        await wait(() =>
          run(
            `!![...document.querySelectorAll('button')].find(button=>button.textContent==='Open interactive app')`
          )
        )
        await click('Open interactive app')
        let widget
        await wait(async () => {
          widget = window.webContents.mainFrame.framesInSubtree.find((frame) =>
            frame.url.endsWith('/content')
          )
          return (
            widget &&
            (await widget.executeJavaScript(`document.getElementById('value')?.textContent==='7'`))
          )
        })
        assert.equal(
          await widget.executeJavaScript(
            `(()=>{try{window.parent.parent.document.body;return false}catch{return true}})()`
          ),
          true
        )
        assert.equal(await widget.executeJavaScript(`typeof window.mcpAppsApi`), 'undefined')
        assert.equal(await widget.executeJavaScript(`typeof require`), 'undefined')
        assert.equal(
          await widget.executeJavaScript(
            `fetch('https://example.com/blocked').then(()=>false,()=>true)`
          ),
          true
        )
        await widget.executeJavaScript(`document.getElementById('increment').click()`)
        await wait(() => run(`document.body.textContent.includes('Allow Fixture connector')`))
        assert.equal(calls, 0)
        await click('Cancel app action')
        await wait(() =>
          widget.executeJavaScript(`document.getElementById('value').textContent==='Canceled'`)
        )
        assert.equal(calls, 0)
        await widget.executeJavaScript(`document.getElementById('increment').click()`)
        await wait(() => run(`document.body.textContent.includes('Allow Fixture connector')`))
        await click('Allow app action')
        await wait(() =>
          widget.executeJavaScript(`document.getElementById('value').textContent==='8'`)
        )
        assert.equal(calls, 1)
        await fs.writeFile(
          path.join(directory, 'widget.png'),
          (await window.webContents.capturePage()).toPNG()
        )
        const id = await run(`new URL(document.querySelector('iframe').src).hostname`)
        await click('Close app')
        await wait(() => run(`!document.querySelector('iframe')`))
        assert.equal(
          await run(
            `window.mcpAppsApi.request(${JSON.stringify(id)},'tools/list',{}).then(()=>false,()=>true)`
          ),
          true
        )
        console.log(
          'MCP Apps UI passed: official SDK handshake, nested-frame isolation, CSP, initial data, deny/allow tool call, and close revocation.'
        )
        app.exit(0)
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
