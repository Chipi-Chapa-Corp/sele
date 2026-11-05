// Actual APK -> LAN bridge -> real provider CLIs -> scripted local model server.
// All provider homes and profiles are temporary. Explicitly select an emulator.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const harness = require('./harness.cjs')
const mock = require('./mock-model-server.cjs')
const { Page } = require('./page.cjs')
const android = require('../tests/android-local-access.cjs')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

async function main() {
  assert.match(process.env.SELE_ANDROID_TEST_SERIAL || '', /^emulator-\d+$/)
  const artifacts = path.resolve(
    'test-results/mobile-providers',
    new Date().toISOString().replace(/[:.]/g, '-')
  )
  fs.mkdirSync(artifacts, { recursive: true })
  const directory = fs.mkdtempSync(path.resolve('tmp/mobile-providers-'))
  const outDir = path.resolve('tmp/sele-e2e/out')
  if (!process.argv.includes('--skip-build')) harness.buildApp(outDir, { force: true })
  const modelPort = await mock.start({ logFile: path.join(artifacts, 'models.log') })
  const { env, executables, dirs } = harness.prepareEnvironment(directory, modelPort)
  for (const [key, value] of [['user.name', 'Sele Android fixture'], ['user.email', 'sele-fixture@example.invalid']])
    execFileSync('git', ['-C', dirs.work, 'config', '--local', key, value])
  execFileSync('git', ['-C', dirs.work, 'add', 'README.md'])
  execFileSync('git', ['-C', dirs.work, 'commit', '-qm', 'Initialize mobile fixture'])
  const browserFixture = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone browser fixture</title><style>body{font:20px system-ui;margin:20px;background:#faf9f6}input,button{font:inherit;padding:12px;display:block;margin:10px 0}</style><form onsubmit="event.preventDefault();document.title='Saved '+document.getElementById('name').value;document.getElementById('result').textContent=document.getElementById('name').value"><label>Name<input id="name"></label><button>Save</button></form><p id="result">Ready</p><a href="/second">Next page</a><a id="new-window" href="/popup" target="_blank">Open page</a><div style="height:1800px">Scroll the page</div><p>End of page</p>`
    )
  })
  await new Promise((resolve) => browserFixture.listen(0, '0.0.0.0', resolve))
  const browserUrl = `http://127.0.0.1:${browserFixture.address().port}`
  let app
  try {
    for (const provider of harness.providers)
      assert.ok(executables[provider], `${provider} must be installed for the full mobile matrix`)
    app = await harness.launchApp({ outDir, env, logFile: path.join(artifacts, 'desktop.log') })
    const desktop = new Page(app.cdp, { artifacts })
    await desktop.waitFor('Boolean(window.localAccessApi && window.providerApi)', {
      timeout: 60000
    })
    let startupChat
    if (!process.env.SELE_MOBILE_TEST_BROWSER_ONLY) {
      const startupModels = await desktop.eval('providerApi.getModels("codex")')
      const startupModel = startupModels.find(model => model.id.includes('mock-model')) || startupModels.find(model => model.isDefault) || startupModels[0]
      startupChat = await desktop.eval(`providerApi.startChat('codex','Sleeping on desktop before Android connects #delay 200',${JSON.stringify({cwd:dirs.work,container:{kind:'host'},model:startupModel.id,approvalPolicy:'never',sandboxMode:'danger-full-access'})})`)
      await desktop.eval(`appApi.updateChatSleep([{key:${JSON.stringify('codex:'+startupChat.id)},wakeAt:null}])`)
    }
    const port = await harness.freePort()
    const state = await desktop.eval(`localAccessApi.configure({enabled:true,port:${port}})`)
    const link = state.urls[0]
    assert.ok(link)
    await android({
      link,
      getState: () => desktop.eval('localAccessApi.getState()'),
      decidePairing: async () => {
        await desktop.waitFor('Boolean(document.querySelector("dialog.device-pairing[open]"))', {
          timeout: 15000
        })
        await desktop.click(
          `([...document.querySelectorAll('dialog.device-pairing button')].find(button=>button.textContent.includes('Allow device')))`
        )
      },
      exercise: async (ui) => {
        const { run, delay, screenshot } = ui
        const wait = async (check, label) => {
          const deadline = Date.now() + 60000
          while (Date.now() < deadline) {
            if (await check()) return
            await delay(150)
          }
          throw new Error(`Timed out: ${label}`)
        }
        const call = (provider, method, ...args) =>
          run(
            `providerApi[${JSON.stringify(method)}](${[provider, ...args].map((value) => JSON.stringify(value)).join(',')})`
          )
        if (process.env.SELE_MOBILE_TEST_BROWSER_ONLY) {
          await ui.navigate('Workspace')
          await require('../tests/android-browser-ui.cjs')(ui, { desktop, browserUrl, artifacts })
          await require('../tests/android-files-ui.cjs')(ui, { dirs, artifacts })
          console.log('MOBILE BROWSER AND FILES PASSED')
          return
        }
        if (process.env.SELE_MOBILE_TEST_SYNC) {
          const models = await desktop.eval('providerApi.getModels("codex")')
          const model = models.find(model=>model.id.includes('mock-model')) || models[0]
          await require('../tests/android-preference-sync.cjs')(ui, {desktop, artifacts, modelId:model.id, chatId:startupChat.id, cwd:dirs.work})
          if(process.env.SELE_MOBILE_TEST_SYNC_ONLY) return
        }
        await require('../tests/android-sleep-sync.cjs').startup(ui, { desktop, chatId: startupChat.id })
        if (process.env.SELE_MOBILE_TEST_SLEEP_ONLY) return
        const results = []
        const requested = process.env.SELE_MOBILE_TEST_PROVIDERS?.split(',') ?? harness.providers
        for (const provider of requested) {
          console.log(
            `MOBILE: ${provider} models, creation, output, bidirectional messages, done/undone`
          )
          const models = await call(provider, 'getModels')
          assert.ok(models.length, `${provider} exposes models to Android`)
          const model =
            models.find((value) => value.id.includes('mock-model')) ||
            models.find((value) => value.isDefault) ||
            models[0]
          const options = {
            cwd: dirs.work,
            container: { kind: 'host' },
            model: model.id,
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandboxMode:
              provider === 'copilot' && process.env.SELE_MOBILE_READ_ONLY
                ? 'read-only'
                : 'danger-full-access',
            serviceTier: null,
            ...(provider === 'copilot' ? { agentMode: 'interactive' } : {})
          }
          await run(
            `window.__mobileEvents=[]; window.__mobileUnsubscribe?.(); window.__mobileUnsubscribe=providerApi.onChatUpdated(event=>window.__mobileEvents.push(event)); true`
          )
          await desktop.eval(
            `window.__desktopEvents=[]; window.__desktopUnsubscribe?.(); window.__desktopUnsubscribe=providerApi.onChatUpdated(event=>window.__desktopEvents.push(event)); true`
          )
          const marker = `mobile-${provider}-${Date.now()}`
          const chat = await call(provider, 'startChat', `${marker}-create #delay 200`, options)
          assert.ok(chat.id)
          const read = async () => {
            const detail = await call(provider, 'getChat', chat.id)
            fs.writeFileSync(
              path.join(artifacts, provider + '-detail.json'),
              JSON.stringify(detail, null, 2)
            )
            return detail
          }
          const contents = (detail) =>
            (detail.items || [])
              .filter((item) => item.type === 'message' && item.role === 'assistant')
              .map((item) =>
                typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
              )
              .join('\n')
          await wait(async () => {
            const detail = await read()
            return !detail.status && contents(detail).includes(`Reply to: ${marker}-create`)
          }, `${provider} first reply`)
          await wait(
            () =>
              desktop.eval(
                `Boolean(document.querySelector('[data-chat-id="' + CSS.escape(${JSON.stringify(chat.id)}) + '"]'))`
              ),
            `${provider} Android-created session appears on desktop`
          )
          if (process.env.SELE_MOBILE_TEST_API_ONLY)
            await call(provider, 'continueChat', chat.id, `${marker}-phone`, options)
          else {
            await ui.navigate('Chats')
            await ui.tap(`[data-chat-id="${chat.id}"] .chat-list-item__main`)
            await ui.waitFor(
              `document.getElementById('chat-search-content')?.innerText.includes(${JSON.stringify(marker + '-create')})`
            )
            await ui.tap('#message-input')
            await delay(350)
            ui.adb(['shell', 'input', 'text', `'${marker}-phone'`])
            await ui.waitFor(
              `document.querySelector('#message-input')?.value.includes(${JSON.stringify(marker + '-phone')})`
            )
            await ui.waitFor(
              '!document.querySelector(\'button[aria-label="Send message"]\')?.disabled'
            )
            await delay(250)
            await ui.tap('button[aria-label="Send message"]')
          }
          await wait(async () => {
            const detail = await read()
            return !detail.status && contents(detail).includes(`${marker}-phone`)
          }, `${provider} phone message reply`)
          assert.equal(
            (await read()).items.filter(
              (item) =>
                item.type === 'message' &&
                item.role === 'user' &&
                typeof item.content === 'string' &&
                item.content.includes(marker + '-phone')
            ).length,
            1,
            'a native touch sends exactly one user message'
          )
          await desktop.eval(
            `providerApi.continueChat(${JSON.stringify(provider)},${JSON.stringify(chat.id)},${JSON.stringify(marker + '-desktop')},${JSON.stringify(options)})`
          )
          await wait(
            async () => contents(await read()).includes(`${marker}-desktop`),
            `${provider} desktop message reply visible on Android`
          )
          if (!process.env.SELE_MOBILE_TEST_API_ONLY) {
            await ui.waitFor(
              `document.getElementById('chat-search-content')?.innerText.includes(${JSON.stringify(marker + '-desktop')})`
            )
            await ui.dismissKeyboard()
            const title = `Phone ${provider} verified`
            await desktop.eval(
              `providerApi.setChatTitle(${JSON.stringify(provider)},${JSON.stringify(chat.id)},${JSON.stringify(title)})`
            )
            await ui.waitFor(
              `document.querySelector('[data-chat-id="${chat.id}"] .chat-list-item__title')?.textContent===${JSON.stringify(title)}`
            )
          }
          await call(provider, 'markChatDone', chat.id, true)
          assert.equal((await read()).done, true)
          assert.equal(
            (
              await desktop.eval(
                `providerApi.getChat(${JSON.stringify(provider)},${JSON.stringify(chat.id)})`
              )
            ).done,
            true
          )
          await desktop.eval(
            `providerApi.markChatDone(${JSON.stringify(provider)},${JSON.stringify(chat.id)},false)`
          )
          assert.equal((await read()).done, false)
          assert.ok(
            (await run('window.__mobileEvents.length')) > 0,
            `${provider} pushes updates to Android`
          )
          assert.ok(
            (await desktop.eval('window.__desktopEvents.length')) > 0,
            `${provider} pushes updates to desktop`
          )
          results.push({ provider, chatId: chat.id, model: model.id, passed: true })
          fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
        }
        if (process.env.SELE_MOBILE_TEST_CONTROLS)
          await require('../tests/android-provider-controls.cjs')(ui, { desktop, dirs, results })
        await require('../tests/android-sleep-sync.cjs').providers(ui, { desktop, results })
        if (process.env.SELE_MOBILE_TEST_UI) {
          await delay(350)
          await require('../tests/android-functional-ui.cjs')(ui, {
            desktop,
            dirs,
            chat: results.find((value) => value.provider === 'codex'),
            artifacts,
            browserUrl
          })
        }
        await screenshot(path.join(artifacts, 'android.png'))
        console.log(
          `MOBILE PROVIDER MATRIX PASSED: ${results.map((value) => value.provider).join(', ')} across the APK/LAN bridge`
        )
      }
    })
  } finally {
    if (app) await app.close()
    browserFixture.close()
    mock.server.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
