import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function checkClaudeBrowserTools({
  createClaudeBrowserIntegration,
  browserService,
  window,
  url,
  codexTabId
}) {
  const scope = {
    providerId: 'claude',
    sessionId: 'browser-test-session',
    cwd: '/work',
    containerKey: 'host'
  }
  const integration = createClaudeBrowserIntegration(browserService, scope)
  const artifacts = await mkdtemp(join(tmpdir(), 'sele-claude-artifacts-'))
  const downloaded = []
  const client = new Client({ name: 'sele-browser-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await integration.server.instance.connect(serverTransport)
  await client.connect(clientTransport)
  const call = async (name, args = {}) => client.callTool({ name, arguments: args })
  const value = async (name, args) => {
    const result = await call(name, args)
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`)
    const text = result.content.find((item) => item.type === 'text')?.text
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const error = async (name, args, pattern) => {
    const result = await call(name, args)
    assert.equal(result.isError, true, name)
    assert.match(result.content[0].text, pattern)
  }
  try {
    const { tools } = await client.listTools()
    for (const name of [
      'tabs_context',
      'tabs_create',
      'navigate',
      'read_page',
      'find',
      'form_input',
      'computer',
      'javascript_tool',
      'read_console_messages',
      'read_network_requests',
      'upload_files',
      'downloads',
      'handle_dialog',
      'save_screenshot',
      'print_pdf',
      'record_gif'
    ])
      assert.ok(
        tools.some((tool) => tool.name === name),
        name
      )
    // Same session ID, different provider: chat workspaces must remain separate.
    assert.deepEqual((await value('tabs_context')).tabs, [])
    const tab = await value('navigate', { url })
    assert.ok(tab.id > 0)
    await error(
      'javascript_tool',
      { action: 'javascript_exec', text: '1', tabId: codexTabId },
      /outside/
    )
    await error(
      'javascript_tool',
      { action: 'javascript_exec', text: '1', tabId: window.webContents.id },
      /outside/
    )
    await error('navigate', { url: 'javascript:alert(1)', tabId: tab.id }, /Unsupported/)
    const tree = await value('read_page', { tabId: tab.id })
    assert.match(tree, /textbox/)
    const inputRef = tree.match(/\[(ref_\d+)\] textbox/)[1]
    const buttonRef = (await value('find', { query: 'Go', tabId: tab.id })).match(
      /\[(ref_\d+)\] button/
    )[1]
    await value('form_input', { tabId: tab.id, ref: inputRef, value: 'From Claude browser' })
    await value('computer', { tabId: tab.id, action: 'left_click', ref: buttonRef })
    const evaluate = (text) =>
      value('javascript_tool', { action: 'javascript_exec', text, tabId: tab.id })
    assert.equal(
      await evaluate('document.querySelector("#result").textContent'),
      'From Claude browser'
    )
    await value('computer', { tabId: tab.id, action: 'left_click', ref: inputRef })
    await value('computer', { tabId: tab.id, action: 'key', text: 'ctrl+a' })
    await value('computer', { tabId: tab.id, action: 'type', text: 'Typed through CDP' })
    assert.equal(await evaluate('document.querySelector("#name").value'), 'Typed through CDP')
    await error(
      'computer',
      { tabId: tab.id, action: 'left_click', coordinate: [-1, 0] },
      /0|greater|small/i
    )
    await error(
      'computer',
      { tabId: tab.id, action: 'left_click', coordinate: [100000, 100000] },
      /outside/
    )
    await error('computer', { tabId: tab.id, action: 'type' }, /requires text/)
    await error(
      'javascript_tool',
      { action: 'javascript_exec', text: 'throw new Error("fixture error")', tabId: tab.id },
      /fixture error/
    )
    await evaluate('console.error("Claude browser console fixture")')
    assert.ok(
      (await value('read_console_messages', { tabId: tab.id, onlyErrors: true })).some((entry) =>
        entry.text.includes('Claude browser console fixture')
      )
    )
    await evaluate('fetch("/network-fixture").then(response => response.text())')
    const requests = await value('read_network_requests', {
      tabId: tab.id,
      urlPattern: '/network-fixture'
    })
    assert.equal(requests.length, 1)
    const response = await value('read_network_requests', {
      tabId: tab.id,
      requestId: requests[0].requestId
    })
    assert.match(response.body, /Sele browser test/)
    const uploadPath = join(artifacts, 'upload-fixture.txt')
    await writeFile(uploadPath, 'Sele browser upload fixture')
    await evaluate(`(() => {
      const input = document.createElement('input');
      input.type = 'file'; input.id = 'browser-upload-fixture'; input.multiple = true;
      input.setAttribute('aria-label', 'Upload fixture files');
      document.body.append(input);
    })()`)
    await value('upload_files', {
      tabId: tab.id,
      paths: [uploadPath],
      selector: '#browser-upload-fixture'
    })
    assert.equal(
      await evaluate('document.querySelector("#browser-upload-fixture").files[0].name'),
      'upload-fixture.txt'
    )
    assert.equal(
      await evaluate('document.querySelector("#browser-upload-fixture").files[0].text()'),
      'Sele browser upload fixture'
    )
    await error(
      'upload_files',
      { tabId: tab.id, paths: [uploadPath], selector: '#name' },
      /input\[type=file\]/
    )
    await error(
      'upload_files',
      {
        tabId: tab.id,
        paths: [join(artifacts, 'missing.txt')],
        selector: '#browser-upload-fixture'
      },
      /ENOENT|exist|file/i
    )
    const fileRef = (await value('find', { query: 'Upload fixture files', tabId: tab.id })).match(
      /\[(ref_\d+)\]/
    )[1]
    await value('upload_files', { tabId: tab.id, paths: [uploadPath], ref: fileRef })

    assert.equal((await value('handle_dialog', { tabId: tab.id, action: 'status' })).dialog, null)
    await evaluate(
      'setTimeout(() => { window.browserConfirmAccepted = confirm("Browser fixture accept"); }, 50); "scheduled"'
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      (await value('handle_dialog', { tabId: tab.id, action: 'status' })).dialog.message,
      'Browser fixture accept'
    )
    await value('handle_dialog', {
      tabId: tab.id,
      action: 'accept',
      promptText: 'Accepted by browser tools'
    })
    assert.equal(await evaluate('window.browserConfirmAccepted'), true)
    await evaluate(
      'setTimeout(() => { window.browserConfirmAnswer = confirm("Browser fixture confirm"); }, 50); "scheduled"'
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    await value('handle_dialog', { tabId: tab.id, action: 'dismiss' })
    assert.equal(await evaluate('window.browserConfirmAnswer'), false)

    for (const endpoint of ['/download-fixture', '/download-redirect']) {
      const downloadUrl = new URL(endpoint, url).href
      await value('downloads', { tabId: tab.id, action: 'allow', url: downloadUrl })
      await evaluate(
        `(() => { const anchor = document.createElement('a'); anchor.href = ${JSON.stringify(downloadUrl)}; anchor.download = 'fixture.txt'; document.body.append(anchor); anchor.click(); anchor.remove(); })()`
      )
      const download = await value('downloads', { tabId: tab.id, action: 'wait', timeoutMs: 5000 })
      assert.ok(
        !downloaded.includes(download.filename),
        'wait returns the newly authorized download'
      )
      downloaded.push(download.filename)
      assert.equal(download.status, 'complete')
      assert.equal(await readFile(download.filename, 'utf8'), 'Sele browser download fixture\n')
    }

    await evaluate('document.body.style.minHeight = "1800px"')
    const screenshot = await value('save_screenshot', {
      tabId: tab.id,
      path: join(artifacts, 'full-page.png'),
      fullPage: true
    })
    const fullPagePng = await readFile(screenshot.path)
    assert.equal(fullPagePng.subarray(1, 4).toString(), 'PNG')
    assert.ok(
      fullPagePng.readUInt32BE(20) >= 1800,
      'full-page screenshot includes offscreen content'
    )
    await error('save_screenshot', { tabId: tab.id, path: screenshot.path }, /EEXIST|exist/)
    const pdf = await value('print_pdf', { tabId: tab.id, path: join(artifacts, 'page.pdf') })
    assert.equal((await readFile(pdf.path)).subarray(0, 5).toString(), '%PDF-')
    await value('record_gif', { tabId: tab.id, action: 'start' })
    await evaluate('document.body.style.background = "rgb(30, 90, 120)"')
    await value('computer', { tabId: tab.id, action: 'wait', duration: 0.6 })
    assert.ok((await value('record_gif', { tabId: tab.id, action: 'status' })).frames >= 2)
    const recording = await value('record_gif', {
      tabId: tab.id,
      action: 'stop',
      path: join(artifacts, 'browser.gif')
    })
    assert.equal((await readFile(recording.path)).subarray(0, 6).toString(), 'GIF89a')
    await value('resize_window', { tabId: tab.id, preset: 'mobile' })
    assert.equal(await evaluate('innerWidth'), 375)
    await value('resize_window', { tabId: tab.id, preset: 'desktop' })
    const temporary = browserService.createClient(scope)
    await temporary.visibility(false)
    const shot = await call('computer', { tabId: tab.id, action: 'screenshot', scale: 0.5 })
    assert.ok(!shot.isError, JSON.stringify(shot))
    const png = Buffer.from(shot.content.find((item) => item.type === 'image').data, 'base64')
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.ok(png.length > 1000)
    // Both providers compete for one shared debugger lease when using the same workspace.
    await assert.rejects(temporary.attach(tab.id), /another browser session/)
    const second = await value('tabs_create', { url, foreground: false })
    assert.equal((await value('tabs_context')).tabs.find((item) => item.id === tab.id).active, true)
    await value('tabs_select', { tabId: second.id })
    assert.equal(
      (await value('tabs_context')).tabs.find((item) => item.id === second.id).active,
      true
    )
    await value('tabs_close', { tabId: second.id })
    await value('navigate', { tabId: tab.id, url: url + '/next' })
    await error('form_input', { tabId: tab.id, ref: inputRef, value: 'stale' }, /Stale|unknown/)
    await value('navigate', { tabId: tab.id, url: 'back' })
    await value('navigate', { tabId: tab.id, url: 'forward' })
    // An already mounted panel must not process actions after the setting is disabled.
    await window.webContents.executeJavaScript('window.browserTestDisabled = true')
    await error('tabs_create', {}, /disabled/)
    await error(
      'javascript_tool',
      { action: 'javascript_exec', text: '1', tabId: tab.id },
      /disabled/
    )
    await window.webContents.executeJavaScript('window.browserTestDisabled = false')
    assert.equal((await value('tabs_context')).tabs.length, 1)
    const stillPending = browserService.createClient({ ...scope, sessionId: 'canceled-session' })
    const pending = stillPending.listTabs()
    stillPending.close()
    await assert.rejects(pending, /closed/)
    await client.close()
    integration.close()
    // Releasing a query releases debugger ownership, so another query can attach.
    await temporary.attach(tab.id)
    await temporary.closeTab(tab.id)
    temporary.close()
    await assert.rejects(temporary.listTabs(), /closed/)
    for (const view of ['project', 'global']) {
      await window.webContents.executeJavaScript(
        `window.setBrowserTestView(${JSON.stringify(view)}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )
      const codex = browserService.createClient({
        ...scope,
        providerId: 'codex',
        sessionId: 'shared-codex'
      })
      const claude = browserService.createClient({ ...scope, sessionId: 'shared-claude' })
      const otherProject = browserService.createClient({
        ...scope,
        cwd: '/other-project',
        sessionId: 'other-project'
      })
      try {
        const sharedTab = await codex.createTab()
        assert.ok((await claude.listTabs()).some((tab) => tab.id === sharedTab.id))
        if (view === 'project') await assert.rejects(otherProject.attach(sharedTab.id), /outside/)
        else assert.ok((await otherProject.listTabs()).some((tab) => tab.id === sharedTab.id))
        await codex.attach(sharedTab.id)
        await assert.rejects(claude.attach(sharedTab.id), /another browser session/)
        codex.detachAll()
        await claude.attach(sharedTab.id)
        await claude.closeTab(sharedTab.id)
      } finally {
        codex.close()
        claude.close()
        otherProject.close()
      }
    }
    await window.webContents.executeJavaScript(
      'window.setBrowserTestView("chat"); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    console.log(
      'PASS: Claude tools over MCP, uploads/downloads, explicit confirm dialogs, full-page PNG/PDF/GIF artifacts, shared input/accessibility, provider isolation, disabled settings and query cleanup'
    )
  } finally {
    integration.close()
    await client.close()
    await window.webContents.executeJavaScript('window.browserTestDisabled = false')
    await rm(artifacts, { recursive: true, force: true })
    for (const path of downloaded) await rm(path, { force: true })
  }
}

// No prompt or model inference: verify the real Claude Code process discovers the SDK server.
export async function checkInstalledClaudeBrowserSdk({
  createClaudeBrowserIntegration,
  browserService,
  runtimePath,
  directory
}) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const integration = createClaudeBrowserIntegration(browserService, {
    providerId: 'claude',
    sessionId: 'sdk-browser-test-session',
    cwd: directory,
    containerKey: 'host'
  })
  let finishInput
  const inputClosed = new Promise((resolve) => {
    finishInput = resolve
  })
  const input = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await inputClosed
        return { done: true, value: undefined }
      }
    })
  }
  const control = query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: runtimePath,
      cwd: directory,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { Claude_Browser: integration.server },
      canUseTool: async () => ({ behavior: 'deny', message: 'Initialization-only test' })
    }
  })
  try {
    await control.initializationResult()
    const deadline = Date.now() + 15000
    let status
    do {
      status = (await control.mcpServerStatus()).find((server) => server.name === 'Claude_Browser')
      if (status?.status === 'connected') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.equal(status?.status, 'connected', JSON.stringify(status))
    console.log(
      'PASS: installed Claude Code discovers the native-style browser server through Agent SDK control transport (no model inference)'
    )
  } finally {
    finishInput()
    control.close()
    integration.close()
  }
}
