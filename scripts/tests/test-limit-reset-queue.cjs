const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-reset-queue-ui-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { UsageIndicator } from './src/renderer/src/components/UsageIndicator'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { LimitResetQueueMessages } from './src/renderer/src/components/LimitResetQueueMessages'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            const root = createRoot(document.getElementById('root'))
            window.renderFixture = () => flushSync(() => root.render(<main style={{width:600}}>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:20}}>
                <UsageIndicator providerId="codex" chatId={window.newChat ? null : "chat"} accountUsage={{rateLimits:[{id:'primary',label:'Codex',kind:'primary',usedPercent:100,windowMinutes:300,resetsAt:1800000000}],errors:[],updatedAt:1}}
                  contextUsage={{source:'unavailable',usedTokens:null,maxTokens:null}} displayUsage={{short:true,long:true,context:true}}
                  accountUsageState="ready" accountUsageError={null}
                  onQueueLimitReset={async prompt => {
                    window.lastQueuedTarget = window.newChat ? {draftKey:'new-draft'} : 'chat'
                    window.attempts++
                    if (window.failSave) throw new Error('Reset date unavailable')
                    if (window.delay) await new Promise(resolve => {window.finishSave=resolve})
                    window.messages.push({id:String(window.attempts),content:prompt,createdAt:1799999000000,resetsAt:1800000000000})
                    window.dispatchEvent(new Event('sele-limit-reset-queue-changed'))
                  }}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'0.7rem'}}>
              <ChatDetailItem item={{type:'pendingMessage',kind:'steering',id:'steering',content:'Adjust the approach',createdAt:1799999000000}} />
              <ChatDetailItem item={{type:'pendingMessage',kind:'queued',id:'queued',content:'Continue with the next task',createdAt:1799999000000}} />
              <LimitResetQueueMessages key={window.newChat ? "draft" : "chat"} providerId="codex" target={window.newChat ? {draftKey:"new-draft"} : "chat"} />
              </div>
            </main>))
            window.renderFixture()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        plugins: [
          {
            name: 'unused-editor-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents:
                  'export default class { constructor() { throw new Error("Editor workers are outside this message-rendering test") } }',
                loader: 'js'
              }))
            }
          }
        ],
        loader: { '.ttf': 'file' },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'goal.js')
      })
      await fs.writeFile(
        path.join(directory, 'goal.html'),
        `<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="goal.css"><style>
        body { min-height:calc(100vh - 60px); margin: 30px; background: #141414; color: #eee; --composer-bg:#202020; --chat-content-max-width:60rem; --chat-font-family:system-ui; --chat-font-size:14px; --focus-ring:#aaa; }
        .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
      </style><div id="root"></div><script>
        Date.now=()=>1799989080000;
        window.messages=[];window.attempts=0;window.failSave=false;window.delay=false;
        window.providerApi={
          getLimitResetMessages:async()=>{if(window.failLoad)throw new Error('offline');return structuredClone(window.messages)},
          deleteLimitResetMessage:async(_provider,_chat,id)=>{window.messages=window.messages.filter(entry=>entry.id!==id)},
          onChatUpdated:()=>()=>{}
        };
      </script><script src="goal.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        result.error ||
        !result.stdout.includes('Reset queue UI checks passed')
      ) {
        process.stderr.write(result.stderr || String(result.error || 'Electron check failed'))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 700,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'goal.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const click = async (label) => {
        await run(`document.querySelector('[aria-label="${label}"]').click()`)
        await settle()
      }
      const setText = async (text) => {
        await run(`(() => {
          const input = document.querySelector('textarea')
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
          input.dispatchEvent(new Event('input', {bubbles: true}))
        })()`)
        await settle()
      }
      const save = async () => {
        await run("document.querySelector('form').requestSubmit()")
        await settle()
      }
      await settle()
      assert.equal(
        await run(
          "document.querySelector('.message-box__usage-control button:last-child').getAttribute('aria-label')"
        ),
        'On Limit Reset'
      )
      assert.equal(await run("document.querySelectorAll('[data-usage-limit]').length"), 1)
      assert.equal(
        await run(`(() => {
        const badge=document.querySelector('[data-usage-limit]').getBoundingClientRect()
        const clock=document.querySelector('[aria-label="On Limit Reset"]').getBoundingClientRect()
        return clock.left>=badge.right
      })()`),
        true
      )
      assert.equal(
        await run(`(() => {
        const clock=document.querySelector('[aria-label="On Limit Reset"]')
        return clock.classList.contains('ui-button--secondary') && getComputedStyle(clock).backgroundColor !== 'rgba(0, 0, 0, 0)'
      })()`),
        true
      )
      // Empty and failed empty loads must never create a queue banner.
      assert.equal(await run('document.querySelector(".limit-reset-queue")'), null)
      await run(
        "window.failLoad=true;window.dispatchEvent(new Event('sele-limit-reset-queue-changed'))"
      )
      await settle()
      assert.equal(await run('document.querySelector(".limit-reset-queue")'), null)
      await run('window.failLoad=false')
      await click('On Limit Reset')
      assert.equal(await run('document.querySelector("dialog").open'), true)
      assert.equal(await run('document.activeElement.tagName'), 'TEXTAREA')
      assert.equal(
        await run('document.querySelector("dialog header time").textContent'),
        'in 3h 2m'
      )
      assert.equal(
        await run('document.querySelector("dialog header time").title.includes("2027")'),
        true
      )
      if (process.env.SELE_RESET_QUEUE_SCREENSHOT)
        await fs.writeFile(
          process.env.SELE_RESET_QUEUE_SCREENSHOT.replace('.png', '-popup.png'),
          (await win.webContents.capturePage()).toPNG()
        )
      assert.equal(
        await run('document.querySelector("dialog footer button:last-child").disabled'),
        true
      )
      assert.equal(
        await run(
          'document.querySelector("dialog").textContent.includes("Wait for the next limit reset")'
        ),
        false
      )
      await setText('Continue after reset')
      await run('window.failSave=true')
      await save()
      assert.equal(
        await run('document.querySelector("[role=alert]").textContent'),
        'Reset date unavailable'
      )
      assert.equal(await run('document.querySelector("textarea").value'), 'Continue after reset')
      await run('window.failSave=false;window.delay=true')
      await save()
      await save()
      assert.equal(await run('window.attempts'), 2)
      assert.equal(await run('document.querySelector("textarea").disabled'), true)
      await run('window.finishSave()')
      await settle()
      assert.equal(await run('document.querySelector("dialog")'), null)
      assert.equal(
        await run(
          'document.querySelector(".limit-reset-queue .chat-detail__message").textContent.trim()'
        ),
        'Continue after reset'
      )
      assert.equal(
        await run('document.querySelector(".limit-reset-queue time").dateTime'),
        '2027-01-15T08:00:00.000Z'
      )
      assert.equal(
        await run('document.querySelector(".limit-reset-queue time").textContent'),
        'in 3h 2m'
      )
      assert.equal(
        await run('document.querySelector(".limit-reset-queue time").title.includes("2027")'),
        true
      )
      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll(".chat-detail__pending-message-label"), e => e.textContent)'
        ),
        ['Steering', 'Queue', 'On reset in 3h 2m']
      )
      assert.equal(
        await run('document.querySelector(".limit-reset-queue .chat-plan__toggle")'),
        null
      )
      assert.equal(
        await run(`(() => {
        const bubbles = [...document.querySelectorAll('.chat-detail__message--user')]
        const styles = bubbles.map(bubble => getComputedStyle(bubble))
        return styles.every(style => style.borderStyle === 'dashed' && style.backgroundColor === styles[0].backgroundColor)
      })()`),
        true
      )
      // A remount reads the persisted queue again.
      await run('window.renderFixture()')
      await settle()
      assert.equal(await run('document.querySelectorAll(".limit-reset-queue__message").length'), 1)
      if (process.env.SELE_RESET_QUEUE_SCREENSHOT) {
        await run(
          'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))'
        )
        await fs.writeFile(
          process.env.SELE_RESET_QUEUE_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await click('Delete queued message')
      assert.equal(await run('document.querySelector(".limit-reset-queue")'), null)
      await run('window.newChat=true;window.delay=false;window.renderFixture()')
      await settle()
      await click('On Limit Reset')
      assert.equal(
        await run('document.querySelector("dialog header time").textContent'),
        'in 3h 2m'
      )
      await setText('Start a new chat after reset')
      await save()
      assert.deepEqual(await run('window.lastQueuedTarget'), { draftKey: 'new-draft' })
      assert.equal(
        await run(
          'document.querySelector(".limit-reset-queue .chat-detail__message").textContent.trim()'
        ),
        'Start a new chat after reset'
      )
      console.log(
        'Reset queue UI checks passed: placement, focus, validation, errors, double submit protection, rendering and removal'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
