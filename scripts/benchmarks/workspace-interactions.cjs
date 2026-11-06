// Keep active rich histories streaming during navigation, tab changes and completion.
// Called by benchmark-workspace-navigation.cjs with SELE_BENCHMARK_INTERACTIONS=1.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = async ({ win, run, directory, errors }) => {
  const command = (name, params) => win.webContents.debugger.sendCommand(name, params)
  const tracing = process.env.SELE_BENCHMARK_TRACE === '1'
  const profiling = Boolean(process.env.SELE_BENCHMARK_PROFILE)
  await run(`window.fixtureRootLayoutReads=0;window.fixtureFocusScans=0;
    for(const property of ['scrollTop','scrollLeft']) {
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,property);
      Object.defineProperty(document.documentElement,property,{configurable:true,
        get(){window.fixtureRootLayoutReads++;return descriptor.get.call(this)},
        set(value){descriptor.set.call(this,value)}});
    }
    const queryAll=document.querySelectorAll.bind(document);
    document.querySelectorAll=selector=>{
      if(selector==='dialog[open], [role="dialog"], [role="menu"], [role="listbox"]')window.fixtureFocusScans++;
      return queryAll(selector);
    };
    void 0;
  `)
  await command('Performance.enable')
  if (profiling) {
    await command('Profiler.enable')
    await command('Profiler.start')
  }
  const trace = []
  const onTrace = (_event, method, params) => {
    if (method === 'Tracing.dataCollected') trace.push(...params.value)
  }
  if (tracing) {
    win.webContents.debugger.on('message', onTrace)
    await command('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack'
    })
  }
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (await run(condition)) {
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Interaction timed out: ' + condition)
  }
  const click = async (selector) => {
    const chatId = selector.match(/data-chat-id="([^"]+)"/)?.[1]
    return run(
      `(async () => { ${chatId ? `await window.fixtureEnsureSidebarChat(${JSON.stringify(chatId)});` : ''} const button=document.querySelector(${JSON.stringify(selector)}); if(!button)throw new Error('Missing '+${JSON.stringify(selector)}); button.click() })()`
    )
  }
  const samples = []
  const measure = async (label, action, condition) => {
    await run(
      `window.frameGaps=[];window.longTasks=[];window.fixtureMessageRenders=[];window.fixtureRootLayoutReads=0;window.fixtureFocusScans=0;performance.mark(${JSON.stringify('interaction:' + label + ':start')})`
    )
    const before = await command('Performance.getMetrics')
    const seenBefore = await run('fixtureCalls.filter(name => name === "markChatSeen").length')
    await action()
    await waitFor(condition)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const after = await command('Performance.getMetrics')
    await run(`performance.mark(${JSON.stringify('interaction:' + label + ':end')})`)
    const metric = (values, name) => values.metrics.find((value) => value.name === name)?.value ?? 0
    samples.push({
      label,
      seenWrites:
        (await run('fixtureCalls.filter(name => name === "markChatSeen").length')) - seenBefore,
      scriptMs: 1000 * (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')),
      layoutMs: 1000 * (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')),
      ...(await run(
        '({maxFrameGap:Math.max(...frameGaps),longTasks:[...longTasks],messageRenders:fixtureMessageRenders.length,selected:fixtureViewedChat,nodes:document.querySelectorAll("*").length,sidebarRows:document.querySelectorAll(".chat-sidebar__body [data-chat-id]").length,rootLayoutReads:fixtureRootLayoutReads,focusScans:fixtureFocusScans})'
      ))
    })
  }
  for (const [index, id] of ['1', '2', '1', '2'].entries()) {
    await measure(
      'switch-' + index + '-' + id,
      () => click(`[data-chat-id="${id}"] .chat-list-item__main`),
      `fixtureViewedChat==='${id}' && document.querySelector('#chat-search-content [data-chat-turn-id]')?.dataset.chatTurnId.startsWith('${id}:')`
    )
  }
  await measure(
    'rapid-sidebar-tabs',
    async () => {
      for (const label of [
        'Working chats',
        'Active chats',
        'Sleeping chats',
        'All chats',
        'Active chats',
        'Working chats',
        'All chats'
      ]) {
        await click(`.ui-segmented-control button[aria-label="${label}"]`)
        await new Promise((resolve) => setTimeout(resolve, 35))
      }
    },
    `document.querySelector('.ui-segmented-control button[aria-label="All chats"]')?.getAttribute('aria-pressed')==='true'`
  )
  assert.equal(
    await run('fixtureViewedChat'),
    '2',
    'sidebar filtering preserves the active conversation'
  )
  await measure(
    'open-before-completion',
    () => click('[data-chat-id="1"] .chat-list-item__main'),
    `fixtureViewedChat==='1'`
  )
  await measure(
    'complete-selected',
    () => click('[data-chat-id="1"] [aria-label="Mark chat done"]'),
    `fixtureChats[1].done && !document.querySelector('.chat-panel--selected')`
  )
  await measure(
    'return-to-stream',
    () => click('[data-chat-id="2"] .chat-list-item__main'),
    `fixtureViewedChat==='2'`
  )
  await measure(
    'complete-unselected',
    () => click('[data-chat-id="4"] [aria-label="Mark chat done"]'),
    'fixtureChats[4].done'
  )
  assert.equal(await run('fixtureViewedChat'), '2')
  assert.equal(
    await run(
      'fixtureSidebarData().every(item => typeof item.id === "string" && item.snapshot.get(item.id)?.key === item.id)'
    ),
    true,
    'virtualizer IDs retain their own matching immutable entry snapshot'
  )
  for (const sample of samples) {
    assert.ok(
      sample.sidebarRows < 100,
      'sidebar mounts only the window around the viewport: ' + JSON.stringify(sample)
    )
    assert.ok(
      sample.rootLayoutReads < 20,
      'list changes must not measure the document projection tree: ' + JSON.stringify(sample)
    )
    assert.ok(
      sample.focusScans <= 1,
      'restoring focus must not repeatedly scan retained transcripts: ' + JSON.stringify(sample)
    )
  }
  // Freeze stream ordering while checking a metadata-only row update.
  await run('clearInterval(window.backgroundUpdates)')
  await run('new Promise(resolve=>setTimeout(resolve,150))')
  await run('window.fixtureEnsureSidebarChat("0")')
  await run(`(() => {window.fixtureDataBeforeMetadata=fixtureSidebarData();
    window.fixtureOldTitle=fixtureChats[0].title;
    const chat=fixtureChats[0];chat.title='Metadata-only rename';
    fixtureChatListener({providerId:chat.providerId,chatId:chat.id,sequence:1000000000,turnCompleted:false,detail:null,
      summary:{...chat,revision:fixtureRevision+1,currentActivity:null,previewLength:0}});})()`)
  await waitFor(
    `document.querySelector('[data-chat-id="0"] .chat-list-item__title')?.textContent==='Metadata-only rename'`
  )
  assert.equal(
    await run('fixtureDataBeforeMetadata===fixtureSidebarData()'),
    true,
    'metadata must update rows without republishing the same ID window to the virtualizer'
  )
  await run(`(() => {const chat=fixtureChats[0];chat.title=fixtureOldTitle;
    fixtureChatListener({providerId:chat.providerId,chatId:chat.id,sequence:1000000001,turnCompleted:false,detail:null,
      summary:{...chat,revision:fixtureRevision+2,currentActivity:null,previewLength:0}});})()`)
  await waitFor(
    `document.querySelector('[data-chat-id="0"] .chat-list-item__title')?.textContent===fixtureOldTitle`
  )
  // Exercise normal controls on rows that a virtualizer can mount and unmount.
  await run('window.fixtureEnsureSidebarChat("0")')
  await run(`(() => {
    const items=[...document.querySelectorAll('[data-sidebar-entry-index]')];
    const item=items.at(-1);
    const controls=[...item.querySelectorAll('button:not([disabled]),[tabindex="0"]')].filter(node=>!node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length>0);
    const button=controls.at(-1);
    window.expectedTabIndex=Number(item.dataset.sidebarEntryIndex)+1;
    button.focus();button.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  })()`)
  await waitFor(
    'Number(document.activeElement?.closest("[data-sidebar-entry-index]")?.dataset.sidebarEntryIndex)===expectedTabIndex'
  )
  await run(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));void 0`
  )
  await waitFor(
    'Number(document.activeElement?.closest("[data-sidebar-entry-index]")?.dataset.sidebarEntryIndex)===expectedTabIndex-1'
  )
  await run('window.fixtureEnsureSidebarChat("0")')
  await waitFor('document.querySelector(\'[data-chat-id="20"]\')')
  await run(
    `window.dragTransfer=new DataTransfer();document.querySelector('[data-chat-id="0"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dragTransfer}));void 0`
  )
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await run(
    `const target=document.querySelector('[data-chat-id="20"]');const rect=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dragTransfer,clientY:rect.bottom-1}));void 0`
  )
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await run(
    `document.querySelector('[data-chat-id="20"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dragTransfer}));document.querySelector('[data-chat-id="0"]')?.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dragTransfer}));void 0`
  )
  await waitFor('fixtureChats[20].sidebarOrder===0 && fixtureChats[0].sidebarOrder===1')
  if (await run('window.fixtureHasSidebarFooter("0")')) {
    await run('window.fixtureRevealSidebarFooter("0")')
    await waitFor('document.querySelector(\'button[title^="Load next"]\')')
    await click('button[title^="Load next"]')
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const lastId = await run('fixtureChats.filter(chat=>chat.cwd===fixtureChats[0].cwd).at(-1).id')
    await run(`window.fixtureEnsureSidebarChat(${JSON.stringify(lastId)})`)
    assert.equal(
      await run(`Boolean(document.querySelector('[data-chat-id="${lastId}"]'))`),
      true,
      'pagination reaches the last chat in a project'
    )
    await run('window.fixtureRevealSidebarFooter("0")')
    await waitFor('document.querySelector(\'button[title="Show less"]\')')
    await click('button[title="Show less"]')
    assert.ok(
      await run('document.querySelectorAll(".chat-sidebar__body [data-chat-id]").length < 100')
    )
  }
  assert.deepEqual(errors, [])
  await run('window.fixtureEnsureSidebarChat("0",true)')
  await run(
    `document.querySelector('[data-project-group-key="cwd:/fixture/project-0"] .chat-list-group__toggle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));void 0`
  )
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await run('window.fixtureEnsureSidebarChat("2",true)')
  await run(
    `(()=>{const target=document.querySelector('[data-project-group-key="cwd:/fixture/project-2"]');const bounds=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:new DataTransfer(),clientY:bounds.bottom-1}));})()`
  )
  await run(
    `document.querySelector('.chat-list-stack').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()}));void 0`
  )
  await waitFor('Boolean(window.fixtureProjectOrder)')
  assert.equal(
    await run('fixtureProjectOrder[fixtureProjectOrder.indexOf("/fixture/project-2")+1]'),
    '/fixture/project-0',
    'nested virtual headers preserve logical project drag order'
  )
  assert.deepEqual(errors, [])
  if (process.env.SELE_BENCHMARK_SCREENSHOT) {
    await fs.writeFile(
      process.env.SELE_BENCHMARK_SCREENSHOT,
      (await win.webContents.capturePage()).toPNG()
    )
  }
  const profile = profiling ? (await command('Profiler.stop')).profile : null
  if (tracing) {
    const complete = new Promise((resolve) => {
      const listener = (_event, method) => {
        if (method === 'Tracing.tracingComplete') {
          win.webContents.debugger.off('message', listener)
          resolve()
        }
      }
      win.webContents.debugger.on('message', listener)
    })
    await command('Tracing.end')
    await complete
    win.webContents.debugger.off('message', onTrace)
  }
  const output = process.env.SELE_BENCHMARK_PROFILE
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, JSON.stringify(profile))
    await fs.copyFile(path.join(directory, 'fixture.js'), output + '.fixture.js')
    if (tracing) await fs.writeFile(output + '.trace.json', JSON.stringify(trace))
    await fs.writeFile(output + '.json', JSON.stringify(samples, null, 2))
  }
  console.log(JSON.stringify({ interactions: true, samples, errors }, null, 2))
  await run('clearInterval(window.backgroundUpdates);window.unmountFixture()')
}
