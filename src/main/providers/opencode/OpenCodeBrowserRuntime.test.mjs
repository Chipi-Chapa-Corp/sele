import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { getOpenCodePermissionRules } from './OpenCodePermissions.ts'

test('installed OpenCode server loads the ephemeral plugin, asks permission, and routes real tool calls', {
  skip: !process.env.SELE_OPENCODE_RUNTIME,
  timeout: 90_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-opencode-runtime-'))
  const oldEnv = { ...process.env }
  const calls = []
  const clients = []
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4QCJgGNUwqmH4agAAw6LQH2lQdaIAAAAASUVORK5CYII='
  globalThis.__seleOpenCodeBrowserService = {
    createClient(scope) {
      const client = {
        scope,
        closed: false,
        async listTabs() {
          assert.equal(this.closed, false)
          calls.push(scope.sessionId)
          return [
            { id: 7, title: 'runtime fixture ' + scope.sessionId, url: 'about:blank', active: true }
          ]
        },
        async executeCdp(_id, method, params) {
          if (method === 'Page.captureScreenshot') return { data: png }
          if (method === 'Runtime.evaluate')
            return {
              result: {
                value: params.expression.includes('innerWidth')
                  ? { width: 800, height: 600 }
                  : { x: 0, y: 0 }
              }
            }
          return {}
        },
        close() {
          this.closed = true
        }
      }
      clients.push(client)
      return client
    }
  }
  const modelRequests = []
  const model = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    modelRequests.push(body)
    const hasResult = body.messages.some((x) => x.role === 'tool')
    const hasBrowser = body.tools?.some((x) => x.function?.name === 'sele_browser_tabs_context')
    const screenshot = JSON.stringify(body.messages).includes('screenshot fixture')
    const delta =
      hasResult || !hasBrowser
        ? { role: 'assistant', content: 'Fixture finished.' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_browser_fixture',
                type: 'function',
                function: {
                  name: screenshot ? 'sele_browser_computer' : 'sele_browser_tabs_context',
                  arguments: screenshot ? '{"action":"screenshot"}' : '{}'
                }
              }
            ]
          }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: null }]
        }) +
        '\n\n'
    )
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            { index: 0, delta: {}, finish_reason: hasResult || !hasBrowser ? 'stop' : 'tool_calls' }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        }) +
        '\n\n'
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
  let server
  const sessions = []
  try {
    await mkdir(join(directory, 'project'))
    await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir')
    for (const name of ['CONFIG', 'CACHE', 'DATA', 'STATE'])
      process.env[`XDG_${name}_HOME`] = join(directory, name.toLowerCase())
    process.env.OPENCODE_CONFIG_DIR = join(directory, 'config')
    process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true'
    process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = 'true'
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      enabled_providers: ['fixture'],
      model: 'fixture/browser-test',
      small_model: 'fixture/browser-test',
      agent: { title: { disable: true } },
      provider: {
        fixture: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Local fixture',
          options: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'fixture' },
          models: {
            'browser-test': {
              name: 'Browser fixture',
              limit: { context: 10000, output: 1000 },
              modalities: { input: ['text', 'image'], output: ['text'] }
            }
          }
        }
      }
    })
    await build({
      entryPoints: ['src/main/providers/opencode/OpenCodeServerClient.ts'],
      outfile: join(directory, 'server.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      plugins: [
        {
          name: 'host-fixture',
          setup(builder) {
            const stubs = {
              hostProcess:
                'export const isRunningInFlatpak = () => false; export const getHostCommand = async (file,args,options) => { await globalThis.__seleOpenCodeBeforeHostCommand?.(); return {file,args,...options}; };',
              currentContainer:
                'export const getCurrentContainerHostBridge = async () => null; export const isCurrentContainerTarget = () => false;',
              OpenCodeExecutable:
                'export const getOpenCodeExecutable = () => process.env.SELE_OPENCODE_RUNTIME; export const getOpenCodeExecutableError = x => x;',
              BrowserAutomation:
                'export const getBrowserAutomationService = () => globalThis.__seleOpenCodeBrowserService;',
              electron: 'export const nativeImage = {};'
            }
            builder.onResolve(
              {
                filter:
                  /(?:hostProcess|currentContainer|OpenCodeExecutable|BrowserAutomation)$|^electron$/
              },
              (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' })
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents: stubs[args.path]
            }))
          }
        }
      ]
    })
    const { OpenCodeServerClient } = await import(pathToFileURL(join(directory, 'server.mjs')).href)
    server = new OpenCodeServerClient()
    const client = await server.getClient()
    const cwd = join(directory, 'project')
    const createSession = async (enabled = true) => {
      const result = (
        await client.session.create(
          {
            directory: cwd,
            title: 'Browser fixture',
            permission: getOpenCodePermissionRules({}, enabled)
          },
          { throwOnError: true }
        )
      ).data
      sessions.push(result.id)
      return result
    }
    const run = async (session, approve = true, screenshot = false) => {
      let complete = false
      const prompt = client.session
        .prompt(
          {
            sessionID: session.id,
            directory: cwd,
            model: { providerID: 'fixture', modelID: 'browser-test' },
            parts: [
              {
                type: 'text',
                text: screenshot ? 'Run the screenshot fixture.' : 'Run the browser fixture.'
              }
            ]
          },
          { throwOnError: true }
        )
        .finally(() => {
          complete = true
        })
      const deadline = Date.now() + 20_000
      let permissions = []
      while (!complete && Date.now() < deadline) {
        permissions = (
          await client.permission.list({ directory: cwd }, { throwOnError: true })
        ).data.filter((x) => x.sessionID === session.id)
        if (permissions.length) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      if (approve && permissions.length) {
        assert.equal(
          permissions[0].permission,
          screenshot ? 'sele_browser_computer' : 'sele_browser_tabs_context'
        )
        await client.permission.reply(
          { directory: cwd, requestID: permissions[0].id, reply: 'once' },
          { throwOnError: true }
        )
      }
      const result = await prompt
      return { result, permissions }
    }
    const owning = await createSession()
    const browser = await server.registerBrowser({
      providerId: 'opencode',
      sessionId: owning.id,
      cwd,
      containerKey: 'host'
    })
    assert.ok(browser)
    const first = await run(owning)
    assert.equal(first.permissions.length, 1, 'real runtime must request ordinary approval')
    assert.deepEqual(calls, [owning.id])
    const toolMessage = modelRequests
      .flatMap((x) => x.messages)
      .find((x) => x.role === 'tool' && JSON.stringify(x).includes('runtime fixture'))
    assert.ok(toolMessage, 'actual browser output must reach model tool results')
    const navigation = modelRequests
      .flatMap((x) => x.tools ?? [])
      .find((x) => x.function?.name === 'sele_browser_navigate')
    assert.deepEqual(navigation.function.parameters.required, ['url'])
    const sibling = await createSession()
    await run(sibling)
    assert.deepEqual(calls, [owning.id], 'sibling without a Sele binding cannot use owning browser')
    const readOnly = await createSession(false)
    const before = modelRequests.length
    await run(readOnly, false)
    assert.ok(
      modelRequests
        .slice(before)
        .every((x) => !x.tools?.some((t) => t.function?.name.startsWith('sele_browser_')))
    )
    browser.suspend()
    assert.ok(clients.at(-1).closed)
    await browser.close()
    const screenshotSession = await createSession()
    const screenshotBrowser = await server.registerBrowser({
      providerId: 'opencode',
      sessionId: screenshotSession.id,
      cwd,
      containerKey: 'host'
    })
    await run(screenshotSession, true, true)
    const screenshotMessages = (
      await client.session.messages(
        { sessionID: screenshotSession.id, directory: cwd },
        { throwOnError: true }
      )
    ).data
    const image = screenshotMessages
      .flatMap((x) => x.parts)
      .flatMap((x) =>
        x.type === 'tool' && x.state.status === 'completed' ? (x.state.attachments ?? []) : []
      )
      .find((x) => x.mime === 'image/png')
    assert.ok(
      image,
      'actual runtime must retain screenshot attachment: ' + JSON.stringify(screenshotMessages)
    )
    assert.equal(image.url, 'data:image/png;base64,' + png)
    assert.match(
      JSON.stringify(modelRequests),
      /data:image\/png;base64,/,
      'actual runtime must send screenshot to local model'
    )
    await screenshotBrowser.close()
    for (const sessionID of sessions)
      await client.session.delete({ sessionID, directory: cwd }, { throwOnError: true })
    await server.dispose()
    server = new OpenCodeServerClient()
    let releaseStartup
    let reachedStartup
    const reached = new Promise((resolve) => {
      reachedStartup = resolve
    })
    const blocked = new Promise((resolve) => {
      releaseStartup = resolve
    })
    let firstStartup = true
    globalThis.__seleOpenCodeBeforeHostCommand = async () => {
      if (firstStartup) {
        firstStartup = false
        reachedStartup()
        await blocked
      }
    }
    const obsolete = server.getClient().then(
      () => {
        throw new Error('Obsolete startup unexpectedly succeeded')
      },
      (error) => error
    )
    await reached
    await server.dispose()
    const replacement = await server.getClient()
    releaseStartup()
    assert.match((await obsolete).message, /startup was canceled/)
    assert.equal(
      (await replacement.global.health({ throwOnError: true })).data.healthy,
      true,
      'old startup failure must not terminate replacement'
    )
  } finally {
    await server?.dispose()
    model.closeAllConnections()
    await new Promise((resolve) => model.close(resolve))
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    delete globalThis.__seleOpenCodeBrowserService
    delete globalThis.__seleOpenCodeBeforeHostCommand
    await rm(directory, { recursive: true, force: true })
  }
})
