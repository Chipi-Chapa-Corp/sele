const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-account-switch-')
    )
    try {
      const project = path.resolve(__dirname, '../..')
      const selection = await fs.readFile(
        path.join(project, 'src/renderer/src/workspace/useWorkspaceSelection.tsx'),
        'utf8'
      )
      const usageHooks = selection.slice(
        selection.indexOf('  const usageScope = useMemo('),
        selection.indexOf('  const latestAssistantMessage =')
      )
      const controller = await fs.readFile(
        path.join(project, 'src/renderer/src/useWorkspaceController.tsx'),
        'utf8'
      )
      const switchHandler = controller.slice(
        controller.indexOf('  const switchProviderAccount = async'),
        controller.indexOf('  const handleUseProviderAccount = async')
      )
      await require('esbuild').build({
        stdin: {
          resolveDir: project,
          loader: 'tsx',
          contents: `
          import React, {useState,useEffect,useLayoutEffect,useMemo,useRef,useCallback} from 'react'
          import {createRoot} from 'react-dom/client'
          import {SidebarProviderAccount} from './src/renderer/src/workspace/components/SidebarProviderAccount'
          import {UsageIndicator} from './src/renderer/src/components/UsageIndicator'
          import {providerApi} from './src/renderer/src/providerApi'
          import {mergeAccountUsage,getErrorMessage} from './src/renderer/src/workspace/chatControllerUtils'
          import {normalizeContainerTarget} from './src/renderer/src/containerSelection'
          import './src/renderer/src/App.css'
          import './src/renderer/src/assets/main.css'
          function Fixture(){
            const [selectedChat,setSelectedChat]=useState(null)
            const selectedChatId=selectedChat?.id
            const selectedChatStatus=null
            const changesContainer=null,changesContainerKey='host',usageProviderId='codex'
            const usageProviderAvailable=true,usageProviderAvailabilityReady=true
            const [providerAccountRevision,setProviderAccountRevision]=useState(0)
            const [accountUsage,setAccountUsage]=useState(null)
            const [accountUsageState,setAccountUsageState]=useState('loading')
            const [accountUsageError,setAccountUsageError]=useState(null)
            const [providerAccountUpdatingId,setProviderAccountUpdatingId]=useState(null)
            const setProviderAccountsError=()=>{},setChats=()=>{},setChatDetail=()=>{}
            const setProviderModelsRevision=()=>{},setChatLoadRequest=()=>{}
            const applyProviderAccountConfiguration=()=>{}
            ${usageHooks}
            ${switchHandler}
            window.openFixtureChat=()=>setSelectedChat({id:'saved-chat',accountId:'default'})
            window.openFixtureNewChat=()=>setSelectedChat(null)
            window.usageFixture={accountUsage,accountUsageState,accountUsageError}
            return <main style={{padding:30}}>
              <SidebarProviderAccount providerId="codex" chatId={selectedChatId} refreshKey={String(providerAccountRevision)} container={null}
                available updating={Boolean(providerAccountUpdatingId)} hasVisibleLimits
                onSelect={id=>switchProviderAccount(id,'codex',null,selectedChatId)} onCreate={async()=>{throw Error('unexpected login')}} onDelete={async()=>{}} />
              <UsageIndicator providerId="codex" scopeKey={String(providerAccountRevision)} chatId={selectedChatId} container={null}
                accountUsage={accountUsage} accountUsageState={accountUsageState} accountUsageError={accountUsageError}
                contextUsage={{source:'unavailable',usedTokens:null,maxTokens:null}} displayUsage={{context:false,short:true,long:true}}
                onUsageRefresh={refreshAccountUsage}/>
              <output id="statistics">{accountUsage?.summary?.fixtureAccount ?? ''}</output>
            </main>
          }
          createRoot(document.getElementById('root')).render(<Fixture/>);
        `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js')
      })
      const serviceExports = [
        'getChatUpdateSummary',
        'getProviderCachedChat',
        'getProviderConversationViews',
        'getProviderKnownChats',
        'beginProviderConversationRead',
        'saveProviderConversationView',
        'beginProviderChatHistoryRead',
        'saveProviderChatHistory',
        'getProviderChatCursorWindow',
        'getProviderChatItemWindow',
        'getProviderSubagentItemWindow',
        'getProviderChatWindow'
      ]
      await require('esbuild').build({
        entryPoints: [path.join(project, 'src/main/providers/registerProviderIpc.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(directory, 'ipc.cjs'),
        plugins: [
          {
            name: 'isolated-account-service',
            setup(build) {
              build.onResolve({ filter: /^(\.\/providerService|\.\.\/logging)$/ }, (args) => ({
                path: args.path,
                namespace: 'fixture'
              }))
              build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: modulePath }) => ({
                contents: modulePath.endsWith('logging')
                  ? `import {ipcMain} from 'electron';export const handleLoggedIpc=(channel,handler)=>ipcMain.handle(channel,handler);export const logDiagnostic=()=>{};`
                  : `export const providerApi={onChatUpdated:()=>()=>{},getAccounts:(...args)=>globalThis.accountFixture.getAccounts(...args),useAccount:(...args)=>globalThis.accountFixture.useAccount(...args),getUsage:(...args)=>globalThis.accountFixture.getUsage(...args)};${serviceExports.map((name) => `export const ${name}=()=>{};`).join('')}`
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('providerApi',Object.fromEntries(['getAccounts','useAccount','getUsage'].map(method=>[method,(...args)=>ipcRenderer.invoke('provider:'+({getAccounts:'get-accounts',useAccount:'use-account',getUsage:'get-usage'}[method]),...args)])));`
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
        env,
        encoding: 'utf8',
        timeout: 30000
      })
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw Error(result.stderr || String(result.error))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  let defaultAccount = 'default'
  const bindings = new Map([['saved-chat', 'default']])
  globalThis.accountFixture = {
    getAccounts: async (_provider, options) => ({
      available: true,
      accounts: [
        { id: 'default', displayName: 'Personal' },
        { id: 'work', displayName: 'Work' }
      ].map((account) => ({
        ...account,
        active: account.id === (options?.chatId ? bindings.get(options.chatId) : defaultAccount)
      }))
    }),
    useAccount: async (provider, id, options) => {
      if (options?.chatId) bindings.set(options.chatId, id)
      else defaultAccount = id
      return globalThis.accountFixture.getAccounts(provider, options)
    },
    getUsage: async (_provider, options) => {
      const account = options?.chatId ? bindings.get(options.chatId) : defaultAccount
      await new Promise((resolve) => setTimeout(resolve, 50))
      return {
        updatedAt: Date.now(),
        statisticsLoaded: true,
        summary: { fixtureAccount: account },
        rateLimits: [
          {
            id: 'five_hour',
            kind: 'primary',
            label: 'Codex',
            windowMinutes: 300,
            usedPercent: account === 'default' ? 10 : 80,
            resetsAt: null
          }
        ],
        errors: [],
        dailyUsageBuckets: null,
        rateLimitResetCredits: null
      }
    }
  }
  require(path.join(directory, 'ipc.cjs')).registerProviderIpc()
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        width: 700,
        height: 400,
        show: true,
        webPreferences: { preload: path.join(directory, 'preload.cjs') }
      })
      const errors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const waitFor = async (source) => {
        for (let i = 0; i < 100; i++) {
          if (await run(source)) return
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw Error('Timed out: ' + source + '; ' + errors.join('\n'))
      }
      const expectUsage = async (label, remaining, account) => {
        await waitFor(
          `document.querySelector('[aria-label="Codex account"]')?.textContent.includes(${JSON.stringify(label)})`
        )
        await waitFor(
          `window.usageFixture.accountUsageState==='ready'&&document.querySelector('[data-usage-limit=short]')?.textContent.trim()===${JSON.stringify(remaining)}&&document.getElementById('statistics').textContent===${JSON.stringify(account)}`
        )
      }
      const select = async (label) => {
        await run(`document.querySelector('[aria-label="Codex account"]').click()`)
        await waitFor(
          `Array.from(document.querySelectorAll('[role=option]')).some(node=>node.textContent.includes(${JSON.stringify(label)}))`
        )
        await run(
          `Array.from(document.querySelectorAll('[role=option]')).find(node=>node.textContent.includes(${JSON.stringify(label)})).click()`
        )
      }
      await expectUsage('Personal', '90%', 'default')
      await select('Work')
      await expectUsage('Work', '20%', 'work')
      assert.equal(defaultAccount, 'work')
      await run('window.openFixtureChat()')
      await expectUsage('Personal', '90%', 'default')
      await select('Work')
      await expectUsage('Work', '20%', 'work')
      await run('window.openFixtureNewChat()')
      await expectUsage('Work', '20%', 'work')
      await select('Personal')
      await expectUsage('Personal', '90%', 'default')
      await run('window.openFixtureChat()')
      await expectUsage('Work', '20%', 'work')
      assert.equal(bindings.get('saved-chat'), 'work')
      assert.equal(defaultAccount, 'default')
      assert.deepEqual(errors, [])
      console.log(
        'PASS real Electron IPC: new-chat switching, chat switching, account-specific usage and statistics, preserved chat binding'
      )
      app.quit()
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
