const assert = require('node:assert/strict')
module.exports = async (ui, { desktop, dirs, results }) => {
  const { run, waitFor, tap, delay } = ui
  const call = (provider, method, ...args) =>
    run(
      `providerApi[${JSON.stringify(method)}](${[provider, ...args].map((value) => JSON.stringify(value)).join(',')})`
    )
  const until = async (read, label) => {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (await read()) return
      await delay(100)
    }
    throw new Error('Provider control timed out: ' + label)
  }
  await ui.navigate('Chats')
  await tap('.chat-home__filter-tabs button[aria-label="All chats"]')
  for (const result of results) {
    const { provider, chatId, model } = result
    console.log(`MOBILE CONTROLS: ${provider} pin sync, native Stop and resume`)
    await desktop.eval(
      `providerApi.setChatPinned(${JSON.stringify(provider)},${JSON.stringify(chatId)},true)`
    )
    await waitFor(
      `document.querySelector('[data-chat-id="${chatId}"]')?.classList.contains('chat-list-item--pinned')`
    )
    await ui.navigate('Chats')
    await ui.hold(`[data-chat-id="${chatId}"] .chat-list-item__main`)
    await tap(`[data-chat-id="${chatId}"] [aria-label="Chat menu"]`)
    await waitFor('Boolean(document.querySelector(".ui-dropdown__actions"))')
    await run('(()=>{const button=[...document.querySelectorAll(".ui-dropdown__action")].find(button=>button.textContent==="Unpin");if(button)button.dataset.testUnpin="true";return true})()')
    await tap('[data-test-unpin="true"]')
    await desktop.waitFor(
      `!document.querySelector('[data-chat-id="${chatId}"]')?.classList.contains('chat-list-item--pinned')`
    )
    const marker = `phone-stop-${provider}-${Date.now()}`
    const options = {
      cwd: dirs.work,
      container: { kind: 'host' },
      model,
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      ...(provider === 'copilot' ? { agentMode: 'interactive' } : {})
    }
    const started = await call(provider, 'startChat', `${marker} #delay 15000`, options)
    await ui.navigate('Chats')
    await tap(`[data-chat-id="${started.id}"] .chat-list-item__main`)
    await waitFor('Boolean(document.querySelector(\'button[aria-label="Stop response"]\'))')
    await tap('button[aria-label="Stop response"]')
    await until(
      async () => !(await call(provider, 'getChat', started.id)).status,
      provider + ' stops'
    )
    const resume = marker + '-resumed'
    await call(provider, 'continueChat', started.id, resume + ' #delay 200', options)
    await until(async () => {
      const detail = await call(provider, 'getChat', started.id)
      return (
        !detail.status &&
        detail.items.some(
          (item) =>
            item.type === 'message' &&
            item.role === 'assistant' &&
            JSON.stringify(item.content).includes(resume)
        )
      )
    }, provider + ' replies after stop')
    const current = await call(provider, 'getChat', started.id)
    assert.equal(
      current.items.filter(
        (item) =>
          item.type === 'message' &&
          item.role === 'user' &&
          JSON.stringify(item.content).includes(resume)
      ).length,
      1
    )
  }
  console.log(
    'MOBILE PROVIDER CONTROLS PASSED: all provider pins sync, native interruption and subsequent messaging'
  )
}
