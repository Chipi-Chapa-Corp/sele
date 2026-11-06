// Real Vite module loading with the full workspace and disposable provider APIs.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

exports.launch = async ({ directory, root, script, env }) => {
  const { createServer } = await import('vite')
  const configFile = path.join(directory, 'vite.config.ts')
  await fs.writeFile(
    configFile,
    `import {rendererViteConfig} from ${JSON.stringify(path.join(root, 'vite.renderer.ts'))}; export default rendererViteConfig`
  )
  await fs.appendFile(
    path.join(directory, 'api.js'),
    '\n;performance.setResourceTimingBufferSize(10000);\n'
  )
  const html = await fs.readFile(path.join(directory, 'index.html'), 'utf8')
  await fs.writeFile(
    path.join(directory, 'index.html'),
    html
      .replace('<link rel="stylesheet" href="fixture.css">', '')
      .replace(
        '<script src="fixture.js"></script>',
        '<script type="module" src="vite-entry.tsx"></script>'
      )
  )
  const server = await createServer({
    configFile,
    root: directory,
    cacheDir: path.join(directory, '.vite'),
    plugins:
      process.env.SELE_BENCHMARK_UPDATES === '1'
        ? [
            {
              name: 'fixture-update-stacks',
              enforce: 'pre',
              transform(code, id) {
                if (!id.endsWith('/src/renderer/src/App.tsx')) return
                return (
                  `import * as fixtureReact from 'react';\n` +
                  code.replace(
                    'export const App: React.FC = () => {',
                    `export const App: React.FC = () => {
            window.fixtureTrackDispatcher(fixtureReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H);`
                  )
                )
              }
            }
          ]
        : [],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, directory] } },
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'motion/react'],
      esbuildOptions:
        process.env.SELE_BENCHMARK_LANES === '1'
          ? {
              plugins: [
                {
                  name: 'fixture-update-lanes',
                  setup(build) {
                    build.onLoad(
                      { filter: /react-dom-client\.development\.js$/ },
                      async ({ path: file }) => ({
                        loader: 'js',
                        contents: (await fs.readFile(file, 'utf8')).replace(
                          'function scheduleUpdateOnFiber(root, fiber, lane) {',
                          `function scheduleUpdateOnFiber(root, fiber, lane) {
                if(lane & 63) {Error.stackTraceLimit=50;
                  (window.fixtureUpdateLanes??=[]).push({time:performance.now(),lane,
                    name:getComponentNameFromFiber(fiber),stack:new Error().stack});}`
                        )
                      })
                    )
                  }
                }
              ]
            }
          : undefined
    }
  })
  try {
    await server.listen()
    const child = require('node:child_process').spawn(
      require('electron'),
      [script, directory, `http://127.0.0.1:${server.httpServer.address().port}`, '--no-sandbox'],
      { env, stdio: 'inherit' }
    )
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    await server.close()
  }
}

exports.measure = async ({ win, run, errors, url }) => {
  const profiling = Boolean(process.env.SELE_BENCHMARK_PROFILE)
  const command = (name, params) => win.webContents.debugger.sendCommand(name, params)
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const metric = (sample, name) => sample.metrics.find((value) => value.name === name)?.value ?? 0
  const phases = []
  const lazyDelay = Number(process.env.SELE_BENCHMARK_LAZY_DELAY_MS) || 0
  if (lazyDelay)
    win.webContents.session.webRequest.onBeforeRequest((details, done) => {
      if (details.url.includes('/components/ChatDetailItem.tsx'))
        setTimeout(() => done({}), lazyDelay)
      else done({})
    })
  const trace = []
  if (process.env.SELE_BENCHMARK_TRACE === '1') {
    win.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Tracing.dataCollected') trace.push(...params.value)
    })
  }
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await command('Performance.enable')
  if (process.env.SELE_BENCHMARK_TRACE === '1')
    await command('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack'
    })
  if (profiling) {
    await command('Profiler.enable')
    await command('Profiler.setSamplingInterval', { interval: 500 })
    await command('Profiler.start')
  }
  const waitFor = async (condition) => {
    for (let i = 0; i < 1500; i++) {
      if (await run(condition)) return
      await pause(20)
    }
    throw Error('Timed out: ' + condition + '; ' + errors.join('\n'))
  }
  const snapshot = () =>
    run(`({maxFrameGap:Math.max(0,...frameGaps),
    formattedTokens:document.querySelectorAll('#chat-search-content pre code .token').length,
    selectedNodes:document.querySelectorAll('#chat-search-content *').length,
    rows:document.querySelectorAll('.chat-sidebar__body [data-chat-id]').length,
    selected:fixtureViewedChat})`)
  const finish = async (label, start, before) => {
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const after = await command('Performance.getMetrics')
    const state = await snapshot()
    const tasks = await run(`fixtureLongTasks.filter(task=>task.startTime>=${start})`)
    const result = {
      label,
      ...state,
      startTime: start,
      endTime: await run('performance.now()'),
      navigationStart: metric(after, 'NavigationStart'),
      tasks,
      commits: await run(`fixtureReactCommits.filter(commit=>commit.time>=${start})`),
      updates: await run(`fixtureReactUpdates.filter(update=>update.time>=${start})`),
      lanes: await run(`(window.fixtureUpdateLanes??[]).filter(update=>update.time>=${start})`),
      scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
      layoutMs: (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000
    }
    phases.push(result)
    if (label.endsWith('-settling') && process.env.SELE_BENCHMARK_LANES === '1')
      assert.deepEqual(
        result.lanes.filter(
          (update) =>
            update.name === 'App' &&
            /\/(?:useWorkspaceSources|useWorkspaceProjectResources|useWorkspaceAppearance|useWorkspaceChrome|useProviderUpdates)\./.test(
              update.stack
            )
        ),
        [],
        'startup catalog responses must not schedule blocking workspace renders'
      )
    return result
  }
  const measure = async (label, action, condition, observeMs = 400) => {
    await run('window.frameGaps=[]')
    const before = await command('Performance.getMetrics')
    const start = await run('performance.now()')
    await action()
    if (condition) await waitFor(condition)
    await pause(observeMs)
    return finish(label, start, before)
  }
  const load = async (label) => {
    const before = await command('Performance.getMetrics')
    const start = Date.now()
    await win.loadURL(url)
    await waitFor(
      'Boolean(document.querySelector("#message-input")) && Boolean(document.querySelector("[data-chat-id]")) && fixtureCalls.includes("getChats")'
    )
    const result = await finish(label, 0, before)
    result.readyMs = Date.now() - start
    result.paint = await run(
      "performance.getEntriesByType('paint').map(({name,startTime})=>({name,ms:startTime}))"
    )
    result.resources = await run(
      "performance.getEntriesByType('resource').map(({name,duration,decodedBodySize,transferSize})=>({name,duration,decodedBodySize,transferSize}))"
    )
    const settlingMs = Number(process.env.SELE_BENCHMARK_STARTUP_SETTLE_MS) || 0
    if (settlingMs > 0) await measure(label + '-settling', async () => {}, null, settlingMs)
    if (settlingMs > 2000 && process.env.SELE_BENCHMARK_STARTUP_BURST === '1')
      assert.equal(
        await run('Math.max(...fixtureProjectResourceCalls.values())'),
        1,
        'pending publication must not duplicate project icon or note requests'
      )
    return result
  }
  const startup = await load('startup-cold')
  const rendering = {
    compositorRequested: process.env.SELE_BENCHMARK_COMPOSITOR === '1',
    features: require('electron').app.getGPUFeatureStatus()
  }
  if (rendering.compositorRequested)
    assert.ok(
      rendering.features.gpu_compositing.startsWith('enabled'),
      'Native compositor profiling requires an enabled compositor: ' +
        JSON.stringify(rendering.features)
    )

  if (process.env.SELE_BENCHMARK_WARM_START === '1') await load('startup-warm')
  const open = (id) =>
    run(`document.querySelector('[data-chat-id="${id}"] .chat-list-item__main').click()`)
  const selected = (id) =>
    `fixtureViewedChat==='${id}' && document.querySelector('#chat-search-content [data-chat-turn-id]')?.dataset.chatTurnId.startsWith('${id}:')`
  const destinations =
    process.env.SELE_BENCHMARK_LATENCY === '1' ? ['0', '20', '40', '60'] : ['0', '20']
  for (const id of destinations) {
    await run(`fixtureEnsureSidebarChat('${id}')`)
    let navigation
    const phase = await measure(
      'open-cold-' + id,
      async () => {
        if (process.env.SELE_BENCHMARK_LATENCY === '1')
          navigation = await run(`measureNavigation('${id}')`)
        else await open(id)
      },
      selected(id)
    )
    if (navigation)
      Object.assign(phase, {
        clickStartedAt: navigation.clickStartedAt,
        firstSelectionMs: navigation.firstSelectionMs,
        firstMessagesMs: navigation.firstMessagesMs,
        firstMessageTextMs: navigation.firstMessageTextMs
      })
    if (id === '0' && lazyDelay && navigation)
      assert.ok(
        navigation.firstMessageTextMs !== null && navigation.firstMessageTextMs < lazyDelay,
        'readable message text must precede the delayed renderer module'
      )
    const sections = 10 * (Number(process.env.SELE_BENCHMARK_HISTORY_SECTIONS) || 40)
    await waitFor(
      `document.querySelectorAll('#chat-search-content h3').length >= ${sections} && document.querySelectorAll('#chat-search-content pre code').length >= ${sections}`
    )
    await run(
      `void fixtureTurnNodes.set('${id}',new Map([...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')].map(node=>[node.dataset.chatTurnId,node])))`
    )
  }
  assert.equal(
    await run(
      `performance.getEntriesByType('resource').some(entry=>entry.name.includes('@modelcontextprotocol_ext-apps_app-bridge'))`
    ),
    false,
    'ordinary messages must not evaluate the interactive-app protocol bridge'
  )
  for (const [packageName, maxBytes] of [
    ['lucide-animated', 250000],
    ['lucide-react', 600000]
  ]) {
    const resource = await run(
      `performance.getEntriesByType('resource').find(entry=>entry.name.includes('/'+${JSON.stringify(packageName)}+'.js'))?.name`
    )
    assert.ok(resource, 'exercise the real icon dependency: ' + packageName)
    const bytes = Buffer.byteLength(await (await fetch(resource)).text())
    assert.ok(
      bytes < maxBytes,
      'unused icons must not reach the renderer: ' + packageName + ' ' + bytes
    )
    const exports = await run(
      `(async()=>{const module=await import(${JSON.stringify(resource)});return Object.entries(module).map(([name,icon])=>({name,displayName:icon.displayName,render:typeof icon.render}))})()`
    )
    assert.ok(exports.length > 0)
    const original = await import(packageName)
    assert.ok(
      exports.every(
        (icon) =>
          icon.displayName === original[icon.name]?.displayName &&
          icon.render === typeof original[icon.name]?.render
      ),
      'retain icon names and forwardRef behavior: ' + packageName + ' ' + JSON.stringify(exports)
    )
    console.log(
      'icon dependency subset',
      JSON.stringify({ package: packageName, bytes, icons: exports.length })
    )
  }
  await run(
    'window.fixtureProjectsBeforeStream=fixtureReadProjectOptions();window.backgroundUpdates=window.beginBackgroundUpdates()'
  )
  // Let both histories acquire their formatted bodies before measuring reuse.
  await pause(1000)
  if (process.env.SELE_BENCHMARK_STARTUP_BURST === '1')
    assert.equal(
      await run('fixtureProjectsBeforeStream===fixtureReadProjectOptions()'),
      true,
      'streamed updates that reorder chats must preserve project option objects'
    )
  for (const id of [...destinations, ...destinations]) {
    let navigation
    const phase = await measure(
      'switch-warm-' + id,
      async () => {
        if (process.env.SELE_BENCHMARK_LATENCY === '1')
          navigation = await run(`measureNavigation('${id}')`)
        else await open(id)
      },
      selected(id)
    )
    if (navigation)
      Object.assign(phase, {
        clickStartedAt: navigation.clickStartedAt,
        firstSelectionMs: navigation.firstSelectionMs,
        firstMessagesMs: navigation.firstMessagesMs,
        firstMessageTextMs: navigation.firstMessageTextMs,
        mixedChatFrames: navigation.mixedChatFrames,
        reusedTurns: navigation.reusedTurns
      })
  }
  if (process.env.SELE_BENCHMARK_LATENCY === '1') {
    await run(`fixtureEnsureSidebarChat('80')`)
    await run(`document.querySelector('[data-chat-id="80"] .chat-list-item__main').focus()`)
    await pause(100)
    const prepared = await run(`measureNavigation('80')`)
    assert.ok(
      prepared.firstMessagesMs !== null &&
        prepared.firstMessageTextMs !== null &&
        prepared.firstMessageTextMs < 500,
      'local opening must appear before the 750ms provider refresh'
    )
    phases.push({ label: 'intent-prepared-80', ...prepared })
    await open('20')
    await waitFor(selected('20'))
    if (process.env.SELE_BENCHMARK_OFFLINE === '1') {
      await run(`window.fixtureFailChat='100'`)
      await run(`fixtureEnsureSidebarChat('100')`)
      await open('100')
      await waitFor(selected('100'))
      await waitFor(
        `fixtureCachedOptions.some(read=>read.id==='100'&&!read.opening) && document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length===10`
      )
      await waitFor(
        `document.querySelectorAll('#chat-search-content h3').length >= ${10 * (Number(process.env.SELE_BENCHMARK_HISTORY_SECTIONS) || 40)}`
      )
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content')?.textContent.includes('Section 100-0-0')`
        ),
        true,
        'provider failure must still allow reading the complete saved window'
      )
      await run(`window.fixtureFailChat=null`)
      await open('20')
      await waitFor(selected('20'))
    }
  }
  if (process.env.SELE_BENCHMARK_STRESS === '1') {
    await run(`window.fixtureMixedChatFrames=0;window.fixtureSampleChatRace=true;
      requestAnimationFrame(function sample(){
        const selected=fixtureSelectedChat();
        if(selected && [...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')]
          .some(node=>!node.dataset.chatTurnId.startsWith(selected+':'))) fixtureMixedChatFrames++;
        if(fixtureSampleChatRace)requestAnimationFrame(sample);
      });`)
    const rapid = await measure(
      'rapid-chat-switches',
      () =>
        run(`(async()=>{
      for(let i=0;i<12;i++) {
        document.querySelector('[data-chat-id="'+(i%2?'20':'0')+'"] .chat-list-item__main').click();
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
    })()`),
      selected('20')
    )
    await run('window.fixtureSampleChatRace=false')
    rapid.mixedChatFrames = await run('window.fixtureMixedChatFrames')
    assert.equal(
      rapid.mixedChatFrames,
      0,
      'rapid selections must never paint a different chat beneath the selected header'
    )
  }
  const filters = await measure(
    'rapid-sidebar-tabs',
    async () => {
      for (const label of ['Working', 'Active', 'Sleeping', 'All', 'Active', 'Working', 'All']) {
        await run(
          `document.querySelector('.ui-segmented-control button[aria-label="${label} chats"]').click()`
        )
        await pause(60)
      }
    },
    `Boolean(document.querySelector('[data-chat-id="0"]'))`,
    500
  )
  assert.equal(filters.selected, '20')
  if (process.env.SELE_BENCHMARK_STRESS === '1') {
    await measure(
      'sidebar-race-stress',
      () =>
        run(`(async()=>{
      const labels=['Working','Sleeping','All','Active'];
      for(let i=0;i<40;i++) {
        document.querySelector('.ui-segmented-control button[aria-label="'+labels[i%labels.length]+' chats"]').click();
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      document.querySelector('.ui-segmented-control button[aria-label="All chats"]').click();
    })()`),
      `Boolean(document.querySelector('[data-chat-id="0"]'))`,
      500
    )
  }
  for (const phase of phases) if (phase.rows !== undefined) assert.ok(phase.rows < 100)
  if (process.env.SELE_BENCHMARK_SCREENSHOT)
    await fs.writeFile(
      process.env.SELE_BENCHMARK_SCREENSHOT,
      (await win.webContents.capturePage()).toPNG()
    )
  if (process.env.SELE_BENCHMARK_SMOKE !== '0') {
    await run(`document.querySelector('button[aria-label="Settings"]').click()`)
    await waitFor(`Boolean(document.querySelector('[role="dialog"][aria-label="Settings"]'))`)
    await run(`document.querySelector('button[aria-label="Close settings"]').click()`)
    await waitFor(`!document.querySelector('[role="dialog"][aria-label="Settings"]')`)
    assert.equal(await run('Boolean(document.querySelector(".terminal-panel"))'), false)
    await run(`document.querySelector('button[aria-label="Terminal"]').click()`)
    await waitFor('Boolean(document.querySelector(".terminal-panel"))')
  }
  if (process.env.SELE_BENCHMARK_TRACE === '1') {
    const complete = new Promise((resolve) => {
      const onMessage = (_event, method) => {
        if (method === 'Tracing.tracingComplete') {
          win.webContents.debugger.off('message', onMessage)
          resolve()
        }
      }
      win.webContents.debugger.on('message', onMessage)
    })
    await command('Tracing.end')
    await complete
    await fs.writeFile(process.env.SELE_BENCHMARK_PROFILE + '.trace.json', JSON.stringify(trace))
  }
  if (profiling) {
    const { profile } = await command('Profiler.stop')
    await fs.writeFile(process.env.SELE_BENCHMARK_PROFILE, JSON.stringify(profile))
    await fs.writeFile(
      process.env.SELE_BENCHMARK_PROFILE + '.json',
      JSON.stringify({ startup, filters, phases, rendering }, null, 2)
    )
    const stacks = require('./workspace-profile.cjs').attributeTasks(
      profile,
      phases.filter((phase) => phase.tasks)
    )
    await fs.writeFile(
      process.env.SELE_BENCHMARK_PROFILE + '.stacks.json',
      JSON.stringify(stacks, null, 2)
    )
    for (const phase of stacks)
      for (const task of phase.tasks)
        assert.ok(
          task.sampledMs > 0,
          'CPU sampling and long-task clocks must agree: ' +
            JSON.stringify({ label: phase.label, task })
        )
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        vite: true,
        rendering,
        phases: phases.map(({ resources, ...phase }) => ({
          ...phase,
          resources: resources?.length
        })),
        errors
      },
      null,
      2
    )
  )
  await run('clearInterval(backgroundUpdates);unmountFixture()')
}
