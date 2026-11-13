const chrome = globalThis.chrome
const status = document.getElementById('status')
const error = document.getElementById('error')
const settings = document.getElementById('settings')
const pairing = document.getElementById('pairing')
const disconnect = document.getElementById('disconnect')
let initialized = false
async function refresh(action, extra = {}) {
  try {
    const result = await chrome.runtime.sendMessage({ action, ...extra })
    error.hidden = !result.error
    error.textContent = result.error || ''
    if (typeof result.paired !== 'boolean') {
      status.textContent = 'Extension update has not loaded yet.'
      return
    }
    status.textContent = result.connected
      ? 'Connected. Website tabs are available automatically.'
      : result.paired
        ? 'Reconnecting automatically…'
        : 'Connect once to get started.'
    pairing.hidden = result.paired
    disconnect.hidden = !result.paired
    if (!initialized || action === 'connect' || action === 'disconnect')
      settings.open = !result.paired
    initialized = true
  } catch (failure) {
    error.hidden = false
    error.textContent = failure instanceof Error ? failure.message : String(failure)
    status.textContent = 'Unable to read connection status.'
  }
}
pairing.onsubmit = async (event) => {
  event.preventDefault()
  await refresh('connect', { endpoint: document.getElementById('endpoint').value })
  if (pairing.hidden) document.getElementById('endpoint').value = ''
}
disconnect.onclick = () => refresh('disconnect')
refresh('status')
setInterval(() => refresh('status'), 1500)
