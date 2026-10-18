const chrome = globalThis.chrome
const status = document.getElementById('status')
async function refresh(action, extra = {}) {
  const result = await chrome.runtime.sendMessage({ action, ...extra })
  status.textContent =
    result.error || (result.connected ? 'Connected. Only listed tabs are shared.' : 'Disconnected.')
  document.getElementById('share').disabled = !result.connected
  const list = document.getElementById('tabs')
  list.replaceChildren()
  for (const tab of result.tabs ?? []) {
    const item = document.createElement('li')
    item.textContent = tab.title || tab.url
    const stop = document.createElement('button')
    stop.textContent = 'Stop sharing'
    stop.onclick = () => refresh('unshare', { tabId: tab.id })
    item.append(stop)
    list.append(item)
  }
}
document.getElementById('connect').onclick = () =>
  refresh('connect', { endpoint: document.getElementById('endpoint').value })
document.getElementById('share').onclick = () => refresh('share')
document.getElementById('disconnect').onclick = () => refresh('disconnect')
refresh('status')
