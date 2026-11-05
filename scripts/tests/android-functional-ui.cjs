const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async (ui, { desktop, dirs, chat, artifacts, browserUrl }) => {
  const { run, waitFor, tap, adb, delay, screenshot } = ui
  // Android IME events exercise WebView's native input connection.
  const typeText = (value) =>
    adb(['shell', 'input', 'text', "'" + value.replace(/ /g, '%s').replace(/'/g, "'\"'\"'") + "'"])
  const shot = (name) => screenshot(path.join(artifacts, `${name}.png`))
  const select = async (id) => {
    await ui.navigate('Chats')
    await waitFor(`document.querySelector('main.chat')?.dataset.mobilePane==='chats'`)
    await tap(`[data-chat-id="${id}"] .chat-list-item__main`)
    await waitFor(
      `document.querySelector('main.chat')?.dataset.mobilePane==='conversation' && Boolean(document.querySelector('[data-chat-id="${id}"].chat-list-item--selected'))`
    )
  }
  console.log('MOBILE UI: touch session creation, keyboard, file editing and terminal')
  await select(chat.chatId)
  assert.equal(
    await run('(()=>{const messages=document.querySelector(".chat-detail__messages");const shell=document.querySelector(".chat-detail__messages-shell");return messages.clientHeight<=shell.clientHeight+1})()'),
    true,
    'the loaded conversation stays above the composer on older WebViews'
  )
  await shot('long-conversation')
  await ui.navigate('Chats')
  await ui.hold(`[data-chat-id="${chat.chatId}"] .chat-list-item__main`)
  await tap(`[data-chat-id="${chat.chatId}"] button[aria-label="Edit chat name"]`)
  await waitFor(`Boolean(document.querySelector('[data-chat-id="${chat.chatId}"] input[aria-label="Chat name"]'))`)
  assert.equal(ui.keyboardVisible(),false,'rename waits for an explicit editing tap')
  await tap(`[data-chat-id="${chat.chatId}"] input[aria-label="Chat name"]`)
  await waitFor(`document.activeElement===document.querySelector('[data-chat-id="${chat.chatId}"] input[aria-label="Chat name"]')`)
  const renameImeDeadline = Date.now()+10000
  while(Date.now()<renameImeDeadline&&!ui.keyboardVisible())await delay(100)
  assert.equal(ui.keyboardVisible(),true,'explicit rename tap opens the keyboard')
  await run('document.querySelector(\'input[aria-label="Chat name"]\').select()')
  typeText('Renamed on Android')
  await tap(`[data-chat-id="${chat.chatId}"] button[aria-label="Save chat name"]`)
  await waitFor(`document.querySelector('[data-chat-id="${chat.chatId}"] .chat-list-item__title')?.textContent==='Renamed on Android'`)
  await desktop.waitFor(`document.querySelector('[data-chat-id="${chat.chatId}"] .chat-list-item__title')?.textContent==='Renamed on Android'`)
  await ui.dismissKeyboard()
  await ui.navigate('Chats')
  await ui.hold(`[data-chat-id="${chat.chatId}"] .chat-list-item__main`)
  await tap(`[data-chat-id="${chat.chatId}"] button[aria-label="Mark chat done"]`)
  await desktop.waitFor(
    `providerApi.getChat(${JSON.stringify(chat.provider)},${JSON.stringify(chat.chatId)}).then(chat=>chat.done)`,
    { timeout: 10000 }
  )
  await desktop.eval(
    `providerApi.markChatDone(${JSON.stringify(chat.provider)},${JSON.stringify(chat.chatId)},false)`
  )
  await select(chat.chatId)
  await ui.navigate('Chats')
  await tap('.mobile-sidebar-footer__actions button[aria-label="New chat"]')
  await tap('button[aria-label="Chat setup"]')
  await waitFor('Boolean(document.querySelector(\'[role="combobox"][aria-label="Provider"]\'))')
  const provider = await run(
    'document.querySelector(\'[role="combobox"][aria-label="Provider"]\').textContent'
  )
  assert.match(provider, /Codex/, 'new chat inherits the selected Codex provider')
  await ui.dismissKeyboard()
  adb(['shell', 'input', 'keyevent', '4'])
  await waitFor('!document.querySelector(".mobile-session-fields")')
  await tap('#message-input')
  await delay(350)
  typeText('phone-ui-create #delay 200')
  await waitFor('document.querySelector("#message-input")?.value.includes("phone-ui-create")')
  await delay(500)
  await shot('keyboard-composer')
  assert.equal(
    await run(`document.querySelector('main.chat')?.dataset.mobileKeyboard==='open'`),
    true,
    'native keyboard is accounted for'
  )
  await waitFor('!document.querySelector(\'button[aria-label="Send message"]\')?.disabled')
  await tap('button[aria-label="Send message"]')
  await waitFor(
    'document.getElementById("chat-search-content")?.innerText.includes("Reply to: phone-ui-create")'
  )
  await ui.dismissKeyboard()
  await delay(300)
  await shot('created-session')
  await ui.navigate('Workspace')
  await fs.writeFile(path.join(dirs.work, 'phone-preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfLJIYxvSH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBpMWA8UFdWBoAAAAASUVORK5CYII=','base64'))
  await fs.writeFile(path.join(dirs.work, 'README.md'), '# e2e workspace\n\n' + 'A long line that should wrap naturally in the mobile editor. '.repeat(12) + '\n')
  await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Files"]')
  await waitFor(
    'Boolean(document.querySelector(\'.changes-sidebar button[aria-label="Open README.md"]\'))'
  )
  await tap('.changes-sidebar button[aria-label="Open README.md"]')
  await waitFor('Boolean(document.querySelector(".mobile-code-editor .cm-content"))')
  await waitFor('Boolean(document.querySelector(".mobile-code-editor .cm-line span"))')
  assert.equal(await run('Boolean(document.querySelector(".mobile-code-editor__toolbar, .mobile-code-editor__comment-action"))'), false, 'no extra mobile editor chrome')
  assert.equal(await run(`Boolean(document.querySelector('button[aria-label*="in file manager"],button[aria-label="Expand file editor"]'))`), false, 'desktop-only actions are absent')
  assert.equal(await run('Boolean(document.querySelector(".mobile-code-editor .cm-lineWrapping"))'), true, 'word wrap is enabled')
  await waitFor('(()=>{const e=document.querySelector(".mobile-code-editor .cm-scroller");return e.scrollWidth<=e.clientWidth+1})()')
  await tap('button[aria-label="Disable word wrap"]')
  await waitFor('(()=>{const e=document.querySelector(".mobile-code-editor .cm-scroller");return e.scrollWidth>e.clientWidth+100})()')
  await tap('button[aria-label="Enable word wrap"]')
  await waitFor('(()=>{const e=document.querySelector(".mobile-code-editor .cm-scroller");return e.scrollWidth<=e.clientWidth+1})()')
  await tap('.mobile-code-editor .cm-content')
  adb(['shell','input','keycombination','113','29'])
  await delay(150)
  await tap('button[aria-label="Comment on selection"]')
  await waitFor('Boolean(document.querySelector("#mobile-file-comment"))')
  await tap('#mobile-file-comment')
  typeText('Review from Android')
  await tap('.mobile-code-editor__comment .ui-button--primary')
  await ui.dismissKeyboard()
  await waitFor(`Boolean(document.querySelector('.mobile-code-editor button[aria-label^="Open 1 review comment"]'))`)
  await tap('.mobile-code-editor button[aria-label^="Open 1 review comment"]')
  await waitFor('Boolean(document.querySelector(".unified-diff__review-overlay"))')
  await tap('.unified-diff__review-overlay input')
  adb(['shell','input','keycombination','113','29'])
  typeText('Edited review on Android')
  await tap('.unified-diff__review-overlay button[aria-label="Save comment"]')
  await waitFor('document.querySelector(".unified-diff__review-overlay input")?.value==="Edited review on Android"')
  await tap('.unified-diff__review-overlay button[aria-label="Delete comment"]')
  await waitFor('!document.querySelector(".unified-diff__review-marker")')
  await ui.dismissKeyboard()
  await shot('file-editor')
  await tap('.mobile-code-editor .cm-content')
  adb(['shell','input','keycombination','113','29'])
  await delay(150)
  typeText('# e2e workspace - Edited on Android.')
  adb(['shell','input','keycombination','113','54'])
  await waitFor('document.querySelector(".mobile-code-editor .cm-content")?.innerText.includes("A long line")')
  adb(['shell','input','keycombination','113','59','54'])
  await waitFor('document.querySelector(".mobile-code-editor .cm-content")?.innerText.includes("Edited on Android.")')
  await waitFor(
    '!document.querySelector(\'.file-editor-dialog button[aria-label^="Save "]\')?.disabled'
  )
  await tap('.file-editor-dialog button[aria-label^="Save "]')
  const deadline = Date.now() + 10000
  while (
    Date.now() < deadline &&
    !(await fs.readFile(path.join(dirs.work, 'README.md'), 'utf8')).includes('Edited on Android.')
  )
    await delay(100)
  assert.match(await fs.readFile(path.join(dirs.work, 'README.md'), 'utf8'), /Edited on Android\./)
  await tap('.file-editor-dialog button[aria-label="Close file editor"]')
  await waitFor('!document.querySelector(".file-editor-dialog")')
  await ui.dismissKeyboard()
  await tap('.changes-sidebar button[aria-label="Open phone-preview.png"]')
  await waitFor('document.querySelector(".file-editor-dialog__image-preview img")?.naturalWidth===64')
  assert.equal(await run(`Boolean(document.querySelector('.file-editor-dialog button[aria-label^="Copy "], .file-editor-dialog button[aria-label^="Download "], .file-editor-dialog button[aria-label*="file manager"]'))`),false,'image view omits desktop-only actions')
  await shot('image-preview')
  await tap('.file-editor-dialog button[aria-label="Close file editor"]')
  await waitFor('!document.querySelector(".file-editor-dialog")')
  console.log('MOBILE EDITOR PASSED: highlighting, native long-line wrap toggle, review comment add/edit/delete, undo/redo, host save, image preview')
  await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Git"]')
  await tap('.changes-sidebar__controls button[aria-label="Refresh changes"]')
  await waitFor('document.querySelector(".changes-sidebar__body")?.innerText.includes("README.md")')
  const gitRatio = await run('document.querySelector(".changes-sidebar__body").getBoundingClientRect().height / document.querySelector(".changes-sidebar").getBoundingClientRect().height')
  assert.ok(gitRatio >= 0.7, 'real Git changes have most of the phone workspace')
  await shot('git-changes')
  await tap('.mobile-git-actions > button')
  await waitFor('Boolean(document.querySelector(".mobile-git-dialog[open]"))')
  await tap('.mobile-git-dialog textarea')
  await delay(300)
  typeText('Phone UI verified commit')
  await waitFor('!document.querySelector(".mobile-git-dialog .changes-sidebar__commit-row--manual > button")?.disabled')
  await shot('git-commit-keyboard')
  await tap('.mobile-git-dialog .changes-sidebar__commit-row--manual > button')
  const commitDeadline = Date.now() + 20000
  while (Date.now() < commitDeadline && execFileSync('git', ['-C', dirs.work, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim() !== 'Phone UI verified commit') await delay(150)
  assert.equal(execFileSync('git', ['-C', dirs.work, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(), 'Phone UI verified commit', 'native commit controls create a host Git commit')
  await tap('.mobile-git-dialog button[aria-label="Close Git actions"]')
  await waitFor('!document.querySelector(".mobile-git-dialog[open]")')
  await ui.dismissKeyboard()
  await delay(300)
  console.log('MOBILE UI: native Git commit verified in host repository')
  const manualHead = execFileSync('git', ['-C', dirs.work, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
  await fs.appendFile(path.join(dirs.work, 'README.md'), '\nNative AI commit verification\n')
  await tap('.changes-sidebar__controls button[aria-label="Refresh changes"]')
  await waitFor('!document.querySelector(\'.mobile-git-actions button[aria-label="AI Commit"]\')?.disabled')
  await tap('.mobile-git-actions button[aria-label="AI Commit"]')
  const aiDeadline = Date.now()+60000
  while(Date.now()<aiDeadline && execFileSync('git',['-C',dirs.work,'rev-parse','HEAD'],{encoding:'utf8'}).trim()===manualHead) await delay(150)
  assert.notEqual(execFileSync('git',['-C',dirs.work,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),manualHead,'direct AI Commit creates a host commit')
  assert.equal(execFileSync('git',['-C',dirs.work,'status','--porcelain'],{encoding:'utf8'}).trim(),'','AI commit includes the changed file')
  console.log('MOBILE UI: direct AI Commit verified in host repository')
  await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Recents"]')
  await waitFor('Boolean(document.querySelector(".changes-sidebar__recent-actions .ui-button"))')
  const rows=await run('[...document.querySelectorAll(".changes-sidebar__recent-actions .ui-button")].map(e=>{const b=e.getBoundingClientRect(),r=e.closest(".changes-sidebar__recent-item").getBoundingClientRect();return {top:b.top,bottom:b.bottom,rowTop:r.top,rowBottom:r.bottom,height:b.height}})')
  for(const row of rows){assert.ok(row.height>=43);assert.ok(row.top>=row.rowTop&&row.bottom<=row.rowBottom+1,"recent row contains the full mobile action button")}
  await shot('recent-mobile-rows')
  console.log('MOBILE UI: host file saved, opening terminal')
  await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Terminal"]')
  await waitFor('Boolean(document.querySelector(".terminal-panel__session--active .xterm-screen"))')
  await run(
    'window.__phoneTerminalOutput=""; window.__phoneTerminalUnsub=terminalApi.onData(event=>window.__phoneTerminalOutput+=event.data); true'
  )
  const terminalCommand = async (text) => {
    await tap('.terminal-panel__session--active .terminal-panel__surface')
    await waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")')
    const imeDeadline = Date.now() + 10000
    while (Date.now() < imeDeadline && !ui.keyboardVisible()) await delay(100)
    assert.equal(ui.keyboardVisible(), true, 'terminal tap opens the native keyboard')
    typeText(text)
    adb(['shell', 'input', 'keyevent', '66'])
  }
  await terminalCommand('printf SELE_; echo PHONE_TERMINAL')
  await delay(500)
  await shot('terminal-first-command')
  await waitFor('window.__phoneTerminalOutput.includes("SELE_PHONE_TERMINAL")')
  await terminalCommand('sleep 30')
  await delay(300)
  await tap('.terminal-panel__session--active button[aria-label="Interrupt command"]')
  await terminalCommand('printf SELE_; echo PHONE_INTERRUPTED')
  await waitFor('window.__phoneTerminalOutput.includes("SELE_PHONE_INTERRUPTED")')
  await shot('terminal-keyboard')
  await ui.dismissKeyboard()
  await delay(400)
  await ui.navigate('Workspace')
  adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'])
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', '1'])
  try {
    await waitFor('innerWidth>innerHeight')
    assert.equal(
      await run('Boolean(document.querySelector("main.chat[data-mobile-pane]"))'),
      true,
      'landscape remains adaptive'
    )
    assert.equal(
      await run('document.querySelector(".changes-sidebar").getBoundingClientRect().width >= document.querySelector(".chat__panels").clientWidth * 0.95'),
      true,
      'landscape workspace uses the available width'
    )
    for (const [index, pane, selector] of [
      [1, 'chats', '.chat-sidebar'],
      [2, 'conversation', '.chat-panel'],
      [3, 'workspace', '.changes-sidebar']
    ]) {
      await ui.navigate([null,'Chats','Conversation','Workspace'][index])
      await waitFor(`document.querySelector('main.chat')?.dataset.mobilePane===${JSON.stringify(pane)}`)
      if (pane === 'chats') {
        assert.equal(await run('document.getElementById("sidebar").getBoundingClientRect().width<innerWidth'), true, 'landscape keeps chats in a drawer')
        continue
      }
      assert.equal(
        await run(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width >= document.querySelector(".chat__panels").clientWidth * 0.95`),
        true,
        `${pane} fills landscape width`
      )
    }
    await ui.navigate('Open settings')
    await waitFor('Boolean(document.querySelector(".settings-dialog"))')
    assert.equal(
      await run('document.querySelector(".settings-dialog").getBoundingClientRect().width >= innerWidth * 0.95'),
      true,
      'settings fills landscape width'
    )
    await tap('.settings-dialog button[aria-label="Close settings"]')
    await waitFor('!document.querySelector(".settings-dialog")')
    assert.ok(await run('document.querySelector(".mobile-sidebar-footer").getBoundingClientRect().height<120'), 'landscape sidebar footer stays within two control rows')
    assert.ok(await run('document.querySelector(".chat-sidebar__body").getBoundingClientRect().height>=innerHeight*0.35'), 'landscape drawer leaves room for the chat list')
    await shot('landscape')
  } finally {
    adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0'])
  }
  await waitFor('innerHeight>innerWidth')
  await delay(600)
  ui.invalidateTouchBounds()
  await ui.navigate('Workspace')
  await require('./android-browser-ui.cjs')(ui, { desktop, browserUrl, artifacts })
  await require('./android-files-ui.cjs')(ui, { dirs, artifacts })
  console.log(
    'MOBILE FUNCTIONAL UI PASSED: touch creation and reply, IME, done sync, real file save, terminal input/output/interrupt and landscape'
  )
}
