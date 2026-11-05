const assert = require('node:assert/strict')
const openTab = (ui, label) => ui.tap(`.chat-home__filter-tabs button[aria-label="${label}"]`)
const action = async (ui, id, label) => {
  await ui.navigate('Chats')
  await ui.hold(`[data-chat-id="${id}"] .chat-list-item__main`)
  await ui.tap(`[data-chat-id="${id}"] [aria-label="Chat menu"]`)
  await ui.waitFor('Boolean(document.querySelector(".ui-dropdown__actions"))')
  await ui.run(`(()=>{const action=[...document.querySelectorAll('.ui-dropdown__action')].find(button=>button.textContent===${JSON.stringify(label)});if(action)action.dataset.sleepAction='true';return Boolean(action)})()`)
  await ui.tap('[data-sleep-action="true"]')
}
exports.startup = async (ui, {desktop, chatId}) => {
  const key = 'codex:'+chatId
  await ui.navigate('Chats')
  await openTab(ui, 'Sleeping chats')
  await ui.waitFor(`Boolean(document.querySelector('[data-chat-id="${chatId}"]'))`)
  await ui.restart()
  await ui.waitFor(`Boolean(document.querySelector('[data-chat-id="${chatId}"]'))`)
  await action(ui,chatId,'Wake up')
  await desktop.waitFor(`appApi.getChatSleep().then(value=>!Object.hasOwn(value.sleeping,${JSON.stringify(key)}))`)
  await desktop.waitFor(`Boolean(document.querySelector('[data-chat-id="${chatId}"]'))`)
  await desktop.eval(`appApi.updateChatSleep([{key:${JSON.stringify(key)},wakeAt:null}])`)
  await ui.waitFor(`Boolean(document.querySelector('[data-chat-id="${chatId}"]'))`)
  await openTab(ui, 'All chats')
  console.log('MOBILE SLEEP STARTUP PASSED: existing desktop sleeper visible, phone restart persists, native Wake syncs desktop, desktop Sleep syncs phone')
}
exports.providers = async (ui, {desktop,results}) => {
  await ui.navigate('Chats')
  await openTab(ui, 'All chats')
  const first = results[0]
  await action(ui, first.chatId, 'Sleep')
  await desktop.waitFor(`appApi.getChatSleep().then(value=>Object.hasOwn(value.sleeping,${JSON.stringify(first.provider+':'+first.chatId)}))`)
  const others = results.slice(1).map(result=>({key:result.provider+':'+result.chatId,wakeAt:null}))
  if (others.length) await desktop.eval(`appApi.updateChatSleep(${JSON.stringify(others)})`)
  await openTab(ui, 'Sleeping chats')
  for (const result of results) await ui.waitFor(`Boolean(document.querySelector('[data-chat-id="${result.chatId}"]'))`)
  const state = await ui.run('appApi.getChatSleep()')
  for (const result of results) assert.ok(Object.hasOwn(state.sleeping,result.provider+':'+result.chatId))
  await desktop.eval(`appApi.updateChatSleep(${JSON.stringify(results.map(result=>({key:result.provider+':'+result.chatId,wakeAt:false,expected:null})))})`)
  for (const result of results) await ui.waitFor(`!document.querySelector('[data-chat-id="${result.chatId}"]')`)
  await openTab(ui, 'All chats')
  console.log('MOBILE SLEEP PROVIDERS PASSED: native Sleep sync, all provider sleepers visible, desktop bulk Wake updates phone')
}
